import { describe, it, expect } from "vitest";
import { runYear, type CareEvent } from "./engine";
import { CASH, medicaidPlan, uninsuredPlan, withCash } from "./other-plans";
import { planFromCard, BENEFIT } from "./load-plans";

const ev = (date: string, serviceType: string, allowedAmount: number, extra: Partial<CareEvent> = {}): CareEvent => ({
  date,
  label: serviceType,
  serviceType,
  allowedAmount,
  ...extra,
});

describe("the other doors", () => {
  it("bills everything in full with no insurance, and never caps it", () => {
    // 1,200 MRI + 500 visit, nothing covered: 1,700 out of pocket, plan pays 0.
    const r = runYear([ev("2026-03-01", BENEFIT.IMAGING, 1200), ev("2026-05-01", BENEFIT.SPECIALIST, 500)], uninsuredPlan());
    expect(r.patientTotal).toBe(1700);
    expect(r.planTotal).toBe(0);
  });

  it("prices covered care at $0 on the sample Medicaid plan", () => {
    const r = runYear([ev("2026-05-01", BENEFIT.INPATIENT, 30000, { days: 2 })], medicaidPlan());
    expect(r.patientTotal).toBe(0);
    expect(r.planTotal).toBe(30000);
  });
});

describe("paying cash", () => {
  const plan = withCash(planFromCard({ deductible: 2000, coinsuranceRate: 0.2, outOfPocketMax: 8000 }));

  it("never moves the deductible or the ceiling", () => {
    // Cash MRI at 450: patient pays 450, deductible still at 0.
    // Then a 1,200 visit through the plan: all 1,200 goes to the deductible.
    // Total 1,650, deductible met 1,200, ceiling progress 1,200.
    const r = runYear([ev("2026-02-01", CASH, 450), ev("2026-04-01", BENEFIT.IMAGING, 1200)], plan);
    expect(r.patientTotal).toBe(1650);
    expect(r.timeline[0].after.deductibleMet).toBe(0);
    expect(r.timeline[1].after.deductibleMet).toBe(1200);
    expect(r.timeline[1].after.outOfPocketSpent).toBe(1200);
  });

  it("can lose to insurance once the deductible is already met", () => {
    // A 2,000 bill meets the deductible first. After that a 100 fill through
    // the plan costs 20% = 20, while cash costs 60. Insurance wins.
    const base = [ev("2026-01-10", BENEFIT.IMAGING, 2000)];
    const insured = runYear([...base, ev("2026-06-01", BENEFIT.GENERIC_DRUGS, 100)], plan);
    const cash = runYear([...base, ev("2026-06-01", CASH, 60)], plan);
    expect(insured.patientTotal).toBe(2020);
    expect(cash.patientTotal).toBe(2060);
  });
});
