import { describe, it, expect } from "vitest";
import { NotAnSbc, decodedToCard, sampleDecoded, sanitize } from "./decode";
import { cardPlan } from "./card";
import { BENEFIT } from "./load-plans";

const field = (value: unknown, quote = "q", page: unknown = 1) => ({ value, quote, page });
const copay = (value: unknown, after = false) => ({ ...field(value), after_deductible: after });

const good = {
  is_sbc: true,
  plan_name: "Choice Plus Gold",
  insurer: "Example Health",
  deductible: field(1500, "$1,500 individual / $3,000 family", 1),
  coinsurance_percent: field(20),
  out_of_pocket_max: field("$6,000"),
  copay_primary: copay(25),
  copay_specialist: copay(50),
  copay_urgent: copay(75),
  copay_er: copay(300, true),
  copay_generic: copay(null),
};

describe("sanitize", () => {
  it("keeps clean values and parses money strings", () => {
    const d = sanitize(good);
    expect(d.deductible).toEqual({ value: 1500, quote: "$1,500 individual / $3,000 family", page: 1 });
    expect(d.outOfPocketMax.value).toBe(6000);
    expect(d.copays.er).toMatchObject({ value: 300, afterDeductible: true });
    expect(d.copays.generic.value).toBeNull();
  });

  it("turns nonsense into blanks instead of numbers", () => {
    const d = sanitize({
      ...good,
      deductible: field(-5),
      coinsurance_percent: field(140),
      out_of_pocket_max: field("about six grand"),
      copay_primary: "25",
      copay_specialist: copay(50, "yes" as unknown as boolean),
    });
    expect(d.deductible.value).toBeNull();
    expect(d.deductible.quote).toBeNull();
    expect(d.coinsurancePct.value).toBeNull();
    expect(d.outOfPocketMax.value).toBeNull();
    expect(d.copays.primary.value).toBeNull();
    // A truthy string is not `true`: we only trust an explicit boolean.
    expect(d.copays.specialist.afterDeductible).toBe(false);
  });

  it("rejects a document that is not a benefits summary", () => {
    expect(() => sanitize({ ...good, is_sbc: false })).toThrow(NotAnSbc);
  });

  it("survives a completely empty answer", () => {
    const d = sanitize({});
    expect(d.deductible.value).toBeNull();
    expect(d.copays.primary.value).toBeNull();
  });
});

describe("decoded plan to engine plan", () => {
  it("prices a copay that applies after the deductible as after-deductible", () => {
    const { plan } = cardPlan(decodedToCard(sanitize(good)));
    expect(plan.deductible).toBe(1500);
    expect(plan.coinsuranceRate).toBe(0.2);
    expect(plan.costSharing[BENEFIT.PRIMARY_CARE]).toEqual({
      kind: "copay",
      amount: 25,
      afterDeductible: false,
      unit: "visit",
    });
    expect(plan.costSharing[BENEFIT.EMERGENCY_ROOM]).toMatchObject({ amount: 300, afterDeductible: true });
    expect(plan.costSharing[BENEFIT.GENERIC_DRUGS]).toBeUndefined();
  });

  it("reads the offline sample from real CMS data", () => {
    // UHC Bronze Standard (No Referrals): deductible 7,500, ceiling 10,000,
    // 50% coinsurance, $50 primary care, $100 specialist, $75 urgent care,
    // $25 generic, ER billed as coinsurance so no copay.
    const d = sampleDecoded();
    expect(d.source).toBe("sample");
    expect(d.deductible.value).toBe(7500);
    expect(d.outOfPocketMax.value).toBe(10000);
    expect(d.coinsurancePct.value).toBe(50);
    expect(d.copays.primary.value).toBe(50);
    expect(d.copays.specialist.value).toBe(100);
    expect(d.copays.urgent.value).toBe(75);
    expect(d.copays.generic.value).toBe(25);
    expect(d.copays.er.value).toBeNull();
  });
});
