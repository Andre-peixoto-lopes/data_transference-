import { describe, expect, it } from "vitest";
import { bytesEqual } from "../bytes.js";
import { GridCodec } from "./grid-codec.js";

describe("GridCodec", () => {
  const codec = new GridCodec({ cols: 32, rows: 32, cellSize: 8, margin: 12 });

  it("round-trips a full-capacity frame", () => {
    const capacity = codec.bytesPerFrame();
    const frame = new Uint8Array(capacity);
    for (let i = 0; i < capacity; i++) frame[i] = (i * 37 + 11) & 0xff;

    const result = codec.decode(codec.encode(frame));
    expect(result.kind).toBe("symbol");
    if (result.kind === "symbol") expect(bytesEqual(result.bytes, frame)).toBe(true);
  });

  it("zero-pads a short frame and reads the prefix back", () => {
    const frame = new Uint8Array([1, 2, 3, 4, 5]);
    const result = codec.decode(codec.encode(frame));
    expect(result.kind).toBe("symbol");
    if (result.kind === "symbol") {
      expect(bytesEqual(result.bytes.subarray(0, 5), frame)).toBe(true);
    }
  });

  it("reports capacity from the grid geometry", () => {
    expect(codec.bytesPerFrame()).toBe((32 * 32) / 8);
  });
});
