import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { bytesEqual } from "../bytes.js";
import type { PatternImage } from "../pattern-codec.js";
import { type ErrorCorrectionLevel, QR_VERSIONS, QrCodec, qrByteCapacity } from "./qr-codec.js";

function frameOf(length: number): Uint8Array {
  const frame = new Uint8Array(length);
  for (let i = 0; i < frame.length; i++) frame[i] = (i * 53 + 17) & 0xff;
  return frame;
}

describe("QrCodec", () => {
  const codec = new QrCodec({ bytesPerFrame: 96, scale: 6, margin: 4 });

  it("round-trips a full-capacity frame through render + jsQR", () => {
    const frame = frameOf(codec.bytesPerFrame());
    const result = codec.decode(codec.encode(frame));
    expect(result.kind).toBe("symbol");
    if (result.kind === "symbol") expect(bytesEqual(result.bytes, frame)).toBe(true);
  });

  it("reports an erasure when no QR is present", () => {
    const blank: PatternImage = {
      width: 120,
      height: 120,
      rgba: new Uint8ClampedArray(120 * 120 * 4).fill(255),
    };
    expect(codec.decode(blank).kind).toBe("erasure");
  });

  it("capacity table matches node-qrcode for every offered version and ECC level", () => {
    for (const version of QR_VERSIONS) {
      for (const ecc of ["L", "M", "Q", "H"] as ErrorCorrectionLevel[]) {
        const capacity = qrByteCapacity(version, ecc);
        const fits = (bytes: number) =>
          QRCode.create([{ data: frameOf(bytes) as unknown as Buffer, mode: "byte" }], {
            version,
            errorCorrectionLevel: ecc,
            maskPattern: 0,
          });
        expect(fits(capacity).version).toBe(version);
        expect(() => fits(capacity + 1)).toThrow();
      }
    }
  });

  it("derives capacity from version + ECC, so dense frames with ECC H encode (no overflow)", () => {
    const dense = new QrCodec({ version: 27, errorCorrectionLevel: "H", scale: 4 });
    expect(dense.bytesPerFrame()).toBe(625);
    const frame = frameOf(dense.bytesPerFrame());
    const result = dense.decode(dense.encode(frame));
    expect(result.kind === "symbol" && bytesEqual(result.bytes, frame)).toBe(true);
  });

  it("pins the version: every frame has the same size even when the payload is short", () => {
    const pinned = new QrCodec({ version: 15, scale: 1, margin: 4 });
    expect(pinned.encode(frameOf(10)).width).toBe(pinned.encode(frameOf(pinned.bytesPerFrame())).width);
    expect(pinned.encode(frameOf(10)).width).toBe(77 + 8); // v15 = 77 modules + quiet zone
  });
});
