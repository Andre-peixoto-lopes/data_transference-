"""Pydantic model mirroring the receiver's TransferReport (app/shared/telemetry.ts)."""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field

_OS = re.compile(r"Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+|Linux")
_BROWSER = re.compile(r"(Edg|Chrome|Firefox|Version)/(\d+)")
FRAME_HEADER_LENGTH = 24  # app/shared/protocol.ts
_STANDARD_REFRESH_HZ = (60.0, 75.0, 90.0, 100.0, 120.0, 144.0, 165.0, 240.0)


def snap_refresh(hz: float) -> float:
    """Chrome coarsens rAF timestamps to 0.1 ms, so older reports read 120 Hz as 120.48."""
    nearest = min(_STANDARD_REFRESH_HZ, key=lambda standard: abs(standard - hz))
    return nearest if abs(nearest - hz) / nearest < 0.02 else hz


class SenderSettings(BaseModel):
    """What the sender announced; merged into the report by the dev diagnostics endpoint."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    qr_version: int = Field(alias="qrVersion")
    ecc: str
    codes: int
    target_fps: float = Field(alias="targetFps")
    display_fps: float = Field(alias="displayFps")
    refresh_hz: float = Field(alias="refreshHz")
    stalls: int = 0


class TransferReport(BaseModel):
    """One completed-or-partial optical transfer, as exported by the receiver page."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    source: str = Field(default="", exclude=True)  # report file stem, set by the loader
    started_at: str = Field(alias="startedAt")
    duration_seconds: float = Field(alias="durationSeconds")
    complete: bool = True
    progress: float = 1.0
    file_name: str = Field(alias="fileName")
    file_bytes: int = Field(alias="fileBytes")
    k: int
    frames_captured: int = Field(alias="framesCaptured")
    frames_decoded: int = Field(alias="framesDecoded")
    overhead: float
    hit_rate: float = Field(alias="hitRate")
    capture_fps: float = Field(alias="captureFps")
    goodput_kbs: float = Field(alias="goodputKBs")
    decode_workers: int = Field(alias="decodeWorkers")
    camera_resolution: str = Field(alias="cameraResolution")
    user_agent: str = Field(alias="userAgent")
    # Optional: older reports (before this field existed) omit it.
    bytes_per_frame: int | None = Field(default=None, alias="bytesPerFrame")
    # Protocol v2 reports (2026-10) add these; v1 reports load with the defaults.
    protocol_version: int | None = Field(default=None, alias="protocolVersion")
    session_id: int | None = Field(default=None, alias="sessionId")
    codes_per_frame: int = Field(default=1, alias="codesPerFrame")
    payload_bytes: int | None = Field(default=None, alias="payloadBytes")
    catch_rate: float | None = Field(default=None, alias="catchRate")
    seq_span: int | None = Field(default=None, alias="seqSpan")
    frames_duplicate: int | None = Field(default=None, alias="framesDuplicate")
    frames_redundant: int | None = Field(default=None, alias="framesRedundant")
    acquisition_seconds: float | None = Field(default=None, alias="acquisitionSeconds")
    # Since 2026-10-31: experiment knobs (?tag=, ?fps=, ?decode=) and what the camera delivered.
    camera_fps: float | None = Field(default=None, alias="cameraFps")
    decode_resolution: str | None = Field(default=None, alias="decodeResolution")
    tag: str = ""
    sender: SenderSettings | None = None

    @property
    def unique_qr_per_second(self) -> float:
        """Distinct QRs actually read per second — the real forward progress rate."""
        return self.frames_decoded / self.duration_seconds if self.duration_seconds else 0.0

    @property
    def device(self) -> str:
        """A short label like 'Android 10 - Chrome 153' from the user agent."""
        os_match = _OS.search(self.user_agent)
        br_match = _BROWSER.search(self.user_agent)
        os_label = os_match.group(0) if os_match else "?"
        br_label = f"{br_match.group(1)} {br_match.group(2)}" if br_match else "?"
        return f"{os_label} - {br_label}"

    @property
    def device_family(self) -> str:
        """'iPhone', 'Android' or '?' — the grouping used in tables and charts."""
        if "iPhone" in self.user_agent:
            return "iPhone"
        return "Android" if "Android" in self.user_agent else "?"

    @property
    def block_len(self) -> int | None:
        """Fountain bytes per code (QR capacity minus the frame header)."""
        return self.bytes_per_frame - FRAME_HEADER_LENGTH if self.bytes_per_frame else None

    @property
    def display_fps(self) -> float | None:
        """Codes swapped per second on screen: true refresh / whole vsyncs per frame."""
        if not self.sender:
            return None
        vsyncs = max(1, round(self.sender.refresh_hz / self.sender.display_fps))
        return snap_refresh(self.sender.refresh_hz) / vsyncs

    @property
    def gross_kbs(self) -> float | None:
        """What the screen offers: display fps x codes per frame x bytes per code."""
        if self.display_fps is None or self.block_len is None:
            return None
        return self.display_fps * self.codes_per_frame * self.block_len / 1024

    @property
    def model_goodput_kbs(self) -> float | None:
        """Goodput model: offered rate x catch rate / fountain overhead."""
        if self.gross_kbs is None or self.catch_rate is None:
            return None
        return self.gross_kbs * self.catch_rate / self.overhead

    @property
    def payload_goodput_kbs(self) -> float:
        """Fountain payload (container after gzip) per second — what the model predicts."""
        if not self.payload_bytes or not self.duration_seconds:
            return self.goodput_kbs
        return self.payload_bytes / self.duration_seconds / 1024

    @property
    def phase_locked(self) -> bool:
        """Camera and screen at (almost) the same rate: catch depends on a slowly drifting phase."""
        return self.display_fps is not None and abs(self.capture_fps - self.display_fps) / self.display_fps < 0.03

    @property
    def transition_window_ms(self) -> float | None:
        """W in catch = (T_display - W) / T_capture: time around each swap in which a capture is lost."""
        if self.display_fps is None or self.catch_rate is None or self.phase_locked or self.catch_rate >= 0.95:
            return None
        if self.codes_per_frame > 1:  # several codes per capture: resolution, not timing, dominates
            return None
        return 1000 / self.display_fps - self.catch_rate * 1000 / self.capture_fps

    @property
    def codes_per_capture(self) -> float:
        """Distinct codes read per captured frame (out of codes_per_frame on screen)."""
        return self.frames_decoded / self.frames_captured if self.frames_captured else 0.0

    @property
    def latency_dominated(self) -> bool:
        """Tiny files finish in a frame or two: their 'goodput' measures nothing."""
        return self.k < 20

    @property
    def total_seconds(self) -> float:
        """Camera start to verified file: acquisition + transfer."""
        return (self.acquisition_seconds or 0.0) + self.duration_seconds

    @property
    def label(self) -> str:
        """Short configuration label, e.g. 'iPhone v36 30 fps x1'."""
        if not self.sender:
            return f"{self.device_family} v1 (baseline)"
        fps = self.display_fps or self.sender.display_fps
        return f"{self.device_family} v{self.sender.qr_version} {fps:.0f} fps x{self.codes_per_frame}"
