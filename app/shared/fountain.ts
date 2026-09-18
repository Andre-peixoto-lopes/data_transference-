import { concatBytes, xorInto } from "./bytes.js";
import { createPrng, nextInt, type Prng } from "./prng.js";
import { buildRobustSolitonCdf, degreeFromUniform } from "./soliton.js";

/** Default robust-soliton tuning; exposed so experiments can sweep them. */
export const DEFAULT_SOLITON_C = 0.03;
export const DEFAULT_SOLITON_DELTA = 0.05;

export interface FountainConfig {
  readonly k: number; // number of source blocks
  readonly blockLen: number; // bytes per block
  readonly totalLen: number; // original payload length (blocks are zero-padded)
  readonly c?: number;
  readonly delta?: number;
}

/** Splits a payload into `k` fixed-length blocks, zero-padding the last one. */
export function splitIntoBlocks(payload: Uint8Array, blockLen: number): Uint8Array[] {
  const blockCount = Math.max(1, Math.ceil(payload.length / blockLen));
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < blockCount; i++) {
    const block = new Uint8Array(blockLen);
    block.set(payload.subarray(i * blockLen, i * blockLen + blockLen));
    blocks.push(block);
  }
  return blocks;
}

/** Integer-only seed derived from a frame's sequence number (cross-engine stable). */
function seedForSeq(seq: number): number {
  return Math.imul(seq ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
}

/** Uniform sample of `degree` distinct block indices via partial Fisher–Yates. */
function sampleDistinctIndices(prng: Prng, k: number, degree: number): number[] {
  const size = Math.min(degree, k);
  const pool: number[] = [];
  for (let i = 0; i < k; i++) pool[i] = i;
  for (let i = 0; i < size; i++) {
    const j = i + nextInt(prng, k - i);
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, size).sort((a, b) => a - b);
}

/**
 * Derives the block indices XORed into the frame at `seq`. Encoder and decoder
 * call this with the same arguments, so the index set never travels on the wire.
 */
export function deriveNeighbours(seq: number, cdf: Float64Array, k: number): number[] {
  const prng = createPrng(seedForSeq(seq));
  const degree = degreeFromUniform(cdf, prng());
  return sampleDistinctIndices(prng, k, degree);
}

export class LtEncoder {
  private readonly cdf: Float64Array;

  constructor(
    private readonly blocks: Uint8Array[],
    private readonly config: FountainConfig,
  ) {
    this.cdf = buildRobustSolitonCdf({
      k: config.k,
      c: config.c ?? DEFAULT_SOLITON_C,
      delta: config.delta ?? DEFAULT_SOLITON_DELTA,
    });
  }

  /** Produces the fountain symbol for a given sequence number. */
  encodeSymbol(seq: number): Uint8Array {
    const symbol = new Uint8Array(this.config.blockLen);
    for (const idx of deriveNeighbours(seq, this.cdf, this.config.k)) {
      xorInto(symbol, this.blocks[idx]);
    }
    return symbol;
  }
}

interface PendingSymbol {
  readonly neighbours: Set<number>;
  readonly data: Uint8Array;
}

/**
 * Peeling (belief-propagation) LT decoder. Feed symbols in any order; dropped
 * frames only cost extra symbols, never correctness.
 */
export class LtDecoder {
  private readonly cdf: Float64Array;
  private readonly solved: (Uint8Array | null)[];
  private solvedCount = 0;
  private readonly pending: PendingSymbol[] = [];

  constructor(private readonly config: FountainConfig) {
    this.cdf = buildRobustSolitonCdf({
      k: config.k,
      c: config.c ?? DEFAULT_SOLITON_C,
      delta: config.delta ?? DEFAULT_SOLITON_DELTA,
    });
    this.solved = new Array<Uint8Array | null>(config.k).fill(null);
  }

  get isComplete(): boolean {
    return this.solvedCount === this.config.k;
  }

  get progress(): number {
    return this.solvedCount / this.config.k;
  }

  /** Feeds one received symbol; returns true once the whole payload is recovered. */
  addSymbol(seq: number, data: Uint8Array): boolean {
    if (this.isComplete) return true;
    const neighbours = new Set(deriveNeighbours(seq, this.cdf, this.config.k));
    const reduced = data.slice();
    this.reduceAgainstSolved(neighbours, reduced);
    this.absorb(neighbours, reduced);
    return this.isComplete;
  }

  private reduceAgainstSolved(neighbours: Set<number>, data: Uint8Array): void {
    for (const idx of [...neighbours]) {
      const block = this.solved[idx];
      if (block) {
        xorInto(data, block);
        neighbours.delete(idx);
      }
    }
  }

  private absorb(neighbours: Set<number>, data: Uint8Array): void {
    if (neighbours.size === 0) return; // fully redundant frame
    if (neighbours.size > 1) {
      this.pending.push({ neighbours, data });
      return;
    }
    const rippleQueue: number[] = [];
    this.solve([...neighbours][0], data, rippleQueue);
    this.ripple(rippleQueue);
  }

  /** Propagates each newly solved block back into buffered higher-degree symbols. */
  private ripple(rippleQueue: number[]): void {
    while (rippleQueue.length > 0) {
      const solvedIndex = rippleQueue.pop() as number;
      const block = this.solved[solvedIndex] as Uint8Array;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const symbol = this.pending[i];
        if (!symbol.neighbours.has(solvedIndex)) continue;
        xorInto(symbol.data, block);
        symbol.neighbours.delete(solvedIndex);
        if (symbol.neighbours.size <= 1) {
          this.pending.splice(i, 1);
          if (symbol.neighbours.size === 1) {
            this.solve([...symbol.neighbours][0], symbol.data, rippleQueue);
          }
        }
      }
    }
  }

  private solve(idx: number, data: Uint8Array, rippleQueue: number[]): void {
    if (this.solved[idx]) return;
    this.solved[idx] = data;
    this.solvedCount++;
    rippleQueue.push(idx);
  }

  /** Reassembles the original payload; throws if decoding is not complete. */
  getPayload(): Uint8Array {
    if (!this.isComplete) throw new Error("fountain decode is incomplete");
    const joined = concatBytes(this.solved as Uint8Array[]);
    return joined.subarray(0, this.config.totalLen);
  }
}
