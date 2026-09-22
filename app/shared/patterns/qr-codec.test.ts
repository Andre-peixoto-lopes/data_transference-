import { describe, expect, it } from "vitest";
import { bytesEqual } from "../bytes.js";
import type { PatternImage } from "../pattern-codec.js";
import { QrCodec } from "./qr-codec.js";

describe("QrCodec", () => {
  const codec = new QrCodec({ bytesPerFrame: 96, scale: 6, margin: 4 });

  it("round-trips a full-capacity frame through render + jsQR", () => {
    const frame = new Uint8Array(codec.bytesPerFrame());
    for (let i = 0; i < frame.length; i++) frame[i] = (i * 53 + 17) & 0xff;

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
});
