import { describe, expect, it } from "vitest";
import { runYear } from "./engine";
import { bestMatch, isHealthcareGovState, matchScore, pickArray, toEnginePlanDetailed, type ApiPlan } from "./marketplace";
import search from "./fixtures/marketplace/plans-search-65201.json";

const plans = (search as unknown as { plans: ApiPlan[] }).plans;

describe("toEnginePlan", () => {
  it("turns complete plans into engine plans and refuses ones with no out-of-pocket max", () => {
    expect(plans.length).toBeGreaterThan(0);
    const usable = plans.filter((p) => (p.moops ?? []).length > 0);
    expect(usable.length).toBeGreaterThan(0);
    for (const p of plans.filter((q) => !(q.moops ?? []).length)) expect(toEnginePlanDetailed(p)).toBeNull();
    for (const p of usable) {
      const out = toEnginePlanDetailed(p);
      expect(out).not.toBeNull();
      const plan = out!.plan;
      expect(plan.deductible).toBeGreaterThanOrEqual(0);
      expect(plan.outOfPocketMax).toBeGreaterThan(0);
      const year = runYear([{ date: "2026-03-01", label: "MRI", serviceType: Object.keys(plan.costSharing)[0] ?? "Imaging", allowedAmount: 1500 }], plan);
      expect(year.patientTotal).toBeLessThanOrEqual(plan.outOfPocketMax);
    }
  });
});

describe("helpers", () => {
  it("knows which states use HealthCare.gov", () => {
    expect(isHealthcareGovState("MO")).toBe(true);
    expect(isHealthcareGovState("CA")).toBe(false);
    expect(isHealthcareGovState("IL")).toBe(false);
  });
  it("reads either array key", () => {
    expect(pickArray<number>({ coverage: [1, 2] }, ["coverage"])).toEqual([1, 2]);
    expect(pickArray<number>({ "Provider & Drug Coverage": [3] }, ["coverage"])).toEqual([3]);
  });
  it("matches a Google place to the right provider", () => {
    const place = { name: "Boone Hospital Center", address: "1600 E Broadway, Columbia, MO 65201" };
    const cands = [
      { name: "BOONE HOSPITAL CENTER", address: "1600 E BROADWAY, COLUMBIA, MO 65201" },
      { name: "UNIVERSITY HOSPITAL", address: "1 HOSPITAL DR, COLUMBIA, MO 65212" },
    ];
    expect(matchScore(place, cands[0])).toBeGreaterThan(matchScore(place, cands[1]));
    expect(bestMatch(place, cands)?.candidate.name).toBe("BOONE HOSPITAL CENTER");
  });
});
