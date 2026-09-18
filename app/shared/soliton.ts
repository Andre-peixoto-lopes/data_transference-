/**
 * Robust Soliton degree distribution for LT (fountain) codes.
 *
 * DETERMINISM HAZARD: the cumulative distribution below uses `Math.log`, whose
 * last-bit result can differ across JavaScript engines (V8 vs JavaScriptCore).
 * Sender and receiver MUST build a bit-identical CDF or they derive different
 * frame neighbours and fail silently. For this POC the CDF is computed once per
 * stream with the standard library; replacing `Math.log` with a deterministic
 * fixed-point implementation is tracked in docs/decisions/0003-*.
 */
export interface SolitonParams {
  readonly k: number; // number of source blocks
  readonly c: number; // robust-soliton constant (tuning knob)
  readonly delta: number; // decode-failure probability bound
}

/**
 * Returns a length `k + 1` cumulative distribution where index `d` (1..k) holds
 * the probability of drawing a degree `<= d`. Index 0 is unused (degree >= 1).
 */
export function buildRobustSolitonCdf(params: SolitonParams): Float64Array {
  const { k, c, delta } = params;

  const rho = new Float64Array(k + 1);
  rho[1] = 1 / k;
  for (let d = 2; d <= k; d++) rho[d] = 1 / (d * (d - 1));

  const spikeStrength = c * Math.log(k / delta) * Math.sqrt(k);
  const spikeDegree = Math.max(1, Math.round(k / spikeStrength));
  const tau = new Float64Array(k + 1);
  for (let d = 1; d <= k; d++) {
    if (d < spikeDegree) tau[d] = spikeStrength / (d * k);
    else if (d === spikeDegree) tau[d] = (spikeStrength * Math.log(spikeStrength / delta)) / k;
    else tau[d] = 0;
  }

  let normaliser = 0;
  for (let d = 1; d <= k; d++) normaliser += rho[d] + tau[d];

  const cdf = new Float64Array(k + 1);
  let accumulated = 0;
  for (let d = 1; d <= k; d++) {
    accumulated += (rho[d] + tau[d]) / normaliser;
    cdf[d] = accumulated;
  }
  cdf[k] = 1; // guard against floating-point drift at the tail
  return cdf;
}

/** Maps a uniform draw in [0, 1) to a degree in [1, k] using the CDF. */
export function degreeFromUniform(cdf: Float64Array, uniform: number): number {
  for (let d = 1; d < cdf.length; d++) {
    if (uniform <= cdf[d]) return d;
  }
  return cdf.length - 1;
}
