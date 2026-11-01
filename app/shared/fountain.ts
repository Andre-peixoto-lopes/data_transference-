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
  readonly eliminationLimit?: number; // decoder only; 0 = peeling only (experiments; needs K > DENSE_MAX_K)
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
 * Up to this many blocks each frame XORs a uniformly random subset (every block
 * with probability ½): a dense random linear fountain, which elimination decodes
 * from ~K+2 frames. Measured: K=25 needs 1.06·K frames vs 1.18·K with the soliton.
 * Larger files use the sparse robust soliton, whose XOR cost stays ~log K per frame.
 */
export const DENSE_MAX_K = 64;

/**
 * Derives the block indices XORed into the frame at `seq`. Encoder and decoder
 * call this with the same arguments, so the index set never travels on the wire.
 */
export function deriveNeighbours(seq: number, cdf: Float64Array, k: number): number[] {
  const prng = createPrng(seedForSeq(seq));
  if (k <= DENSE_MAX_K) {
    const subset: number[] = [];
    for (let i = 0; i < k; i++) if (prng() < 0.5) subset.push(i);
    return subset.length > 0 ? subset : [nextInt(prng, k)];
  }
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
  readonly neighbours: Set<number>; // unsolved blocks still XORed into `data`
  readonly data: Uint8Array;
}

/**
 * Largest residual (unsolved blocks) handed to Gaussian elimination. Its cost is
 * ~unknowns² row XORs, so beyond this the decoder relies on peeling alone until
 * peeling shrinks the residual below the cap.
 */
export const MAX_ELIMINATION_UNKNOWNS = 1024;

/**
 * LT decoder: belief-propagation peeling, plus Gaussian elimination over GF(2)
 * on the residual once there are at least as many buffered equations as unknown
 * blocks. Peeling alone needs ~K·1.15–1.5 symbols; elimination completes as soon
 * as the received symbols have full rank (~K·1.01–1.05) — maximum-likelihood
 * decoding. Feed symbols in any order; dropped frames only cost extra symbols.
 */
export class LtDecoder {
  private readonly cdf: Float64Array;
  private readonly solved: (Uint8Array | null)[];
  private solvedCount = 0;
  private readonly pending = new Set<PendingSymbol>();
  private readonly byBlock: (Set<PendingSymbol> | undefined)[];
  private eliminationCredit = 0; // useful symbols to wait for after a rank-deficient attempt
  private redundant = 0;

  constructor(private readonly config: FountainConfig) {
    this.cdf = buildRobustSolitonCdf({
      k: config.k,
      c: config.c ?? DEFAULT_SOLITON_C,
      delta: config.delta ?? DEFAULT_SOLITON_DELTA,
    });
    this.solved = new Array<Uint8Array | null>(config.k).fill(null);
    this.byBlock = new Array<Set<PendingSymbol> | undefined>(config.k);
  }

  get isComplete(): boolean {
    return this.solvedCount === this.config.k;
  }

  /**
   * Rank estimate: solved blocks + buffered equations. Peeling back-loads its
   * solves, so `solvedFraction` alone would sit low and then jump; only a
   * verified completion reaches 1.
   */
  get progress(): number {
    if (this.isComplete) return 1;
    return Math.min(0.99, (this.solvedCount + this.pending.size) / this.config.k);
  }

  get solvedFraction(): number {
    return this.solvedCount / this.config.k;
  }

  /** Symbols that carried no new information (every block they cover was already solved). */
  get redundantSymbols(): number {
    return this.redundant;
  }

  /** Feeds one received symbol; returns true once the whole payload is recovered. */
  addSymbol(seq: number, data: Uint8Array): boolean {
    if (this.isComplete) return true;
    const neighbours = new Set(deriveNeighbours(seq, this.cdf, this.config.k));
    const reduced = data.slice();
    for (const idx of [...neighbours]) {
      const block = this.solved[idx];
      if (block) {
        xorInto(reduced, block);
        neighbours.delete(idx);
      }
    }

    if (neighbours.size === 0) {
      this.redundant++;
      return false;
    }
    if (neighbours.size === 1) {
      this.solveAndRipple(firstOf(neighbours), reduced);
    } else {
      const symbol: PendingSymbol = { neighbours, data: reduced };
      this.pending.add(symbol);
      for (const idx of neighbours) (this.byBlock[idx] ??= new Set()).add(symbol);
    }
    this.eliminationCredit--;
    if (!this.isComplete) this.maybeEliminate();
    return this.isComplete;
  }

  /** Solves one block and propagates it through every buffered symbol that covers it. */
  private solveAndRipple(firstIndex: number, firstData: Uint8Array): void {
    const queue: Array<[number, Uint8Array]> = [[firstIndex, firstData]];
    while (queue.length > 0) {
      const [idx, data] = queue.pop()!;
      if (this.solved[idx]) continue;
      this.solved[idx] = data;
      this.solvedCount++;

      const covering = this.byBlock[idx];
      if (!covering) continue;
      this.byBlock[idx] = undefined;
      for (const symbol of covering) {
        xorInto(symbol.data, data);
        symbol.neighbours.delete(idx);
        if (symbol.neighbours.size > 1) continue;
        this.pending.delete(symbol);
        if (symbol.neighbours.size === 1) {
          const last = firstOf(symbol.neighbours);
          this.byBlock[last]?.delete(symbol);
          queue.push([last, symbol.data]);
        }
      }
    }
  }

  private maybeEliminate(): void {
    const unknowns = this.config.k - this.solvedCount;
    const limit = this.config.eliminationLimit ?? MAX_ELIMINATION_UNKNOWNS;
    if (this.eliminationCredit > 0) return;
    if (unknowns > limit || this.pending.size < unknowns) return;
    this.eliminationCredit = this.eliminate();
  }

  /**
   * Gaussian elimination over the residual. Phase 1 looks for `unknowns`
   * independent equations on coefficient bitsets only (cheap); phase 2 runs
   * Gauss–Jordan on exactly those, carrying the symbol data. Returns the rank
   * deficiency (0 = solved).
   */
  private eliminate(): number {
    const { k, blockLen } = this.config;
    const columnOf = new Int32Array(k).fill(-1);
    const blocks: number[] = [];
    for (let i = 0; i < k; i++) {
      if (!this.solved[i]) {
        columnOf[i] = blocks.length;
        blocks.push(i);
      }
    }
    const unknowns = blocks.length;
    const bitWords = (unknowns + 31) >>> 5;
    const bitsOf = (symbol: PendingSymbol): Uint32Array => {
      const bits = new Uint32Array(bitWords);
      for (const idx of symbol.neighbours) {
        const col = columnOf[idx];
        bits[col >>> 5] |= 1 << (col & 31);
      }
      return bits;
    };

    const pivots = new Array<Uint32Array | undefined>(unknowns);
    const basis: PendingSymbol[] = [];
    for (const symbol of this.pending) {
      const bits = bitsOf(symbol);
      let lead = lowestSetBit(bits);
      while (lead >= 0 && pivots[lead]) {
        xorWords(bits, pivots[lead]!, lead >>> 5);
        lead = lowestSetBit(bits);
      }
      if (lead < 0) continue; // a combination of equations already in the basis
      pivots[lead] = bits;
      basis.push(symbol);
      if (basis.length === unknowns) break;
    }
    if (basis.length < unknowns) return unknowns - basis.length;

    const dataWords = (blockLen + 3) >>> 2;
    const coef = basis.map(bitsOf);
    const data = basis.map((symbol) => {
      const words = new Uint32Array(dataWords);
      new Uint8Array(words.buffer).set(symbol.data);
      return words;
    });
    for (let col = 0; col < unknowns; col++) {
      const word = col >>> 5;
      const bit = 1 << (col & 31);
      let row = col;
      while (!(coef[row][word] & bit)) row++; // exists: the basis has full rank
      [coef[col], coef[row]] = [coef[row], coef[col]];
      [data[col], data[row]] = [data[row], data[col]];
      for (let r = 0; r < unknowns; r++) {
        if (r !== col && coef[r][word] & bit) {
          xorWords(coef[r], coef[col], word);
          xorWords(data[r], data[col], 0);
        }
      }
    }

    for (let col = 0; col < unknowns; col++) {
      this.solved[blocks[col]] = new Uint8Array(data[col].buffer, 0, blockLen);
    }
    this.solvedCount = k;
    this.pending.clear();
    this.byBlock.fill(undefined);
    return 0;
  }

  /** Reassembles the original payload; throws if decoding is not complete. */
  getPayload(): Uint8Array {
    if (!this.isComplete) throw new Error("fountain decode is incomplete");
    const joined = concatBytes(this.solved as Uint8Array[]);
    return joined.subarray(0, this.config.totalLen);
  }
}

function firstOf(set: Set<number>): number {
  return set.values().next().value as number;
}

function lowestSetBit(bits: Uint32Array): number {
  for (let w = 0; w < bits.length; w++) {
    const word = bits[w];
    if (word !== 0) return (w << 5) + 31 - Math.clz32(word & -word);
  }
  return -1;
}

/** XOR `source` into `target` from word `from` on (earlier words are known to be zero in `source`). */
function xorWords(target: Uint32Array, source: Uint32Array, from: number): void {
  for (let i = from; i < target.length; i++) target[i] ^= source[i];
}
