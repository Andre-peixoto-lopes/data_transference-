import { toArrayBufferBytes } from "../shared/bytes.js";
import { FRAME_HEADER_LENGTH } from "../shared/protocol.js";
import { Receiver } from "../shared/session.js";
import { downloadReport, type TransferReport } from "../shared/telemetry.js";
import type { DecodeRequest, DecodeResponse } from "./decode-worker.js";

const MAX_DECODE_WIDTH = 1280; // downscale camera frames before decode; higher resolves denser QRs
const POOL_SIZE = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)); // parallel decoders

const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const cameraSelect = document.querySelector<HTMLSelectElement>("#cameraSelect")!;
const reportButton = document.querySelector<HTMLButtonElement>("#report")!;
const video = document.querySelector<HTMLVideoElement>("#camera")!;
const progress = document.querySelector<HTMLProgressElement>("#prog")!;
const statusBox = document.querySelector<HTMLPreElement>("#status")!;
const resultBox = document.querySelector<HTMLDivElement>("#result")!;

const work = document.createElement("canvas");
const workContext = work.getContext("2d", { willReadFrequently: true })!;
let receiver = new Receiver();
let streaming = false;
let currentStream: MediaStream | null = null;
const CAMERA_STORAGE_KEY = "farol.cameraId";

// Decode worker pool: zxing-wasm off the main thread, several frames in parallel.
const workers: Worker[] = [];
const workerBusy: boolean[] = [];
let nextFrameId = 0;

// Telemetry: whole-transfer counters (report) + a sliding window (live status line).
let totalCaptured = 0;
let lockedAt = 0;
let startedAtISO = "";
let cameraResolution = "?";
let winFrames = 0;
let winSymbols = 0;
let winStart = 0;

function initPool(): void {
  if (workers.length > 0) return;
  for (let i = 0; i < POOL_SIZE; i++) {
    const worker = new Worker(new URL("./decode-worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<DecodeResponse>) => onDecoded(i, event.data));
    workers.push(worker);
    workerBusy.push(false);
  }
}

/** Best-effort: request continuous autofocus and high resolution when exposed. */
async function tuneCamera(track: MediaStreamTrack): Promise<string[]> {
  const applied: string[] = [];
  const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
  const advanced: Array<{ focusMode: string }> = [];
  if (caps?.focusMode?.includes("continuous")) {
    advanced.push({ focusMode: "continuous" });
    applied.push("foco contínuo");
  }
  if (advanced.length > 0) {
    try {
      await track.applyConstraints({ advanced } as unknown as MediaTrackConstraints);
    } catch {
      applied.length = 0; // device refused; keep default focus
    }
  }
  return applied;
}

function stopStream(): void {
  currentStream?.getTracks().forEach((track) => track.stop());
  currentStream = null;
}

function rearCameras(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const inputs = devices.filter((d) => d.kind === "videoinput");
  const rear = inputs.filter((d) => /back|rear|traseira|environment/i.test(d.label));
  return rear.length > 0 ? rear : inputs;
}

async function openCamera(deviceId?: string): Promise<MediaStream> {
  const constraints: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
  };
  return navigator.mediaDevices.getUserMedia({ video: constraints });
}

/** Probe rear cameras and keep the largest sensor — usually the main lens, best for reading a screen. */
async function bestRearCamera(): Promise<string | undefined> {
  const cams = rearCameras(await navigator.mediaDevices.enumerateDevices());
  let best: { id: string; area: number } | undefined;
  for (const cam of cams) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: cam.deviceId } } });
      const caps = (probe.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as MediaTrackCapabilities;
      const area = (caps.width?.max ?? 0) * (caps.height?.max ?? 0);
      probe.getTracks().forEach((t) => t.stop());
      if (!best || area > best.area) best = { id: cam.deviceId, area };
    } catch {
      /* skip cameras the OS refuses to open standalone */
    }
  }
  if (best) localStorage.setItem(CAMERA_STORAGE_KEY, best.id);
  return best?.id;
}

async function populateCameras(activeId: string | undefined): Promise<void> {
  const cams = rearCameras(await navigator.mediaDevices.enumerateDevices());
  cameraSelect.textContent = "";
  cams.forEach((cam, i) => {
    const option = document.createElement("option");
    option.value = cam.deviceId;
    option.textContent = cam.label || `Câmera ${i + 1}`;
    if (cam.deviceId === activeId) option.selected = true;
    cameraSelect.append(option);
  });
  cameraSelect.hidden = cams.length <= 1;
}

async function start(deviceId?: string): Promise<void> {
  startButton.disabled = true;
  try {
    stopStream();
    if (!deviceId) {
      deviceId = localStorage.getItem(CAMERA_STORAGE_KEY) ?? undefined;
      if (!deviceId) {
        currentStream = await openCamera(); // prompt for permission + unlock camera labels
        stopStream(); // release the device before probing each camera
        deviceId = await bestRearCamera();
      }
    }
    currentStream = await openCamera(deviceId);

    video.srcObject = currentStream;
    await video.play();

    const [track] = currentStream.getVideoTracks();
    const tuned = track ? await tuneCamera(track) : [];
    const settings = track?.getSettings() ?? {};
    if (settings.deviceId) localStorage.setItem(CAMERA_STORAGE_KEY, settings.deviceId);
    await populateCameras(settings.deviceId ?? deviceId);

    initPool();

    // Fresh receiver + counters, so every run is a clean measurement.
    receiver = new Receiver();
    totalCaptured = 0;
    lockedAt = 0;
    startedAtISO = "";
    winFrames = 0;
    winSymbols = 0;
    winStart = 0;
    workerBusy.fill(false);
    cameraResolution = `${settings.width ?? "?"}x${settings.height ?? "?"}`;
    resultBox.innerHTML = "";
    progress.value = 0;
    reportButton.hidden = false;

    streaming = true;
    statusBox.textContent =
      `câmera ${cameraResolution}${tuned.length ? " • " + tuned.join(", ") : ""} • ${POOL_SIZE} workers — ` +
      "aponte para a tela e mantenha ~20-30 cm (afaste se embaçar).";
    scheduleNext();
  } catch (error) {
    if (deviceId) localStorage.removeItem(CAMERA_STORAGE_KEY); // stale id — reprobe next time
    startButton.disabled = false;
    statusBox.textContent = `não foi possível abrir a câmera: ${(error as Error).message}`;
  }
}

/** Prefer per-video-frame callbacks (Chrome Android) over rAF: no wasted decodes. */
function scheduleNext(): void {
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?(cb: () => void): number };
  if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(() => tick());
  else requestAnimationFrame(tick);
}

/** Captures a frame and hands it to a free worker; skips capture under backpressure. */
function tick(): void {
  if (!streaming) return;
  const free = workerBusy.indexOf(false);
  if (free !== -1 && video.readyState >= 2 && video.videoWidth > 0) {
    const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
    work.width = Math.round(video.videoWidth * scale);
    work.height = Math.round(video.videoHeight * scale);
    workContext.drawImage(video, 0, 0, work.width, work.height);
    const frame = workContext.getImageData(0, 0, work.width, work.height);

    totalCaptured++;
    winFrames++;
    workerBusy[free] = true;
    const request: DecodeRequest = { id: nextFrameId++, width: frame.width, height: frame.height, buffer: frame.data.buffer };
    workers[free].postMessage(request, [frame.data.buffer]);
  }
  scheduleNext();
}

/** Handles a worker's decode result: feeds the fountain and updates telemetry. */
function onDecoded(workerIndex: number, response: DecodeResponse): void {
  workerBusy[workerIndex] = false;
  if (!streaming) return;
  if (response.bytes) {
    const before = receiver.progress().framesDecoded;
    const complete = receiver.offerBytes(response.bytes);
    const info = receiver.progress();
    if (info.framesDecoded > before) winSymbols++;
    if (info.locked && lockedAt === 0) {
      lockedAt = performance.now();
      startedAtISO = new Date().toISOString();
    }
    progress.value = info.progress;
    if (complete) {
      void finish();
      return;
    }
  }
  report();
}

/** Updates the live status line ~2x/second (camera fps, read rate, KB/s, ETA). */
function report(): void {
  const now = performance.now();
  if (winStart === 0) winStart = now;
  const dt = (now - winStart) / 1000;
  if (dt < 0.5) return; // ~2 updates/second

  const capFps = winFrames / dt;
  const readFps = winSymbols / dt;
  const hitRate = winFrames > 0 ? (winSymbols / winFrames) * 100 : 0;
  winFrames = 0;
  winSymbols = 0;
  winStart = now;

  const info = receiver.progress();
  if (!info.locked) {
    statusBox.textContent = `procurando frames Farol… • câmera ${capFps.toFixed(0)} fps • leitura ${hitRate.toFixed(0)}%`;
    return;
  }

  const bytesDone = info.progress * info.totalLen;
  const rate = lockedAt > 0 ? bytesDone / Math.max((now - lockedAt) / 1000, 0.001) : 0;
  const eta = rate > 0 ? (info.totalLen - bytesDone) / rate : Infinity;
  statusBox.textContent =
    `recebendo ${Math.round(info.progress * 100)}% • K=${info.k} • ` +
    `câmera ${capFps.toFixed(0)}→leitura ${readFps.toFixed(0)} fps (${hitRate.toFixed(0)}%) • ` +
    `${(rate / 1024).toFixed(1)} KB/s • ETA ${Number.isFinite(eta) ? Math.ceil(eta) + "s" : "—"}`;
}

/** Snapshots the current transfer state into a report — works mid-transfer too. */
function buildReport(fileName: string, fileBytes: number, complete: boolean): TransferReport {
  const info = receiver.progress();
  const durationSeconds = lockedAt > 0 ? (performance.now() - lockedAt) / 1000 : 0;
  return {
    startedAt: startedAtISO || new Date().toISOString(),
    durationSeconds,
    complete,
    progress: info.progress,
    fileName,
    fileBytes,
    k: info.k,
    framesCaptured: totalCaptured,
    framesDecoded: info.framesDecoded,
    overhead: info.framesDecoded / Math.max(1, info.k),
    hitRate: info.framesDecoded / Math.max(1, totalCaptured),
    captureFps: totalCaptured / Math.max(0.001, durationSeconds),
    goodputKBs: (info.progress * info.totalLen) / 1024 / Math.max(0.001, durationSeconds),
    bytesPerFrame: info.blockLen > 0 ? info.blockLen + FRAME_HEADER_LENGTH : 0,
    decodeWorkers: POOL_SIZE,
    cameraResolution,
    userAgent: navigator.userAgent,
  };
}

async function finish(): Promise<void> {
  streaming = false;
  stopStream();

  const file = await receiver.result();
  const transferReport = buildReport(file.filename, file.payload.length, true);
  downloadReport(transferReport); // auto-download the report on completion

  const url = URL.createObjectURL(new Blob([toArrayBufferBytes(file.payload)], { type: file.mediaType }));
  resultBox.innerHTML =
    `<p><strong>SHA-256 OK</strong> — arquivo reconstruído bit-a-bit.</p>` +
    `<p>${file.filename} • ${file.payload.length} bytes • <strong>${transferReport.goodputKBs.toFixed(1)} KB/s</strong> • ` +
    `hit ${(transferReport.hitRate * 100).toFixed(0)}% • overhead ${transferReport.overhead.toFixed(2)}x • ${POOL_SIZE} workers</p>` +
    `<a href="${url}" download="${file.filename}">Baixar arquivo</a> · ` +
    `<a href="#" id="dlreport">Baixar relatório (JSON)</a>`;
  document.querySelector<HTMLAnchorElement>("#dlreport")?.addEventListener("click", (event) => {
    event.preventDefault();
    downloadReport(transferReport);
  });
  statusBox.textContent = `concluído • ${transferReport.goodputKBs.toFixed(1)} KB/s • ${transferReport.durationSeconds.toFixed(1)}s`;
}

startButton.addEventListener("click", () => void start());
cameraSelect.addEventListener("change", () => void start(cameraSelect.value));
reportButton.addEventListener("click", () => {
  const info = receiver.progress();
  downloadReport(buildReport(info.progress >= 1 ? "farol" : "(parcial)", 0, info.progress >= 1));
});
