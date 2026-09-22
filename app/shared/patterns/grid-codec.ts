import type { DecodeResult, PatternCodec, PatternImage } from "../pattern-codec.js";

/**
 * Black-and-white grid codec: maps frame bytes to a grid of cells (1 bit each,
 * MSB-first) surrounded by a white quiet zone. It is the first concrete
 * PatternCodec — simple, pixel-exact in loopback, and a base for colour/dense
 * variants. Encode/decode work on raw RGBA so they stay unit-testable off-DOM.
 */
export interface GridCodecOptions {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number; // pixels per cell
  readonly margin: number; // pixels of white quiet zone
}

const BLACK = 0;
const THRESHOLD = 128;

export class GridCodec implements PatternCodec {
  readonly id = 3;
  readonly name = "grid-bw";
  readonly width: number;
  readonly height: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly margin: number;

  constructor(options: GridCodecOptions) {
    this.cols = options.cols;
    this.rows = options.rows;
    this.cellSize = options.cellSize;
    this.margin = options.margin;
    this.width = this.margin * 2 + this.cols * this.cellSize;
    this.height = this.margin * 2 + this.rows * this.cellSize;
  }

  bytesPerFrame(): number {
    return Math.floor((this.cols * this.rows) / 8);
  }

  encode(frameBytes: Uint8Array): PatternImage {
    const capacity = this.bytesPerFrame();
    if (frameBytes.length > capacity) {
      throw new Error(`frame ${frameBytes.length}B exceeds grid capacity ${capacity}B`);
    }
    const rgba = new Uint8ClampedArray(this.width * this.height * 4);
    rgba.fill(255); // opaque white background

    const cellCount = this.cols * this.rows;
    for (let cell = 0; cell < cellCount; cell++) {
      if (this.readBit(frameBytes, cell)) this.paintCell(rgba, cell);
    }
    return { width: this.width, height: this.height, rgba };
  }

  decode(image: PatternImage): DecodeResult {
    if (image.width !== this.width || image.height !== this.height) {
      return { kind: "erasure", reason: "unexpected image size" };
    }
    const bytes = new Uint8Array(this.bytesPerFrame());
    const cellCount = this.cols * this.rows;
    for (let cell = 0; cell < cellCount; cell++) {
      if (this.sampleCellCenter(image, cell) < THRESHOLD) this.writeBit(bytes, cell);
    }
    return { kind: "symbol", bytes, estimatedSymbolErrors: 0 };
  }

  private paintCell(rgba: Uint8ClampedArray, cell: number): void {
    const x0 = this.margin + (cell % this.cols) * this.cellSize;
    const y0 = this.margin + Math.floor(cell / this.cols) * this.cellSize;
    for (let y = y0; y < y0 + this.cellSize; y++) {
      let offset = (y * this.width + x0) * 4;
      for (let x = 0; x < this.cellSize; x++) {
        rgba[offset] = BLACK;
        rgba[offset + 1] = BLACK;
        rgba[offset + 2] = BLACK;
        rgba[offset + 3] = 255;
        offset += 4;
      }
    }
  }

  private sampleCellCenter(image: PatternImage, cell: number): number {
    const x = this.margin + (cell % this.cols) * this.cellSize + (this.cellSize >> 1);
    const y = this.margin + Math.floor(cell / this.cols) * this.cellSize + (this.cellSize >> 1);
    return image.rgba[(y * image.width + x) * 4];
  }

  private readBit(bytes: Uint8Array, index: number): number {
    const byteIndex = index >> 3;
    if (byteIndex >= bytes.length) return 0;
    return (bytes[byteIndex] >> (7 - (index & 7))) & 1;
  }

  private writeBit(bytes: Uint8Array, index: number): void {
    bytes[index >> 3] |= 1 << (7 - (index & 7));
  }
}
