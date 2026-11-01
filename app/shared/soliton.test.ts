import { describe, expect, it } from "vitest";
import { buildRobustSolitonCdf, detLn, detSqrt } from "./soliton.js";

describe("deterministic math (cross-engine CDF)", () => {
  it("detLn/detSqrt track Math.log/Math.sqrt to within a couple of ulps", () => {
    for (let i = 1; i < 20000; i++) {
      const x = i * 3.7 + 1e-3;
      expect(Math.abs(detLn(x) - Math.log(x))).toBeLessThanOrEqual(1e-15 * Math.max(1, Math.abs(Math.log(x))));
      expect(Math.abs(detSqrt(x) - Math.sqrt(x))).toBeLessThanOrEqual(1e-15 * Math.sqrt(x));
    }
  });

  it("pins golden values (bit-exact, independent of the JS engine)", () => {
    expect(detLn(800)).toBe(6.684611727667927);
    expect(detLn(20)).toBe(2.995732273553991);
    expect(detLn(0.75)).toBe(-0.2876820724517809);
    expect(detSqrt(40)).toBe(6.324555320336758);
    expect(detSqrt(65535)).toBe(255.99804686754936);
  });

  it("pins the robust-soliton CDF that sender and receiver must share", () => {
    const cdf = buildRobustSolitonCdf({ k: 40, c: 0.03, delta: 0.05 });
    expect([cdf[1], cdf[2], cdf[3], cdf[10], cdf[39], cdf[40]]).toEqual([
      0.046095718261294445, 0.46541400255447873, 0.609482456984965, 0.8273894203402371, 0.9994789343521863, 1,
    ]);
  });

  it("rejects inputs outside the domain", () => {
    expect(() => detLn(0)).toThrow(RangeError);
    expect(() => detSqrt(-1)).toThrow(RangeError);
  });
});
