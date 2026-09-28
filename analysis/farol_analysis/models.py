"""Pydantic model mirroring the receiver's TransferReport (app/shared/telemetry.ts)."""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field

_OS = re.compile(r"Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+|Linux")
_BROWSER = re.compile(r"(Edg|Chrome|Firefox|Version)/(\d+)")


class TransferReport(BaseModel):
    """One completed-or-partial optical transfer, as exported by the receiver page."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

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
