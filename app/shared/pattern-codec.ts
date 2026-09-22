/**
 * A PatternCodec turns fountain-frame bytes into a visual pattern and back.
 *
 * This is the pluggable seam of the study: QR, colour grid, dense binary grid,
 * etc. all implement this interface. The camera front-end (locate markers →
 * homography → sample the grid) is shared across codecs; only the mapping from
 * sampled cells to bits differs, so schemes can be compared on equal footing.
 */
export interface PatternImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>; // row-major RGBA, 4 bytes per pixel
}

export interface DecodedSymbol {
  readonly kind: "symbol";
  readonly bytes: Uint8Array;
  /** Estimated in-frame symbol errors, for BER measurement. */
  readonly estimatedSymbolErrors: number;
}

export interface Erasure {
  readonly kind: "erasure";
  readonly reason: string;
}

export type DecodeResult = DecodedSymbol | Erasure;

export interface PatternCodec {
  /** Stable id written into the frame header (`patternId`). */
  readonly id: number;
  readonly name: string;
  /** Raw payload capacity of a single frame, in bytes. */
  bytesPerFrame(): number;
  encode(frameBytes: Uint8Array): PatternImage;
  decode(image: PatternImage): DecodeResult;
}
