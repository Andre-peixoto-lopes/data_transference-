import "./sidebar.js";
import "./sidebar.css";
import "./theme.js";
import "./appearance.css";
import "./mobile.css";
import { examples } from "./examples.js";
// Presentation only: transfer and camera behavior remain in their own modules.
const fileInput = document.querySelector<HTMLInputElement>("#file");
const upload = document.querySelector<HTMLElement>(".upload");
const uploadHint = upload?.querySelector<HTMLElement>("small");
const touchPointer = window.matchMedia("(pointer: coarse)");
function updateUploadHint(): void {
  if (uploadHint) uploadHint.textContent = touchPointer.matches ? "Toque para selecionar um arquivo" : "Clique ou arraste um arquivo aqui";
}
updateUploadHint();
touchPointer.addEventListener("change", updateUploadHint);
const fileName = document.querySelector<HTMLElement>("[data-file-name]");
function updateFileName(): void {
  const example = examples.find((item) => item.id === new URLSearchParams(location.search).get("example"));
  if (fileName) fileName.textContent = fileInput?.files?.[0]?.name ?? (example ? `Amostra: ${example.title}` : "Escolher arquivo");
}
updateFileName();
fileInput?.addEventListener("change", updateFileName);
for (const event of ["dragenter", "dragover"]) {
  upload?.addEventListener(event, () => upload.classList.add("dragging"));
}
for (const event of ["dragleave", "drop"]) {
  upload?.addEventListener(event, () => upload.classList.remove("dragging"));
}
const status = document.querySelector("#status");
const empty = document.querySelector<HTMLElement>(".empty-preview");
const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const video = document.querySelector<HTMLVideoElement>("#camera");
function revealPreview(): void {
  if (!empty || empty.hidden) return;
  empty.hidden = true;
  if (window.matchMedia("(max-width: 1023px)").matches) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    empty.closest(".preview-panel")?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
  }
}
// Reveal actual media only once it exists, including after camera permission errors.
function updatePreview(): void {
  const transmitting = status?.textContent?.startsWith("transmitindo");
  const demoRunning = document.body.dataset.page === "demo" && /frames vistos=/.test(status?.textContent ?? "");
  if (canvas && (transmitting || demoRunning)) revealPreview();
}
if (status) new MutationObserver(updatePreview).observe(status, { childList: true, characterData: true, subtree: true });
video?.addEventListener("playing", revealPreview);
