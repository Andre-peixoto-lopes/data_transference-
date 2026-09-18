import { describe, expect, it } from "vitest";
import { toHex } from "./bytes.js";
import {
  FRAME_HEADER_LENGTH,
  type FrameHeader,
  packFrame,
  packHeader,
  parseFrame,
  parseHeader,
  streamIdentity,
} from "./protocol.js";

const sample: FrameHeader = {
  version: 1,
  flags: 0,
  sessionId: 0xabcd,
  seq: 0x00010203,
  k: 40,
  blockLen: 64,
  totalLen: 2560,
  patternId: 1,
};

describe("frame protocol", () => {
  it("round-trips a header", () => {
    expect(parseHeader(packHeader(sample))).toEqual(sample);
  });

  it("produces a stable golden header (fixed wire bytes)", () => {
    expect(toHex(packHeader(sample))).toBe("d1c30100abcd000102030028004000000a00010000000000");
  });

  it("round-trips a frame with its symbol payload", () => {
    const symbol = new Uint8Array([1, 2, 3, 4, 5]);
    const parsed = parseFrame(packFrame(sample, symbol));
    expect(parsed.header).toEqual(sample);
    expect(toHex(parsed.symbol)).toBe("0102030405");
  });

  it("rejects bytes that are not a Farol frame", () => {
    expect(() => parseHeader(new Uint8Array(FRAME_HEADER_LENGTH))).toThrow();
  });

  it("treats stream identity as independent of the sequence number", () => {
    expect(streamIdentity(sample)).toBe(streamIdentity({ ...sample, seq: 999 }));
  });
});
