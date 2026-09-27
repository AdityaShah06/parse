import { describe, expect, it } from "vitest";
import { runYear } from "./engine";
import { eventCost, visitCost, visitDate } from "./care";
import { CATALOG } from "./catalog";
import { uninsuredPlan } from "./other-plans";
import { PRICES } from "./prices";

const plan = CATALOG[0].plan;

describe("care pricing", () => {
  it("prices a visit as the engine's own timeline entry", () => {
    const c = visitCost(plan, [], "urgentCare", "2026-03-01");
    const year = runYear([{ date: "2026-03-01", label: "x", serviceType: "Urgent Care Centers or Facilities", allowedAmount: PRICES.urgentCare.typical }], plan);
    expect(c.you).toBe(year.timeline[0].patientPays);
    expect(c.you + c.plan).toBeCloseTo(PRICES.urgentCare.typical, 2);
  });

  it("charges the full price with no insurance", () => {
    expect(visitCost(uninsuredPlan(), [], "er", "2026-05-01").you).toBe(PRICES.er.typical);
  });

  it("adds an ambulance balance bill on top of cost sharing", () => {
    const inNet = visitCost(plan, [], "ambulance", "2026-05-01");
    const out = visitCost(plan, [], "ambulance", "2026-05-01", { balanceBilled: 1093 });
    expect(out.balanceBilled).toBe(1093);
    expect(out.you).toBeCloseTo(inNet.you + 1093, 2);
  });

  it("keeps the visit date inside the 2026 plan year", () => {
    expect(visitDate(new Date(2025, 5, 1))).toBe("2026-01-15");
    expect(visitDate(new Date(2027, 0, 1))).toBe("2026-12-15");
    expect(visitDate(new Date(2026, 8, 26))).toBe("2026-09-26");
  });

  it("does not mutate the base year", () => {
    const base = [{ date: "2026-01-02", label: "a", serviceType: "Specialist Visit", allowedAmount: 260 }];
    eventCost(plan, base, { date: "2026-02-02", label: "b", serviceType: "Specialist Visit", allowedAmount: 260 });
    expect(base).toHaveLength(1);
  });
});
