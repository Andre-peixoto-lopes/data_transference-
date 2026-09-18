import { describe, expect, it } from "vitest";
import { bytesEqual } from "./bytes.js";
import { LtDecoder, LtEncoder, splitIntoBlocks, type FountainConfig } from "./fountain.js";

function makePayload(length: number): Uint8Array {
  const payload = new Uint8Array(length);
  for (let i = 0; i < length; i++) payload[i] = (i * 131 + 7) & 0xff;
  return payload;
}

interface RoundTripResult {
  readonly decoder: LtDecoder;
  readonly framesUsed: number;
  readonly k: number;
}

function roundTrip(
  payload: Uint8Array,
  blockLen: number,
  shouldDrop?: (seq: number) => boolean,
): RoundTripResult {
  const k = Math.max(1, Math.ceil(payload.length / blockLen));
  const config: FountainConfig = { k, blockLen, totalLen: payload.length };
  const encoder = new LtEncoder(splitIntoBlocks(payload, blockLen), config);
  const decoder = new LtDecoder(config);

  const maxFrames = k * 10 + 100;
  let framesUsed = 0;
  for (let seq = 0; seq < maxFrames && !decoder.isComplete; seq++) {
    const symbol = encoder.encodeSymbol(seq);
    if (shouldDrop?.(seq)) continue;
    decoder.addSymbol(seq, symbol);
    framesUsed++;
  }
  return { decoder, framesUsed, k };
}

describe("LT fountain code", () => {
  it("reconstructs the payload from an in-order stream", () => {
    const payload = makePayload(64 * 40);
    const { decoder, framesUsed, k } = roundTrip(payload, 64);
    expect(decoder.isComplete).toBe(true);
    expect(bytesEqual(decoder.getPayload(), payload)).toBe(true);
    expect(framesUsed).toBeLessThan(k * 3); // sane overhead
  });

  it("tolerates dropped frames (erasure channel)", () => {
    const payload = makePayload(64 * 50);
    const { decoder } = roundTrip(payload, 64, (seq) => seq % 5 === 0);
    expect(decoder.isComplete).toBe(true);
    expect(bytesEqual(decoder.getPayload(), payload)).toBe(true);
  });

  it("handles a payload not divisible by the block length", () => {
    const payload = makePayload(1000);
    const { decoder } = roundTrip(payload, 64);
    expect(bytesEqual(decoder.getPayload(), payload)).toBe(true);
  });

  it("ignores redundant frames once complete", () => {
    const payload = makePayload(64 * 10);
    const { decoder } = roundTrip(payload, 64);
    expect(decoder.addSymbol(999, new Uint8Array(64))).toBe(true);
    expect(bytesEqual(decoder.getPayload(), payload)).toBe(true);
  });
});
