import { describe, expect, it } from "vitest";
import { PRICES, applyPayer, type Price } from "./prices";

describe("prices", () => {
  it("every row has a real source and a sane range", () => {
    for (const [k, p] of Object.entries(PRICES) as [string, Price][]) {
      expect(p.source, k).not.toMatch(/placeholder/i);
      expect(p.low, k).toBeLessThanOrEqual(p.typical);
      expect(p.typical, k).toBeLessThanOrEqual(p.high);
      expect(p.typical, k).toBeGreaterThan(0);
    }
  });
  it("typical is the sum of its parts", () => {
    for (const p of Object.values(PRICES) as Price[]) {
      const sum = (p.components ?? []).reduce((a, c) => a + c.typical, 0);
      expect(Math.abs(sum - p.typical)).toBeLessThanOrEqual(1);
    }
  });
  it("switching to one insurer and back restores the medians", () => {
    const before = PRICES.mri.typical;
    applyPayer("UnitedHealthcare");
    applyPayer(null);
    expect(PRICES.mri.typical).toBe(before);
  });
});
