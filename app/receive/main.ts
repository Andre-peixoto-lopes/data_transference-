import { toArrayBufferBytes } from "../shared/bytes.js";
import { QrCodec } from "../shared/patterns/qr-codec.js";
import { Receiver } from "../shared/session.js";

const codec = new QrCodec();
const MAX_DECODE_WIDTH = 640; // downscale camera frames so jsQR keeps up

const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const video = document.querySelector<HTMLVideoElement>("#camera")!;
const progress = document.querySelector<HTMLProgressElement>("#prog")!;
const statusBox = document.querySelector<HTMLPreElement>("#status")!;
const resultBox = document.querySelector<HTMLDivElement>("#result")!;

const work = document.createElement("canvas");
const workContext = work.getContext("2d", { willReadFrequently: true })!;
const receiver = new Receiver(codec);
let streaming = false;

async function start(): Promise<void> {
  startButton.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    await video.play();
    streaming = true;
    statusBox.textContent = "câmera ativa — aponte para a tela transmissora.";
    requestAnimationFrame(tick);
  } catch (error) {
    startButton.disabled = false;
    statusBox.textContent = `não foi possível abrir a câmera: ${(error as Error).message}`;
  }
}

function tick(): void {
  if (!streaming) return;
  if (video.readyState >= 2 && video.videoWidth > 0) {
    const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
    work.width = Math.round(video.videoWidth * scale);
    work.height = Math.round(video.videoHeight * scale);
    workContext.drawImage(video, 0, 0, work.width, work.height);
    const frame = workContext.getImageData(0, 0, work.width, work.height);

    const complete = receiver.offer({ width: frame.width, height: frame.height, rgba: frame.data });
    const progressInfo = receiver.progress();
    progress.value = progressInfo.progress;
    statusBox.textContent = progressInfo.locked
      ? `recebendo • K=${progressInfo.k} • frames=${progressInfo.framesDecoded} • ${Math.round(progressInfo.progress * 100)}%`
      : "procurando frames Farol…";

    if (complete) {
      void finish();
      return;
    }
  }
  requestAnimationFrame(tick);
}

async function finish(): Promise<void> {
  streaming = false;
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((track) => track.stop());

  const file = await receiver.result();
  const url = URL.createObjectURL(new Blob([toArrayBufferBytes(file.payload)], { type: file.mediaType }));
  resultBox.innerHTML =
    `<p><strong>SHA-256 OK</strong> — arquivo reconstruído bit-a-bit.</p>` +
    `<p>${file.filename} • ${file.payload.length} bytes</p>` +
    `<a href="${url}" download="${file.filename}">Baixar arquivo recebido</a>`;
  statusBox.textContent = "concluído.";
}

startButton.addEventListener("click", () => void start());
