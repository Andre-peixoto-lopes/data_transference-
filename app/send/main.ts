import type { FileContainer } from "../shared/container.js";
import { postDiagnostics, reportingKey } from "../shared/diagnostics.js";
import type { PatternImage } from "../shared/pattern-codec.js";
import {
  DEFAULT_QR_VERSION,
  type ErrorCorrectionLevel,
  QR_VERSIONS,
  QrCodec,
  qrByteCapacity,
} from "../shared/patterns/qr-codec.js";
import { createPrng } from "../shared/prng.js";
import { Transmitter } from "../shared/session.js";
import { ScreenWakeLock } from "../shared/wake-lock.js";

const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const fpsInput = document.querySelector<HTMLInputElement>("#fps")!;
const versionSelect = document.querySelector<HTMLSelectElement>("#version")!;
const eccSelect = document.querySelector<HTMLSelectElement>("#ecc")!;
const codesSelect = document.querySelector<HTMLSelectElement>("#codes")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const benchmarkButton = document.querySelector<HTMLButtonElement>("#benchmark")!;
const fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen")!;
const screen = document.querySelector<HTMLCanvasElement>("#screen")!;
const statusBox = document.querySelector<HTMLPreElement>("#status")!;
const context = screen.getContext("2d")!;

// The frame is rendered at 1 px per module, then upscaled by a whole number onto
// the visible canvas: every module gets the same width, so none blurs.
const source = document.createElement("canvas");
source.width = 0; // no frame yet (resize/fullscreen handlers check this)
const sourceContext = source.getContext("2d")!;
const wakeLock = new ScreenWakeLock();
const REPORT_KEY = reportingKey(import.meta.env.DEV);
let generation = 0; // bumps on every start; stale display loops see the change and stop

/** Deterministic 1 MB payload — the canonical, reproducible benchmark input. */
function benchmarkFile(): FileContainer {
  const payload = new Uint8Array(1024 * 1024);
  const prng = createPrng(0xfa401234);
  for (let i = 0; i < payload.length; i++) payload[i] = Math.floor(prng() * 256);
  return { filename: "benchmark-1mb.bin", mediaType: "application/octet-stream", payload };
}

async function readSelectedFile(): Promise<FileContainer> {
  const file = fileInput.files?.[0];
  if (!file) {
    const payload = new TextEncoder().encode("Farol — arquivo de teste transmitido por luz.\n".repeat(6));
    return { filename: "amostra.txt", mediaType: "text/plain", payload };
  }
  return {
    filename: file.name,
    mediaType: file.type || "application/octet-stream",
    payload: new Uint8Array(await file.arrayBuffer()),
  };
}

/** Capacity depends on version AND ECC, so the labels follow the ECC choice. */
function populateVersions(): void {
  const ecc = eccSelect.value as ErrorCorrectionLevel;
  const selected = Number(versionSelect.value) || DEFAULT_QR_VERSION;
  versionSelect.textContent = "";
  for (const version of QR_VERSIONS) {
    const option = document.createElement("option");
    option.value = String(version);
    option.textContent = `QR v${version} — ${qrByteCapacity(version, ecc)} B/código`;
    option.selected = version === selected;
    versionSelect.append(option);
  }
}

/** Median requestAnimationFrame interval → the display's refresh rate (60 Hz if rAF is not ticking). */
function measureRefreshHz(): Promise<number> {
  return new Promise((resolveHz) => {
    const stamps: number[] = [];
    const fallback = setTimeout(() => resolveHz(60), 1000);
    const step = (now: number): void => {
      stamps.push(now);
      if (stamps.length < 21) {
        requestAnimationFrame(step);
        return;
      }
      clearTimeout(fallback);
      const deltas = stamps.slice(1).map((stamp, i) => stamp - stamps[i]).sort((a, b) => a - b);
      // Mean of the steady deltas: a median of 0.1 ms-coarsened timestamps reads 120 Hz as 120.48.
      const steady = deltas.filter((delta) => delta < deltas[deltas.length >> 1] * 1.5);
      const hz = (1000 * steady.length) / steady.reduce((sum, delta) => sum + delta, 0);
      resolveHz(hz >= 30 && hz <= 250 ? hz : 60); // hidden/throttled pages tick irregularly
    };
    requestAnimationFrame(step);
  });
}

function fitCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const box = screen.getBoundingClientRect();
  screen.width = Math.max(1, Math.round(box.width * dpr));
  screen.height = Math.max(1, Math.round(box.height * dpr));
}

function present(): void {
  const scale = Math.max(1, Math.floor(Math.min(screen.width / source.width, screen.height / source.height)));
  const width = source.width * scale;
  const height = source.height * scale;
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, screen.width, screen.height);
  context.drawImage(source, (screen.width - width) >> 1, (screen.height - height) >> 1, width, height);
}

function show(image: PatternImage): void {
  if (source.width !== image.width || source.height !== image.height) {
    source.width = image.width;
    source.height = image.height;
    screen.style.aspectRatio = `${image.width} / ${image.height}`;
    fitCanvas();
  }
  sourceContext.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  present();
}

async function start(override?: FileContainer): Promise<void> {
  const run = ++generation;
  statusBox.textContent = "preparando…";
  try {
    const targetFps = Math.min(60, Math.max(1, Number(fpsInput.value) || 24));
    const version = Number(versionSelect.value);
    const ecc = eccSelect.value as ErrorCorrectionLevel;
    const codes = Number(codesSelect.value);
    const codec = new QrCodec({ version, errorCorrectionLevel: ecc, scale: 1 });
    const file = override ?? (await readSelectedFile());
    const transmitter = await Transmitter.forFile(codec, file, { codes });
    const refreshHz = await measureRefreshHz();
    if (run !== generation) return; // a newer start took over

    // Hold every frame for the same whole number of refreshes: no 2-3-2-3 cadence
    // (24 fps on 60 Hz), which leaves the camera more half-swapped captures.
    const vsyncsPerFrame = Math.max(1, Math.round(refreshHz / targetFps));
    const displayFps = refreshHz / vsyncsPerFrame;
    const grossKBs = (transmitter.blockLen * codes * displayFps) / 1024;
    const summary =
      `${file.filename} (${file.payload.length} B) • K=${transmitter.k} • QR v${version}-${ecc} × ${codes} • ` +
      `${displayFps.toFixed(1)} fps (${refreshHz.toFixed(0)} Hz ÷ ${vsyncsPerFrame}) ≈ ${grossKBs.toFixed(1)} KB/s bruto`;

    show(transmitter.renderFrame(0));
    void wakeLock.acquire();
    if (REPORT_KEY !== null) {
      void postDiagnostics(
        {
          kind: "sender-announce",
          announcement: {
            sessionId: transmitter.sessionId,
            fileName: file.filename,
            fileBytes: file.payload.length,
            payloadBytes: transmitter.payloadBytes,
            k: transmitter.k,
            qrVersion: version,
            ecc,
            codes,
            targetFps,
            displayFps,
            refreshHz,
            userAgent: navigator.userAgent,
          },
        },
        REPORT_KEY,
      );
    }

    let frameIndex = 0;
    let vsync = 0;
    let lastVsyncAt = 0;
    let next: { index: number; image: PatternImage } | null = null;
    const prepareNext = (): void => {
      if (run === generation) next = { index: frameIndex + 1, image: transmitter.renderFrame(frameIndex + 1) };
    };
    setTimeout(prepareNext, 0);

    const onVsync = (now: number): void => {
      if (run !== generation) return;
      if (REPORT_KEY !== null && document.visibilityState === "visible" && lastVsyncAt > 0 && now - lastVsyncAt > 1000) {
        const seconds = (now - lastVsyncAt) / 1000;
        void postDiagnostics({ kind: "sender-stall", sessionId: transmitter.sessionId, seconds }, REPORT_KEY);
      }
      lastVsyncAt = now;
      if (++vsync >= vsyncsPerFrame) {
        vsync = 0;
        frameIndex++;
        show(next?.index === frameIndex ? next.image : transmitter.renderFrame(frameIndex));
        next = null;
        setTimeout(prepareNext, 0); // render the following frame off the vsync callback
        if (frameIndex % 10 === 0) statusBox.textContent = `transmitindo • ${summary} • quadro #${frameIndex}`;
      }
      requestAnimationFrame(onVsync);
    };
    requestAnimationFrame(onVsync);
    statusBox.textContent = `transmitindo • ${summary}`;
  } catch (error) {
    if (run === generation) statusBox.textContent = `não foi possível transmitir: ${(error as Error).message}`;
  }
}

populateVersions();
eccSelect.addEventListener("change", populateVersions);
startButton.addEventListener("click", () => void start());
benchmarkButton.addEventListener("click", () => void start(benchmarkFile()));

// Fullscreen makes each QR module physically larger, so a phone camera locks
// focus from a comfortable distance and reads denser frames.
fullscreenButton.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void screen.requestFullscreen();
});
for (const event of ["resize", "fullscreenchange"]) {
  window.addEventListener(event, () => {
    if (source.width === 0) return;
    fitCanvas();
    present();
  });
}
