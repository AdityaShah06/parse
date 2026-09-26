import { describe, it, expect } from "vitest";
import { pickCostShare, parseCostShare } from "./parse-cost-share";
import { loadPlans, BENEFIT, type PlanRow } from "./load-plans";
import { runYear, type CareEvent } from "./engine";
import rows from "../data/mo-plans.json";

const planRows = rows as unknown as PlanRow[];

describe("pickCostShare against the real Missouri data", () => {
  it("reads 'No Charge after deductible' with N/A coinsurance as covered", () => {
    // Plan pays everything once the deductible is met.
    expect(pickCostShare("No Charge after deductible", "Not Applicable")).toEqual(
      { kind: "coinsurance", rate: 0, afterDeductible: true }
    );
    expect(pickCostShare("No Charge", "Not Applicable")).toEqual({
      kind: "coinsurance",
      rate: 0,
      afterDeductible: false,
    });
    expect(pickCostShare("Not Applicable", "Not Applicable")).toEqual({
      kind: "notApplicable",
    });
  });

  it("never marks a covered benefit as not covered when either column has a rule", () => {
    // Every benefit row in mo-plans.json is IsCovered = "Covered". If one
    // column holds anything other than "Not Applicable", the pair has a
    // pricing rule, so it must not come back as notApplicable.
    const offenders: string[] = [];
    for (const row of planRows) {
      for (const b of row.cost_sharing ?? []) {
        const hasRule =
          parseCostShare(b.copay_raw).kind !== "notApplicable" ||
          parseCostShare(b.coins_raw).kind !== "notApplicable";
        const picked = pickCostShare(b.copay_raw, b.coins_raw);
        if (hasRule && picked.kind === "notApplicable") {
          offenders.push(`${row.plan_name} | ${b.benefit} | ${b.copay_raw} | ${b.coins_raw}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps a $30,000 admission on the Catastrophic plan at its ceiling", () => {
    // Anthem Catastrophic: deductible 10,600, OOP max 10,600, inpatient is
    // "No Charge after deductible". The patient pays 10,600 and the plan
    // pays the other 19,400.
    const cat = loadPlans(planRows).find((p) => /Catastrophic/.test(p.plan.name))!;
    const ev: CareEvent[] = [
      {
        date: "2026-05-01",
        label: "Appendectomy",
        serviceType: BENEFIT.INPATIENT,
        allowedAmount: 30000,
        days: 2,
      },
    ];
    const r = runYear(ev, cat.plan);
    expect(r.patientTotal).toBe(10600);
    expect(r.planTotal).toBe(19400);
  });
});
