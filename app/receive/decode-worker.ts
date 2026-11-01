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
  readonly maxSymbols: number; // codes the sender tiles per displayed frame
}

export interface DecodeResponse {
  readonly id: number;
  readonly payloads: Uint8Array[]; // decoded QR byte-mode payloads (empty = nothing readable)
}

self.addEventListener("message", async (event: MessageEvent<DecodeRequest>) => {
  const { id, width, height, buffer, maxSymbols } = event.data;
  const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
  let payloads: Uint8Array[] = [];
  try {
    // Farol codes are never inverted: skipping the inverted retry halves the work on unreadable frames.
    const results = await readBarcodes(image, {
      formats: ["QRCode"],
      tryHarder: false,
      tryInvert: false,
      maxNumberOfSymbols: maxSymbols,
    });
    payloads = results.filter((r) => r.isValid && r.bytes.length > 0).map((r) => r.bytes);
  } catch {
    /* undecodable frame — the fountain absorbs the loss */
  }
  const response: DecodeResponse = { id, payloads };
  self.postMessage(response);
});
