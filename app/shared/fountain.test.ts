import { describe, expect, it } from "vitest";
import { bytesEqual } from "./bytes.js";
import { deriveNeighbours, LtDecoder, LtEncoder, splitIntoBlocks, type FountainConfig } from "./fountain.js";
import { createPrng } from "./prng.js";
import { buildRobustSolitonCdf } from "./soliton.js";

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
  overrides: Partial<FountainConfig> = {},
  firstSeq = 0,
): RoundTripResult {
  const k = Math.max(1, Math.ceil(payload.length / blockLen));
  const config: FountainConfig = { k, blockLen, totalLen: payload.length, ...overrides };
  const encoder = new LtEncoder(splitIntoBlocks(payload, blockLen), config);
  const decoder = new LtDecoder(config);

  const maxFrames = k * 10 + 100;
  let framesUsed = 0;
  for (let seq = firstSeq; seq < firstSeq + maxFrames && !decoder.isComplete; seq++) {
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

  it("pins the neighbour sets on the wire (golden: same seq -> same blocks on every engine)", () => {
    const dense = buildRobustSolitonCdf({ k: 12, c: 0.03, delta: 0.05 });
    expect([0, 1, 2, 3].map((seq) => deriveNeighbours(seq, dense, 12))).toEqual([
      [0, 2, 4, 7, 9, 10, 11], [0, 1, 2, 4, 5, 6, 7, 8, 9, 10], [0, 7, 10], [3, 4, 6, 7, 9, 11],
    ]);
    const sparse = buildRobustSolitonCdf({ k: 100, c: 0.03, delta: 0.05 });
    expect([0, 1, 2, 3, 4, 5].map((seq) => deriveNeighbours(seq, sparse, 100))).toEqual([
      [23, 71], [4, 34], [81, 88], [1, 6, 26, 29, 30, 45, 47, 75, 90, 92, 98], [8, 26, 29], [43, 54, 60],
    ]);
  });

  it("small files (dense regime) decode from ~K frames", () => {
    const payload = makePayload(64 * 25); // K = 25 <= DENSE_MAX_K
    let used = 0;
    for (let run = 0; run < 20; run++) used += roundTrip(payload, 64, undefined, {}, run * 1000).framesUsed / 25;
    expect(used / 20).toBeLessThan(1.1);
  });

  it("Gaussian elimination completes near K symbols — far below peeling alone", () => {
    const payload = makePayload(16 * 120); // K = 120
    let eliminated = 0;
    let peeled = 0;
    for (let run = 0; run < 12; run++) {
      const loss = createPrng(0xabc + run);
      const drop = (): boolean => loss() < 0.25;
      const firstSeq = run * 100_000;
      const ge = roundTrip(payload, 16, drop, {}, firstSeq);
      const peel = roundTrip(payload, 16, drop, { eliminationLimit: 0 }, firstSeq);
      expect(bytesEqual(ge.decoder.getPayload(), payload)).toBe(true);
      expect(bytesEqual(peel.decoder.getPayload(), payload)).toBe(true);
      eliminated += ge.framesUsed / ge.k;
      peeled += peel.framesUsed / peel.k;
    }
    expect(eliminated / 12).toBeLessThan(1.06);
    expect(peeled / 12).toBeGreaterThan(1.2);
  });

  it("falls back to peeling while the residual exceeds the elimination cap", () => {
    const payload = makePayload(8 * 300);
    const { decoder } = roundTrip(payload, 8, (seq) => seq % 3 === 0, { eliminationLimit: 16 });
    expect(bytesEqual(decoder.getPayload(), payload)).toBe(true);
  });

  it("reports rank-based progress and counts redundant symbols", () => {
    const k = 80;
    const config: FountainConfig = { k, blockLen: 8, totalLen: k * 8 };
    const encoder = new LtEncoder(splitIntoBlocks(makePayload(k * 8), 8), config);
    const decoder = new LtDecoder(config);
    const cdf = buildRobustSolitonCdf({ k, c: 0.03, delta: 0.05 });
    const single = [...Array(200).keys()].find((seq) => deriveNeighbours(seq, cdf, k).length === 1)!;

    decoder.addSymbol(single, encoder.encodeSymbol(single));
    decoder.addSymbol(single, encoder.encodeSymbol(single));
    expect(decoder.redundantSymbols).toBe(1);

    let seq = 0;
    while (!decoder.isComplete) {
      decoder.addSymbol(seq, encoder.encodeSymbol(seq));
      if (!decoder.isComplete) expect(decoder.progress).toBeLessThan(1);
      seq++;
    }
    expect(decoder.progress).toBe(1);
  });
});
