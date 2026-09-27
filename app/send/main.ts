import { FRAME_HEADER_LENGTH } from "../shared/protocol.js";
import type { FileContainer } from "../shared/container.js";
import { type ErrorCorrectionLevel, QrCodec } from "../shared/patterns/qr-codec.js";
import { Transmitter } from "../shared/session.js";

const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const fpsInput = document.querySelector<HTMLInputElement>("#fps")!;
const densitySelect = document.querySelector<HTMLSelectElement>("#density")!;
const eccSelect = document.querySelector<HTMLSelectElement>("#ecc")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen")!;
const screen = document.querySelector<HTMLCanvasElement>("#screen")!;
const statusBox = document.querySelector<HTMLPreElement>("#status")!;
const context = screen.getContext("2d")!;

let timer: number | undefined;

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

async function start(): Promise<void> {
  if (timer !== undefined) window.clearInterval(timer);

  const fps = Math.min(30, Math.max(1, Number(fpsInput.value) || 15));
  const bytesPerFrame = Number(densitySelect.value);
  const codec = new QrCodec({ bytesPerFrame, errorCorrectionLevel: eccSelect.value as ErrorCorrectionLevel });

  const file = await readSelectedFile();
  const transmitter = await Transmitter.forFile(codec, file);

  const first = transmitter.render(0);
  screen.width = first.width;
  screen.height = first.height;

  const payloadPerFrame = bytesPerFrame - FRAME_HEADER_LENGTH;
  const grossKbPerSecond = (payloadPerFrame * fps) / 1024;

  let seq = 0;
  timer = window.setInterval(() => {
    const image = transmitter.render(seq);
    context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
    statusBox.textContent =
      `transmitindo • ${file.filename} (${file.payload.length} B) • K=${transmitter.k} • ` +
      `${payloadPerFrame} B/frame × ${fps} fps ≈ ${grossKbPerSecond.toFixed(1)} KB/s bruto • frame #${seq}`;
    seq++;
  }, Math.round(1000 / fps));
}

startButton.addEventListener("click", () => void start());

// Fullscreen makes each QR module physically larger, so a phone camera locks
// focus from a comfortable distance and reads denser frames.
fullscreenButton.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void screen.requestFullscreen();
});
