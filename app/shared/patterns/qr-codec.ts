import jsQR from "jsqr";
import QRCode from "qrcode";
import type { DecodeResult, PatternCodec, PatternImage } from "../pattern-codec.js";

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QrCodecOptions {
  readonly bytesPerFrame?: number;
  readonly scale?: number; // pixels per QR module
  readonly margin?: number; // quiet zone in modules
  readonly errorCorrectionLevel?: ErrorCorrectionLevel;
}

/**
 * QR PatternCodec (baseline). node-qrcode renders byte-mode frames; jsQR reads
 * them. jsQR locates the finder patterns, corrects perspective and samples the
 * grid, so `decode` works directly on a raw camera frame — not only a canonical
 * one. QR's built-in Reed-Solomon is the intra-frame FEC; the fountain handles
 * erasure across frames, so error correction stays at level L by default.
 */
export class QrCodec implements PatternCodec {
  readonly id = 1;
  readonly name = "qr";
  private readonly capacity: number;
  private readonly scale: number;
  private readonly margin: number;
  private readonly ecc: ErrorCorrectionLevel;

  constructor(options: QrCodecOptions = {}) {
    this.capacity = options.bytesPerFrame ?? 96;
    this.scale = options.scale ?? 6;
    this.margin = options.margin ?? 4;
    this.ecc = options.errorCorrectionLevel ?? "L";
  }

  bytesPerFrame(): number {
    return this.capacity;
  }

  encode(frameBytes: Uint8Array): PatternImage {
    if (frameBytes.length > this.capacity) {
      throw new Error(`frame ${frameBytes.length}B exceeds QR capacity ${this.capacity}B`);
    }
    // node-qrcode accepts a Uint8Array for byte-mode segments at runtime.
    const qr = QRCode.create([{ data: frameBytes as unknown as Buffer, mode: "byte" }], {
      errorCorrectionLevel: this.ecc,
    });
    const moduleCount = qr.modules.size;
    const dimension = (moduleCount + this.margin * 2) * this.scale;

    const rgba = new Uint8ClampedArray(dimension * dimension * 4);
    rgba.fill(255);
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.modules.get(row, col)) this.paintModule(rgba, dimension, col, row);
      }
    }
    return { width: dimension, height: dimension, rgba };
  }

  decode(image: PatternImage): DecodeResult {
    const found = jsQR(image.rgba, image.width, image.height, { inversionAttempts: "dontInvert" });
    if (!found) return { kind: "erasure", reason: "no QR detected" };
    return { kind: "symbol", bytes: Uint8Array.from(found.binaryData), estimatedSymbolErrors: 0 };
  }

  private paintModule(rgba: Uint8ClampedArray, dimension: number, col: number, row: number): void {
    const x0 = (col + this.margin) * this.scale;
    const y0 = (row + this.margin) * this.scale;
    for (let y = y0; y < y0 + this.scale; y++) {
      let offset = (y * dimension + x0) * 4;
      for (let x = 0; x < this.scale; x++) {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 255;
        offset += 4;
      }
    }
  }
}
