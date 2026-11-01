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
  UnsupportedFrameError,
} from "./protocol.js";

const sample: FrameHeader = {
  version: 2,
  flags: 0,
  sessionId: 0xabcd,
  seq: 0x00010203,
  k: 40,
  blockLen: 64,
  totalLen: 2560,
  patternId: 1,
  codes: 4,
};

describe("frame protocol", () => {
  it("round-trips a header", () => {
    expect(parseHeader(packHeader(sample))).toEqual(sample);
  });

  it("produces a stable golden header (fixed wire bytes)", () => {
    expect(toHex(packHeader(sample))).toBe("d1c30200abcd000102030028004000000a00010400000000");
  });

  it("round-trips a frame with its symbol payload", () => {
    const symbol = new Uint8Array([1, 2, 3, 4, 5]);
    const parsed = parseFrame(packFrame(sample, symbol));
    expect(parsed.header).toEqual(sample);
    expect(toHex(parsed.symbol)).toBe("0102030405");
  });

  it("rejects bytes that are not a Farol frame", () => {
    expect(() => parseHeader(new Uint8Array(FRAME_HEADER_LENGTH))).toThrow("not a Farol frame");
  });

  it("names the version of a Farol frame it cannot read", () => {
    const old = packHeader({ ...sample, version: 1 });
    const error = (() => {
      try {
        parseHeader(old);
      } catch (thrown) {
        return thrown;
      }
    })();
    expect(error).toBeInstanceOf(UnsupportedFrameError);
    expect(error).toMatchObject({ reason: "version", value: 1 });
  });

  it("rejects unknown must-understand flags but ignores the safe-to-ignore half", () => {
    expect(() => parseHeader(packHeader({ ...sample, flags: 0x01 }))).toThrow(UnsupportedFrameError);
    expect(parseHeader(packHeader({ ...sample, flags: 0x80 })).flags).toBe(0x80);
  });

  it("treats stream identity as independent of the sequence number", () => {
    expect(streamIdentity(sample)).toBe(streamIdentity({ ...sample, seq: 999 }));
  });
});
