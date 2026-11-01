import { toArrayBufferBytes } from "../shared/bytes.js";
import type { FileContainer } from "../shared/container.js";
import { postDiagnostics, reportingKey } from "../shared/diagnostics.js";
import { FRAME_HEADER_LENGTH, PROTOCOL_VERSION } from "../shared/protocol.js";
import { Receiver } from "../shared/session.js";
import { downloadReport, type TransferReport } from "../shared/telemetry.js";
import { ScreenWakeLock } from "../shared/wake-lock.js";
import type { DecodeRequest, DecodeResponse } from "./decode-worker.js";

const MAX_DECODE_WIDTH = 1280; // downscale camera frames before decode; higher resolves denser QRs
const POOL_SIZE = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)); // parallel decoders

// Experiment knobs (docs/ROTEIRO-TESTES.md), all recorded in the report: ?tag=…&fps=60&res=720&decode=1280
const params = new URLSearchParams(location.search);
const RUN_TAG = (params.get("tag") ?? "").replace(/[^\w.-]/g, "").slice(0, 64);
const CAMERA_FPS = intParam("fps", 15, 120);
const CAMERA_HEIGHT = intParam("res", 480, 2160);
const MAX_DECODE_SIDE = intParam("decode", 320, 4096);
const REPORT_KEY = reportingKey(import.meta.env.DEV);

function intParam(name: string, min: number, max: number): number | undefined {
  const value = Number(params.get(name));
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

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
let generation = 0; // bumps on every (re)start; capture loops of an older run stop themselves
let currentStream: MediaStream | null = null;
const CAMERA_STORAGE_KEY = "farol.cameraId";
const wakeLock = new ScreenWakeLock();

// Decode worker pool: zxing-wasm off the main thread, several frames in parallel.
const workers: Worker[] = [];
const workerBusy: boolean[] = [];
let nextFrameId = 0;
const inFlight = new Map<number, { readonly run: number; readonly index: number; readonly at: number }>();

// Telemetry: whole-transfer counters (report) + a sliding window (live status line).
let totalCaptured = 0;
let capturesAtLock = 0;
let cameraStartedAt = 0;
let lockedAt = 0;
let lockedSession = -1;
let startedAtISO = "";
let cameraResolution = "?";
let cameraFps = 0;
let winFrames = 0;
let winSymbols = 0;
let winStart = 0;

function resetMeasurement(): void {
  receiver = new Receiver();
  totalCaptured = 0;
  capturesAtLock = 0;
  cameraStartedAt = performance.now();
  lockedAt = 0;
  lockedSession = -1;
  startedAtISO = "";
  winFrames = 0;
  winSymbols = 0;
  winStart = 0;
}

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
  const height = CAMERA_HEIGHT ?? 1080;
  const constraints: MediaTrackConstraints = {
    width: { ideal: Math.round((height * 16) / 9) },
    height: { ideal: height },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
  };
  if (CAMERA_FPS) {
    // iOS answers an `ideal` rate above 30 with 30; demanding it exactly gets the mode when it exists.
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { ...constraints, frameRate: { exact: CAMERA_FPS } } });
    } catch {
      /* no such mode at this resolution: fall back to the closest rate */
    }
  }
  return navigator.mediaDevices.getUserMedia({ video: { ...constraints, frameRate: { ideal: CAMERA_FPS ?? 30 } } });
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
    resetMeasurement();
    workerBusy.fill(false);
    cameraResolution = `${settings.width ?? "?"}x${settings.height ?? "?"}`;
    cameraFps = settings.frameRate ?? 0;
    resultBox.innerHTML = "";
    progress.value = 0;
    reportButton.hidden = false;
    void wakeLock.acquire();

    streaming = true;
    statusBox.textContent =
      `câmera ${cameraResolution} @ ${cameraFps.toFixed(0)} fps${tuned.length ? " • " + tuned.join(", ") : ""} • ` +
      `${POOL_SIZE} workers${RUN_TAG ? ` • ${RUN_TAG}` : ""} — aponte para a tela e mantenha ~20-30 cm (afaste se embaçar).`;
    scheduleNext(++generation);
  } catch (error) {
    if (deviceId) localStorage.removeItem(CAMERA_STORAGE_KEY); // stale id — reprobe next time
    startButton.disabled = false;
    statusBox.textContent = `não foi possível abrir a câmera: ${(error as Error).message}`;
  }
}

/**
 * Prefer per-video-frame callbacks (Chrome Android) over rAF: no wasted decodes.
 * rVFC chains outlive a camera switch, so each one carries the run it belongs to.
 */
function scheduleNext(run: number): void {
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?(cb: () => void): number };
  if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(() => tick(run));
  else requestAnimationFrame(() => tick(run));
}

/** Captures a frame and hands it to a free worker; skips capture under backpressure. */
function tick(run: number): void {
  if (!streaming || run !== generation) return;
  const free = workerBusy.indexOf(false);
  if (free !== -1 && video.readyState >= 2 && video.videoWidth > 0) {
    const scale = MAX_DECODE_SIDE
      ? Math.min(1, MAX_DECODE_SIDE / Math.max(video.videoWidth, video.videoHeight))
      : Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
    work.width = Math.round(video.videoWidth * scale);
    work.height = Math.round(video.videoHeight * scale);
    workContext.drawImage(video, 0, 0, work.width, work.height);
    const frame = workContext.getImageData(0, 0, work.width, work.height);

    totalCaptured++;
    winFrames++;
    workerBusy[free] = true;
    const id = nextFrameId++;
    inFlight.set(id, { run, index: totalCaptured, at: performance.now() });
    const request: DecodeRequest = {
      id,
      width: frame.width,
      height: frame.height,
      buffer: frame.data.buffer,
      maxSymbols: receiver.progress().codes,
    };
    workers[free].postMessage(request, [frame.data.buffer]);
  }
  scheduleNext(run);
}

/** Handles a worker's decode result: feeds every code it read to the fountain. */
function onDecoded(workerIndex: number, response: DecodeResponse): void {
  workerBusy[workerIndex] = false;
  const capture = inFlight.get(response.id);
  inFlight.delete(response.id);
  if (!streaming || !capture || capture.run !== generation) return; // decode of a previous run
  for (const payload of response.payloads) {
    const before = receiver.progress().framesDecoded;
    const complete = receiver.offerBytes(payload);
    const info = receiver.progress();
    if (info.framesDecoded > before) winSymbols++;
    if (info.locked && info.sessionId !== lockedSession) {
      // Measure from the capture that locked, not its decode: the first decodes also wait for wasm to compile.
      lockedSession = info.sessionId;
      lockedAt = capture.at;
      capturesAtLock = capture.index - 1;
      startedAtISO = new Date(performance.timeOrigin + capture.at).toISOString();
    }
    progress.value = info.progress;
    if (complete) {
      void finish();
      return;
    }
  }
  report();
}

/** Updates the live status line ~2x/second (camera fps, codes read, catch rate, KB/s, ETA). */
function report(): void {
  const now = performance.now();
  if (winStart === 0) winStart = now;
  const dt = (now - winStart) / 1000;
  if (dt < 0.5) return; // ~2 updates/second

  const info = receiver.progress();
  const capFps = winFrames / dt;
  const readFps = winSymbols / dt;
  const hitRate = winFrames > 0 ? (winSymbols / (winFrames * info.codes)) * 100 : 0;
  winFrames = 0;
  winSymbols = 0;
  winStart = now;

  if (!info.locked) {
    const incompatible = receiver.incompatible;
    statusBox.textContent = incompatible
      ? incompatible.reason === "version"
        ? `emissor Farol de protocolo v${incompatible.value}; este receptor lê v${PROTOCOL_VERSION} — recarregue as duas páginas.`
        : "emissor Farol usa um recurso que este receptor não conhece — recarregue as duas páginas."
      : `procurando frames Farol… • câmera ${capFps.toFixed(0)} fps`;
    return;
  }

  const bytesDone = info.progress * info.totalLen;
  const rate = lockedAt > 0 ? bytesDone / Math.max((now - lockedAt) / 1000, 0.001) : 0;
  const eta = rate > 0 ? (info.totalLen - bytesDone) / rate : Infinity;
  const catchRate = info.seqSpan > 0 ? (info.framesDecoded / info.seqSpan) * 100 : 0;
  statusBox.textContent =
    `recebendo ${Math.round(info.progress * 100)}% • K=${info.k}${info.codes > 1 ? ` • ${info.codes} códigos/quadro` : ""} • ` +
    `câmera ${capFps.toFixed(0)} fps → ${readFps.toFixed(0)} códigos/s (${hitRate.toFixed(0)}%) • catch ${catchRate.toFixed(0)}% • ` +
    `${(rate / 1024).toFixed(1)} KB/s • ETA ${Number.isFinite(eta) ? Math.ceil(eta) + "s" : "—"}`;
}

/** Snapshots the current transfer state into a report — works mid-transfer too. */
function buildReport(fileName: string, fileBytes: number, complete: boolean): TransferReport {
  const info = receiver.progress();
  const durationSeconds = lockedAt > 0 ? (performance.now() - lockedAt) / 1000 : 0;
  const framesCaptured = totalCaptured - capturesAtLock;
  const deliveredBytes = complete ? fileBytes : info.progress * info.totalLen;
  return {
    startedAt: startedAtISO || new Date().toISOString(),
    durationSeconds,
    complete,
    progress: complete ? 1 : info.progress,
    fileName,
    fileBytes,
    k: info.k,
    framesCaptured,
    framesDecoded: info.framesDecoded,
    overhead: info.framesDecoded / Math.max(1, info.k),
    hitRate: info.framesDecoded / Math.max(1, framesCaptured * info.codes),
    captureFps: framesCaptured / Math.max(0.001, durationSeconds),
    goodputKBs: deliveredBytes / 1024 / Math.max(0.001, durationSeconds),
    bytesPerFrame: info.blockLen > 0 ? info.blockLen + FRAME_HEADER_LENGTH : 0,
    decodeWorkers: POOL_SIZE,
    cameraResolution,
    userAgent: navigator.userAgent,
    protocolVersion: PROTOCOL_VERSION,
    sessionId: info.sessionId,
    codesPerFrame: info.codes,
    payloadBytes: info.totalLen,
    framesDuplicate: info.framesDuplicate,
    framesRedundant: info.framesRedundant,
    seqSpan: info.seqSpan,
    catchRate: info.seqSpan > 0 ? info.framesDecoded / info.seqSpan : 0,
    acquisitionSeconds: lockedAt > 0 ? (lockedAt - cameraStartedAt) / 1000 : 0,
    cameraFps,
    decodeResolution: `${work.width}x${work.height}`,
    tag: RUN_TAG,
  };
}

/** Collector reachable (dev server, or the deployed site with this device's key): report goes to analysis. Otherwise: download. */
async function deliverReport(transferReport: TransferReport): Promise<void> {
  if (REPORT_KEY !== null && (await postDiagnostics({ kind: "receiver-report", report: transferReport }, REPORT_KEY))) return;
  downloadReport(transferReport);
}

async function finish(): Promise<void> {
  streaming = false;
  let file: FileContainer;
  try {
    file = await receiver.result();
  } catch (error) {
    // A corrupt reconstruction never reaches the user: start over on the same camera stream.
    statusBox.textContent = `verificação falhou (${(error as Error).message}) — recomeçando a recepção…`;
    resetMeasurement();
    progress.value = 0;
    streaming = true;
    scheduleNext(++generation);
    return;
  }
  stopStream();
  wakeLock.release();
  reportButton.hidden = true; // the result box links the final report

  const transferReport = buildReport(file.filename, file.payload.length, true);
  void deliverReport(transferReport);

  // The filename and media type arrive over the air (untrusted): text nodes only, never innerHTML,
  // and an inert blob type so an "open in new tab" cannot render active content (HTML/SVG) in this origin.
  const url = URL.createObjectURL(new Blob([toArrayBufferBytes(file.payload)], { type: "application/octet-stream" }));
  const verified = document.createElement("p");
  verified.append(Object.assign(document.createElement("strong"), { textContent: "SHA-256 OK" }), " — arquivo reconstruído bit-a-bit.");
  const stats = document.createElement("p");
  stats.textContent =
    `${file.filename} • ${file.payload.length} bytes • ${transferReport.goodputKBs.toFixed(1)} KB/s • ` +
    `catch ${(transferReport.catchRate * 100).toFixed(0)}% • overhead ${transferReport.overhead.toFixed(2)}x • ` +
    `${transferReport.codesPerFrame} código(s)/quadro • ${POOL_SIZE} workers`;
  const download = Object.assign(document.createElement("a"), { href: url, download: file.filename, textContent: "Baixar arquivo" });
  const reportLink = Object.assign(document.createElement("a"), { href: "#", textContent: "Baixar relatório (JSON)" });
  reportLink.addEventListener("click", (event) => {
    event.preventDefault();
    downloadReport(transferReport);
  });
  resultBox.replaceChildren(verified, stats, download, " · ", reportLink);
  statusBox.textContent = `concluído • ${transferReport.goodputKBs.toFixed(1)} KB/s • ${transferReport.durationSeconds.toFixed(1)}s`;
}

startButton.addEventListener("click", () => void start());
cameraSelect.addEventListener("change", () => void start(cameraSelect.value));
reportButton.addEventListener("click", () => {
  if (receiver.isComplete) return; // finish() already delivered the final report
  void deliverReport(buildReport("(parcial)", 0, false));
});
