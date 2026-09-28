/// <reference lib="webworker" />
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

declare const self: DedicatedWorkerGlobalScope;

// Each worker loads the decoder wasm once, from our own origin (offline-safe).
prepareZXingModule({ overrides: { locateFile: () => zxingWasmUrl }, fireImmediately: true });

export interface DecodeRequest {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly buffer: ArrayBuffer; // RGBA pixels, transferred from the main thread
}

export interface DecodeResponse {
  readonly id: number;
  readonly bytes: Uint8Array | null; // decoded QR byte-mode payload, or null
}

self.addEventListener("message", async (event: MessageEvent<DecodeRequest>) => {
  const { id, width, height, buffer } = event.data;
  const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
  let bytes: Uint8Array | null = null;
  try {
    const results = await readBarcodes(image, { formats: ["QRCode"], tryHarder: false, maxNumberOfSymbols: 1 });
    const hit = results.find((r) => r.isValid && r.bytes.length > 0);
    if (hit) bytes = hit.bytes;
  } catch {
    /* undecodable frame — the fountain absorbs the loss */
  }
  const response: DecodeResponse = { id, bytes };
  self.postMessage(response);
});
