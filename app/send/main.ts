import type { FileContainer } from "../shared/container.js";
import { QrCodec } from "../shared/patterns/qr-codec.js";
import { Transmitter } from "../shared/session.js";

const codec = new QrCodec();
const FRAMES_PER_SECOND = 10;

const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
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
  const transmitter = await Transmitter.forFile(codec, await readSelectedFile());

  const first = transmitter.render(0);
  screen.width = first.width;
  screen.height = first.height;

  let seq = 0;
  timer = window.setInterval(() => {
    const image = transmitter.render(seq);
    context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
    statusBox.textContent = `transmitindo • K=${transmitter.k} blocos • frame #${seq} • ${FRAMES_PER_SECOND} fps`;
    seq++;
  }, Math.round(1000 / FRAMES_PER_SECOND));
}

startButton.addEventListener("click", () => void start());
