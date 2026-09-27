import { describe, expect, it } from "vitest";
import { shop, type LivePlan } from "./shop";
import { toEnginePlanDetailed, type ApiPlan } from "./marketplace";
import { denialFor } from "./kb/denials";
import full from "./fixtures/live/cms-plan-full.json";
import search from "./fixtures/marketplace/plans-search-65201.json";

const toLive = (p: ApiPlan): LivePlan | null => {
  const e = toEnginePlanDetailed(p);
  if (!e) return null;
  return {
    id: p.id,
    name: p.name,
    issuer: p.issuer?.name ?? null,
    issuerPhone: null,
    metal: p.metal_level ?? null,
    type: p.type ?? null,
    premium: p.premium ?? null,
    premiumWithCredit: p.premium_w_credit ?? null,
    deductible: e.plan.deductible,
    moop: e.plan.outOfPocketMax,
    hsa: !!p.hsa_eligible,
    hasNationalNetwork: p.has_national_network ?? null,
    qualityRating: (p.quality_rating as LivePlan["qualityRating"]) ?? null,
    urls: { brochure: null, benefits: null, network: null, formulary: null },
    enginePlan: e.plan,
  };
};

const plans = [full as unknown as ApiPlan, ...(search as unknown as { plans: ApiPlan[] }).plans].map(toLive).filter((x): x is LivePlan => !!x);

describe("shop", () => {
  it("scores every plan 0 to 100 and sorts best first", () => {
    const rows = shop(plans, { who: "me", use: "some", doctor: false, fear: "surprise" });
    expect(rows.length).toBe(plans.length);
    for (const r of rows) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.bad).toBeGreaterThanOrEqual(r.typical);
    }
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
  });
  it("uses real CMS stars and 2024 denial data for the live Medica plan", () => {
    const rows = shop(plans, { who: "me", use: "some", doctor: false, fear: "monthly" });
    const medica = rows.find((r) => r.p.id === "53461MO0070051")!;
    expect(medica.stars).toBe(3);
    expect(medica.denialRate).toBeCloseTo(23.4, 1);
  });
  it("finds denial rows by plan id", () => {
    expect(denialFor("95426MO0410013")?.denialRatePct).toBeCloseTo(19.0, 1);
    expect(denialFor("99999ZZ0000000")).toBeNull();
  });
});
