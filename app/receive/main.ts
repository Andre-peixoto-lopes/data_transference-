import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { toArrayBufferBytes } from "../shared/bytes.js";
import { Receiver, type ReceiverProgress } from "../shared/session.js";

// Decode with zxing-wasm (WASM, fast, robust) as decimen does; jsQR stays as the
// codec's reference decoder for tests. Serve the wasm from our own origin (offline-safe).
const zxingReady = prepareZXingModule({ overrides: { locateFile: () => zxingWasmUrl }, fireImmediately: true });
const READER_OPTIONS: ReaderOptions = { formats: ["QRCode"], tryHarder: false, maxNumberOfSymbols: 1 };
const MAX_DECODE_WIDTH = 1280; // downscale camera frames before decode; higher resolves denser QRs

const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const cameraSelect = document.querySelector<HTMLSelectElement>("#cameraSelect")!;
const video = document.querySelector<HTMLVideoElement>("#camera")!;
const progress = document.querySelector<HTMLProgressElement>("#prog")!;
const statusBox = document.querySelector<HTMLPreElement>("#status")!;
const resultBox = document.querySelector<HTMLDivElement>("#result")!;

const work = document.createElement("canvas");
const workContext = work.getContext("2d", { willReadFrequently: true })!;
const receiver = new Receiver();
let streaming = false;
let currentStream: MediaStream | null = null;
const CAMERA_STORAGE_KEY = "farol.cameraId";

// Live telemetry, reported ~2x/second so the optical link can be tuned by eye.
let winFrames = 0; // camera frames processed in the current window
let winSymbols = 0; // frames that carried a valid Farol symbol (in-focus + decoded)
let winStart = 0;
let sessionStart = 0;

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

    statusBox.textContent = "carregando decodificador…";
    await zxingReady; // load the decoder wasm before the first frame

    streaming = true;
    winFrames = 0;
    winSymbols = 0;
    winStart = 0;
    sessionStart = 0;
    statusBox.textContent =
      `câmera ${settings.width ?? "?"}×${settings.height ?? "?"}${tuned.length ? " • " + tuned.join(", ") : ""} — ` +
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

function tick(): void {
  if (!streaming) return;
  if (video.readyState >= 2 && video.videoWidth > 0) {
    const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
    work.width = Math.round(video.videoWidth * scale);
    work.height = Math.round(video.videoHeight * scale);
    workContext.drawImage(video, 0, 0, work.width, work.height);
    const frame = workContext.getImageData(0, 0, work.width, work.height);

    winFrames++;
    void decodeFrame(frame);
    return; // decodeFrame schedules the next tick when it settles
  }
  scheduleNext();
}

/** Decodes one captured frame with zxing-wasm and feeds any Farol symbol to the fountain. */
async function decodeFrame(frame: ImageData): Promise<void> {
  try {
    const results = await readBarcodes(frame, READER_OPTIONS);
    const hit = results.find((r) => r.isValid && r.bytes.length > 0);
    if (hit) {
      const before = receiver.progress().framesDecoded;
      const complete = receiver.offerBytes(hit.bytes);
      if (receiver.progress().framesDecoded > before) winSymbols++;
      progress.value = receiver.progress().progress;
      if (complete) {
        void finish();
        return;
      }
    }
  } catch {
    /* undecodable frame — the fountain absorbs the loss */
  }
  report(receiver.progress());
  scheduleNext();
}

/** Turns raw counters into camera fps, read rate, effective KB/s and ETA. */
function report(info: ReceiverProgress): void {
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

  if (!info.locked) {
    statusBox.textContent =
      `procurando frames Farol… • câmera ${capFps.toFixed(0)} fps • leitura ${hitRate.toFixed(0)}%`;
    return;
  }

  if (sessionStart === 0) sessionStart = now; // time throughput from the moment the stream locks
  const bytesDone = info.progress * info.totalLen;
  const rate = bytesDone / Math.max((now - sessionStart) / 1000, 0.001);
  const eta = rate > 0 ? (info.totalLen - bytesDone) / rate : Infinity;
  statusBox.textContent =
    `recebendo ${Math.round(info.progress * 100)}% • K=${info.k} • ` +
    `câmera ${capFps.toFixed(0)}→leitura ${readFps.toFixed(0)} fps (${hitRate.toFixed(0)}%) • ` +
    `${(rate / 1024).toFixed(1)} KB/s • ETA ${Number.isFinite(eta) ? Math.ceil(eta) + "s" : "—"}`;
}

async function finish(): Promise<void> {
  streaming = false;
  stopStream();

  const file = await receiver.result();
  const url = URL.createObjectURL(new Blob([toArrayBufferBytes(file.payload)], { type: file.mediaType }));
  resultBox.innerHTML =
    `<p><strong>SHA-256 OK</strong> — arquivo reconstruído bit-a-bit.</p>` +
    `<p>${file.filename} • ${file.payload.length} bytes</p>` +
    `<a href="${url}" download="${file.filename}">Baixar arquivo recebido</a>`;
  statusBox.textContent = "concluído.";
}

startButton.addEventListener("click", () => void start());
cameraSelect.addEventListener("change", () => void start(cameraSelect.value));
