/**
 * Deterministic PRNG (mulberry32).
 *
 * Uses only integer add/xor/shift and 32-bit multiply (`Math.imul`), which are
 * bit-identical across JavaScript engines. Sender and receiver derive each
 * frame's neighbour set from the same seed, so this determinism is what lets a
 * receiver rebuild a frame's block indices without them being transmitted.
 * (Transcendentals such as `Math.log` are NOT cross-engine stable — see
 * soliton.ts for the one place that matters.)
 */
export type Prng = () => number; // float in [0, 1)

export function createPrng(seed: number): Prng {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, bound). */
export function nextInt(prng: Prng, bound: number): number {
  return Math.floor(prng() * bound);
}
