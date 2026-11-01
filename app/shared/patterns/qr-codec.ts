import jsQR from "jsqr";
import QRCode from "qrcode";
import type { DecodeResult, PatternCodec, PatternImage } from "../pattern-codec.js";

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

/** QR versions offered by the sender, densest last. */
export const QR_VERSIONS = [10, 15, 20, 25, 27, 30, 33, 36, 40] as const;
export const DEFAULT_QR_VERSION = 27;

// Byte-mode capacity per version and ECC level (ISO/IEC 18004; cross-checked against node-qrcode in tests).
const BYTE_CAPACITY: Readonly<Record<number, readonly [number, number, number, number]>> = {
  10: [271, 213, 151, 119],
  15: [520, 412, 292, 220],
  20: [858, 666, 482, 382],
  25: [1273, 997, 715, 535],
  27: [1465, 1125, 805, 625],
  30: [1732, 1370, 982, 742],
  33: [2068, 1628, 1168, 898],
  36: [2431, 1911, 1351, 1051],
  40: [2953, 2331, 1663, 1273],
};
const ECC_INDEX: Readonly<Record<ErrorCorrectionLevel, number>> = { L: 0, M: 1, Q: 2, H: 3 };

/** Any mask is valid to a decoder; pinning one skips the 8-way mask evaluation per frame. */
const PINNED_MASK = 0;

/** Bytes a QR of `version` carries in byte mode at `ecc` — a frame (header + symbol) must fit. */
export function qrByteCapacity(version: number, ecc: ErrorCorrectionLevel): number {
  const row = BYTE_CAPACITY[version];
  if (!row) throw new RangeError(`QR version ${version} is not in the capacity table`);
  return row[ECC_INDEX[ecc]];
}

export interface QrCodecOptions {
  /** Pinned QR version: every frame has the same module count. Default 27 unless `bytesPerFrame` is set. */
  readonly version?: number;
  /** Explicit frame capacity; without `version`, the smallest QR that fits is chosen per frame. */
  readonly bytesPerFrame?: number;
  readonly scale?: number; // pixels per QR module
  readonly margin?: number; // quiet zone in modules
  readonly errorCorrectionLevel?: ErrorCorrectionLevel;
}

/**
 * QR PatternCodec (baseline). `node-qrcode` renders byte-mode frames. `decode`
 * uses jsQR as a self-contained reference decoder — it runs off-DOM, so the unit
 * and e2e tests read frames back synchronously without WASM. The camera page
 * decodes with zxing-wasm instead (faster and more robust); both read the same
 * byte-mode QR. QR's built-in Reed-Solomon is the intra-frame FEC; the fountain
 * handles erasure across frames, so error correction stays at level L by default.
 */
export class QrCodec implements PatternCodec {
  readonly id = 1;
  readonly name = "qr";
  readonly version: number | undefined;
  private readonly capacity: number;
  private readonly scale: number;
  private readonly margin: number;
  private readonly ecc: ErrorCorrectionLevel;

  constructor(options: QrCodecOptions = {}) {
    this.ecc = options.errorCorrectionLevel ?? "L";
    this.version = options.version ?? (options.bytesPerFrame === undefined ? DEFAULT_QR_VERSION : undefined);
    this.capacity = options.bytesPerFrame ?? qrByteCapacity(this.version!, this.ecc);
    if (this.version !== undefined && this.capacity > qrByteCapacity(this.version, this.ecc)) {
      throw new RangeError(`${this.capacity} B do not fit QR v${this.version}-${this.ecc}`);
    }
    this.scale = options.scale ?? 6;
    this.margin = options.margin ?? 4;
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
      version: this.version,
      maskPattern: PINNED_MASK,
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
