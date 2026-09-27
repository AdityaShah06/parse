import { describe, expect, it } from "vitest";
import { NATIONAL, funnelFor, insurersIn } from "./appeals";

describe("appeal funnel", () => {
  it("finds UnitedHealthcare in Missouri by plan id and by name", () => {
    const byId = funnelFor("95426MO0410013", null);
    expect(byId).toMatchObject({ denied: 203531, appealed: 1119, won: 386 });
    expect(funnelFor(null, "UnitedHealthcare")).toEqual(byId);
  });

  it("matches Anthem through the issuer's parenthetical name", () => {
    expect(funnelFor(null, "Anthem Blue Cross and Blue Shield")?.label).toMatch(/Anthem/);
  });

  it("leaves out insurers with missing appeal counts", () => {
    const names = insurersIn("MO").map((f) => f.label);
    expect(names).not.toContain("Celtic Insurance Company");
    expect(names).not.toContain("Medica Central Insurance Company");
  });

  it("sums a national funnel where appeals are rare and wins are common", () => {
    expect(NATIONAL.appealed / NATIONAL.denied).toBeLessThan(0.02);
    expect(NATIONAL.won / NATIONAL.appealed).toBeGreaterThan(0.2);
  });
});
