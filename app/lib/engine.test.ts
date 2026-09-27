import { describe, it, expect } from "vitest";
import { parseCostShare } from "./parse-cost-share";
import {
  applyEvent,
  runYear,
  rankPlans,
  emptyAccumulator,
  type Plan,
  type CareEvent,
} from "./engine";

const PLAN: Plan = {
  name: "Test Silver",
  deductible: 2000,
  coinsuranceRate: 0.2,
  outOfPocketMax: 8000,
  monthlyPremium: 300,
  costSharing: {
    "Primary Care Visit to Treat an Injury or Illness": {
      kind: "copay",
      amount: 30,
      afterDeductible: false,
      unit: "visit",
    },
    // Deductible waived: the bare "20.00%" case in the PUF.
    "Urgent Care Centers or Facilities": {
      kind: "coinsurance",
      rate: 0.2,
      afterDeductible: false,
    },
  },
};

const mri = (over: Partial<CareEvent> = {}): CareEvent => ({
  date: "2026-03-03",
  label: "Knee MRI",
  serviceType: "imaging",
  allowedAmount: 1200,
  ...over,
});

/**
 * Every expected number below was computed by hand before the code was
 * written. If a test fails, check the arithmetic in the comment before
 * assuming the test is wrong.
 */
describe("applyEvent", () => {
  it("charges the full allowed amount below the deductible", () => {
    // Nothing spent. Deductible is 2000, MRI is 1200, so all 1200 is the
    // patient's. Insurance pays nothing. This is the case people find shocking.
    const r = applyEvent(emptyAccumulator(), mri(), PLAN);

    expect(r.patientPays).toBe(1200);
    expect(r.planPays).toBe(0);
    expect(r.after.deductibleMet).toBe(1200);
    expect(r.after.outOfPocketSpent).toBe(1200);
  });

  it("splits a bill that straddles the deductible", () => {
    // 1500 already met, so 500 of deductible remains.
    // 500 of the MRI is the patient's in full.
    // Remaining 700 splits at 20% -> 140.
    // Patient 640, insurance 560.
    const r = applyEvent(
      { deductibleMet: 1500, outOfPocketSpent: 1500 },
      mri(),
      PLAN
    );

    expect(r.toDeductible).toBe(500);
    expect(r.costShare).toBe(140);
    expect(r.patientPays).toBe(640);
    expect(r.planPays).toBe(560);
    expect(r.after.deductibleMet).toBe(2000);
    expect(r.after.outOfPocketSpent).toBe(2140);
  });

  it("clamps at the out-of-pocket maximum", () => {
    // 7900 of 8000 spent. Deductible already met.
    // Coinsurance on 1000 would be 200, but only 100 of room is left.
    const r = applyEvent(
      { deductibleMet: 2000, outOfPocketSpent: 7900 },
      mri({ allowedAmount: 1000 }),
      PLAN
    );

    expect(r.patientPays).toBe(100);
    expect(r.planPays).toBe(900);
    expect(r.hitOutOfPocketMax).toBe(true);
    expect(r.after.outOfPocketSpent).toBe(8000);
  });

  it("charges nothing past the out-of-pocket maximum", () => {
    const r = applyEvent(
      { deductibleMet: 2000, outOfPocketSpent: 8000 },
      mri({ allowedAmount: 1000 }),
      PLAN
    );

    expect(r.patientPays).toBe(0);
    expect(r.planPays).toBe(1000);
  });

  it("charges nothing for preventive care and leaves the accumulator alone", () => {
    // ACA 2713: USPSTF-recommended preventive services, no cost sharing.
    const r = applyEvent(
      emptyAccumulator(),
      mri({ label: "Annual physical", allowedAmount: 250, preventive: true }),
      PLAN
    );

    expect(r.patientPays).toBe(0);
    expect(r.planPays).toBe(250);
    expect(r.after.deductibleMet).toBe(0);
  });

  it("applies a copay without touching the deductible", () => {
    const r = applyEvent(
      emptyAccumulator(),
      mri({ label: "PCP visit", serviceType: "Primary Care Visit to Treat an Injury or Illness", allowedAmount: 180 }),
      PLAN
    );

    expect(r.patientPays).toBe(30);
    expect(r.planPays).toBe(150);
    expect(r.after.deductibleMet).toBe(0);
    expect(r.after.outOfPocketSpent).toBe(30);
  });

  it("applies cost sharing from the first dollar when the deductible is waived", () => {
    // The bare "20.00%" case. No deductible step: 20% of 500 = 100.
    // Counts toward the out-of-pocket max, not toward the deductible.
    const r = applyEvent(
      emptyAccumulator(),
      mri({
        label: "Urgent care",
        serviceType: "Urgent Care Centers or Facilities",
        allowedAmount: 500,
      }),
      PLAN
    );

    expect(r.toDeductible).toBe(0);
    expect(r.patientPays).toBe(100);
    expect(r.planPays).toBe(400);
    expect(r.after.deductibleMet).toBe(0);
    expect(r.after.outOfPocketSpent).toBe(100);
  });

  it("ignores the ceiling for a benefit excluded from the MOOP", () => {
    // IsExclFromInnMOOP = 'Yes'. Deductible met, 7,900 of 8,000 spent, so only
    // 100 of room is left. An excluded benefit is not capped by that room:
    // the patient owes the full 20% of 1,000, and the 200 does not accumulate.
    const r = applyEvent(
      { deductibleMet: 2000, outOfPocketSpent: 7900 },
      mri({ allowedAmount: 1000, excludedFromMoop: true }),
      PLAN
    );

    expect(r.patientPays).toBe(200);
    expect(r.planPays).toBe(800);
    expect(r.outsideCeiling).toBe(true);
    expect(r.hitOutOfPocketMax).toBe(false);
    expect(r.after.outOfPocketSpent).toBe(7900);
  });

  it("bills a balance even at the out-of-pocket maximum", () => {
    // The ground ambulance case. Congress carved ground ambulances out of the
    // No Surprises Act, so an out-of-network ride can balance bill you, and
    // that money sits outside the out-of-pocket maximum entirely.
    const r = applyEvent(
      { deductibleMet: 2000, outOfPocketSpent: 8000 },
      mri({
        label: "Ground ambulance",
        serviceType: "ambulance",
        allowedAmount: 450,
        balanceBilled: 1400,
      }),
      PLAN
    );

    expect(r.patientPays).toBe(1400);
    expect(r.after.outOfPocketSpent).toBe(8000);
  });
});

describe("coinsurance with a per-event cap", () => {
  // SBCs print Rx tiers as "10% coinsurance up to $50": the percentage, but
  // never more than the cap per fill.
  const capped: Plan = {
    ...PLAN,
    costSharing: {
      generic: { kind: "coinsurance", rate: 0.1, afterDeductible: false, maxPerEvent: 50 },
      brand: { kind: "coinsurance", rate: 0.2, afterDeductible: true, maxPerEvent: 100 },
    },
  };
  const fill = (serviceType: string, allowedAmount: number): CareEvent => ({ date: "2026-02-01", label: "Fill", serviceType, allowedAmount });

  it("caps the coinsurance at the per-event maximum", () => {
    // 10% of $1,200 is $120, capped at $50. Plan pays $1,150.
    const r = applyEvent(emptyAccumulator(), fill("generic", 1200), capped);
    expect(r.patientPays).toBe(50);
    expect(r.planPays).toBe(1150);
    expect(r.after.outOfPocketSpent).toBe(50);
  });

  it("leaves coinsurance under the cap alone", () => {
    // 10% of $300 is $30, under the $50 cap.
    const r = applyEvent(emptyAccumulator(), fill("generic", 300), capped);
    expect(r.patientPays).toBe(30);
  });

  it("applies the deductible first; the cap only limits the coinsurance after it", () => {
    // $3,000 fill, $2,000 deductible unmet: $2,000 to the deductible, then
    // 20% of the other $1,000 is $200, capped at $100. Patient $2,100, plan $900.
    const r = applyEvent(emptyAccumulator(), fill("brand", 3000), capped);
    expect(r.toDeductible).toBe(2000);
    expect(r.costShare).toBe(100);
    expect(r.patientPays).toBe(2100);
    expect(r.planPays).toBe(900);
  });
});

describe("per-day copays", () => {
  it("multiplies a per-day copay by the length of stay", () => {
    // $1000/day, 4-day admission, deductible waived, allowed amount 30000.
    // Patient owes 4000, not 1000.
    const plan: Plan = {
      ...PLAN,
      costSharing: {
        "Inpatient Hospital Services (e.g., Hospital Stay)": {
          kind: "copay",
          amount: 1000,
          afterDeductible: false,
          unit: "day",
        },
      },
    };

    const r = applyEvent(
      emptyAccumulator(),
      {
        date: "2026-05-01",
        label: "Hospital stay",
        serviceType: "Inpatient Hospital Services (e.g., Hospital Stay)",
        allowedAmount: 30000,
        days: 4,
      },
      plan
    );

    expect(r.patientPays).toBe(4000);
    expect(r.planPays).toBe(26000);
  });

  it("caps a per-day copay at InpatientCopaymentMaximumDays", () => {
    // Same $1000/day copay, 12-day stay, but the plan caps it at 5 days.
    // Patient owes 5000, not 12000.
    const plan: Plan = {
      ...PLAN,
      inpatientCopayMaxDays: 5,
      costSharing: {
        "Inpatient Hospital Services (e.g., Hospital Stay)": {
          kind: "copay", amount: 1000, afterDeductible: false, unit: "day",
        },
      },
    };

    const r = applyEvent(
      emptyAccumulator(),
      {
        date: "2026-05-01",
        label: "Long hospital stay",
        serviceType: "Inpatient Hospital Services (e.g., Hospital Stay)",
        allowedAmount: 90000,
        days: 12,
      },
      plan
    );

    expect(r.patientPays).toBe(5000);
  });
});

describe("runYear", () => {
  it("accumulates across a year in date order", () => {
    // Physical (preventive)        0      ded    0  oop     0
    // MRI 1200, all deductible  1200      ded 1200  oop  1200
    // PCP visit, copay            30      ded 1200  oop  1230
    // Surgery 6000:
    //   800 finishes the deductible, 5200 at 20% = 1040 -> 1840
    // Patient total 3070, premium 3600, true cost 6670
    const year: CareEvent[] = [
      {
        date: "2026-09-05",
        label: "Surgery",
        serviceType: "surgery",
        allowedAmount: 6000,
      },
      {
        date: "2026-01-15",
        label: "Annual physical",
        serviceType: "preventive",
        allowedAmount: 250,
        preventive: true,
      },
      {
        date: "2026-06-10",
        label: "PCP visit",
        serviceType: "Primary Care Visit to Treat an Injury or Illness",
        allowedAmount: 180,
      },
      mri(),
    ];

    const r = runYear(year, PLAN);

    expect(r.timeline.map((t) => t.event.label)).toEqual([
      "Annual physical",
      "Knee MRI",
      "PCP visit",
      "Surgery",
    ]);
    expect(r.patientTotal).toBe(3070);
    expect(r.planTotal).toBe(4560);
    expect(r.annualPremium).toBe(3600);
    expect(r.trueAnnualCost).toBe(6670);
  });
});

describe("rankPlans", () => {
  it("ranks the cheap-premium plan below the expensive one on a bad year", () => {
    // Bronze: premium 2400/yr, 7000 deductible, 40% coinsurance, 9200 OOP max
    //   7000 + 40% of 13000 = 12200, clamped to 9200. Total 11600.
    // Silver: premium 4800/yr, 2000 deductible, 20% coinsurance, 8000 OOP max
    //   2000 + 20% of 18000 = 5600. Total 10400.
    const bronze: Plan = {
      name: "Bronze",
      deductible: 7000,
      coinsuranceRate: 0.4,
      outOfPocketMax: 9200,
      monthlyPremium: 200,
      costSharing: {},
    };
    const silver: Plan = { ...PLAN, name: "Silver", monthlyPremium: 400 };

    const ranked = rankPlans(
      [
        {
          date: "2026-04-01",
          label: "Hospitalization",
          serviceType: "inpatient",
          allowedAmount: 20000,
        },
      ],
      [bronze, silver]
    );

    expect(ranked[0].plan.name).toBe("Silver");
    expect(ranked[0].trueAnnualCost).toBe(10400);
    expect(ranked[1].trueAnnualCost).toBe(11600);
  });
});

describe("parseCostShare", () => {
  it("covers every observed Missouri cost-sharing string shape", () => {
    expect(parseCostShare("Not Applicable")).toEqual({ kind: "notApplicable" });
    expect(parseCostShare(null)).toEqual({ kind: "notApplicable" });

    expect(parseCostShare("No Charge")).toEqual({
      kind: "coinsurance", rate: 0, afterDeductible: false,
    });
    expect(parseCostShare("No Charge after deductible")).toEqual({
      kind: "coinsurance", rate: 0, afterDeductible: true,
    });

    // The distinction that matters: bare percentage waives the deductible.
    expect(parseCostShare("20.00%")).toEqual({
      kind: "coinsurance", rate: 0.2, afterDeductible: false,
    });
    expect(parseCostShare("20.00% Coinsurance after deductible")).toEqual({
      kind: "coinsurance", rate: 0.2, afterDeductible: true,
    });

    expect(parseCostShare("$30")).toEqual({
      kind: "copay", amount: 30, afterDeductible: false, unit: "visit",
    });
    expect(parseCostShare("$1,500 Copay after deductible")).toEqual({
      kind: "copay", amount: 1500, afterDeductible: true, unit: "visit",
    });

    // Inpatient units. These would otherwise silently underprice a stay.
    expect(parseCostShare("$1000.00 Copay per Day")).toEqual({
      kind: "copay", amount: 1000, afterDeductible: false, unit: "day",
    });
    expect(parseCostShare("$500.00 Copay per Stay after deductible")).toEqual({
      kind: "copay", amount: 500, afterDeductible: true, unit: "stay",
    });
  });
});
