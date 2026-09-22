import { toArrayBufferBytes } from "../shared/bytes.js";
import type { FileContainer } from "../shared/container.js";
import { GridCodec } from "../shared/patterns/grid-codec.js";
import { Receiver, Transmitter } from "../shared/session.js";

const codec = new GridCodec({ cols: 32, rows: 32, cellSize: 12, margin: 16 });
const FRAMES_PER_SECOND = 12;

const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const screen = document.querySelector<HTMLCanvasElement>("#screen")!;
const progress = document.querySelector<HTMLProgressElement>("#prog")!;
const statusBox = document.querySelector<HTMLPreElement>("#status")!;
const resultBox = document.querySelector<HTMLDivElement>("#result")!;

screen.width = codec.width;
screen.height = codec.height;
const context = screen.getContext("2d", { willReadFrequently: true })!;

function sampleFile(): FileContainer {
  const payload = new Uint8Array(4096);
  crypto.getRandomValues(payload); // incompressible, so K reflects the payload
  return { filename: "amostra.bin", mediaType: "application/octet-stream", payload };
}

async function readSelectedFile(): Promise<FileContainer> {
  const file = fileInput.files?.[0];
  if (!file) return sampleFile();
  return {
    filename: file.name,
    mediaType: file.type || "application/octet-stream",
    payload: new Uint8Array(await file.arrayBuffer()),
  };
}

async function transmit(): Promise<void> {
  resultBox.innerHTML = "";
  startButton.disabled = true;

  const transmitter = await Transmitter.forFile(codec, await readSelectedFile());
  const receiver = new Receiver(codec);
  const startedAt = performance.now();

  let seq = 0;
  const timer = window.setInterval(() => {
    const image = transmitter.render(seq);
    context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);

    // Loopback "camera": read back exactly the pixels we just drew, then decode.
    const shown = context.getImageData(0, 0, screen.width, screen.height);
    const complete = receiver.offer({ width: shown.width, height: shown.height, rgba: shown.data });

    const info = receiver.progress();
    progress.value = info.progress;
    statusBox.textContent =
      `K=${info.k} blocos • frames vistos=${info.framesDecoded} • overhead=${(info.framesDecoded / Math.max(1, info.k)).toFixed(2)}x • ${Math.round(info.progress * 100)}%`;

    if (complete) {
      window.clearInterval(timer);
      void finish(receiver, startedAt, info.framesDecoded, info.k).finally(() => {
        startButton.disabled = false;
      });
    }
    seq++;
  }, Math.round(1000 / FRAMES_PER_SECOND));
}

async function finish(receiver: Receiver, startedAt: number, framesSeen: number, k: number): Promise<void> {
  const restored = await receiver.result();
  const seconds = (performance.now() - startedAt) / 1000;
  const throughput = (restored.payload.length / 1024 / seconds).toFixed(1);
  const url = URL.createObjectURL(new Blob([toArrayBufferBytes(restored.payload)], { type: restored.mediaType }));

  resultBox.innerHTML =
    `<p><strong>SHA-256 OK</strong> — arquivo reconstruído bit-a-bit.</p>` +
    `<p>${restored.filename} • ${restored.payload.length} bytes • ${throughput} KB/s • overhead ${(framesSeen / Math.max(1, k)).toFixed(2)}x</p>` +
    `<a id="download" href="${url}" download="${restored.filename}">Baixar arquivo recebido</a>`;
}

startButton.addEventListener("click", () => void transmit());
statusBox.textContent = "pronto. escolha um arquivo (ou use a amostra) e clique em Transmitir.";
