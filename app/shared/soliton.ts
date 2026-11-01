/**
 * Robust Soliton degree distribution for LT (fountain) codes.
 *
 * Sender and receiver MUST build a bit-identical CDF or they derive different
 * frame neighbours and fail silently. `Math.log`/`Math.sqrt` are
 * implementation-approximated (V8 and JavaScriptCore may differ in the last bit),
 * so the CDF uses `detLn`/`detSqrt`: only IEEE-754 `+ - * /`, which are correctly
 * rounded and therefore identical on every engine. Golden vectors pin the result.
 */
const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;

/** Natural logarithm from IEEE-754 basic operations only (bit-identical across engines). */
export function detLn(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) throw new RangeError(`detLn: domain error (${x})`);
  // x = m · 2^e with m in [√½, √2); scaling by 2 is exact.
  let m = x;
  let exponent = 0;
  while (m >= 2) {
    m /= 2;
    exponent++;
  }
  while (m < 1) {
    m *= 2;
    exponent--;
  }
  if (m > SQRT2) {
    m /= 2;
    exponent++;
  }
  // ln(m) = 2·atanh(s), |s| <= 0.172: a fixed 14-term series reaches double precision.
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let power = s;
  let series = 0;
  for (let n = 1; n <= 27; n += 2) {
    series += power / n;
    power *= s2;
  }
  return exponent * LN2 + 2 * series;
}

/** Square root by a fixed number of Newton steps (bit-identical across engines). */
export function detSqrt(x: number): number {
  if (x === 0) return 0;
  if (!(x > 0) || !Number.isFinite(x)) throw new RangeError(`detSqrt: domain error (${x})`);
  // x = m · 4^e with m in [1, 4); scaling by 4 and 2 is exact.
  let m = x;
  let scale = 1;
  while (m >= 4) {
    m /= 4;
    scale *= 2;
  }
  while (m < 1) {
    m *= 4;
    scale /= 2;
  }
  let y = (m + 1) / 2;
  for (let i = 0; i < 8; i++) y = (y + m / y) / 2;
  return y * scale;
}

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

  const spikeStrength = c * detLn(k / delta) * detSqrt(k);
  const spikeDegree = Math.max(1, Math.round(k / spikeStrength));
  const tau = new Float64Array(k + 1);
  for (let d = 1; d <= k; d++) {
    if (d < spikeDegree) tau[d] = spikeStrength / (d * k);
    else if (d === spikeDegree) tau[d] = (spikeStrength * detLn(spikeStrength / delta)) / k;
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
