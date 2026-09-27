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

describe("benefit rows", () => {
  const withRows = {
    ...good,
    referral_required: false,
    excluded_services: ["Cosmetic surgery", "Long-term care"],
    benefits: [
      { service: "mental", text: "$30 copay/office visit; deductible does not apply", kind: "copay", amount: 30, deductible_applies: false, per: "visit", page: 3 },
      { service: "imaging", text: "20% coinsurance", kind: "coinsurance", percent: 20, deductible_applies: true, page: 2 },
      { service: "preventive", text: "No charge", kind: "free", deductible_applies: false },
      { service: "inpatient", text: "$500 copay per day", kind: "copay", amount: 500, per: "day", deductible_applies: true },
      { service: "imaging", text: "duplicate", kind: "coinsurance", percent: 90 },
      { service: "spa", text: "nonsense", kind: "free" },
      { service: "labs", text: "copay with no number", kind: "copay" },
    ],
  };

  it("keeps valid rows once each and drops the rest", () => {
    const d = sanitize(withRows);
    expect(d.rows!.map((r) => r.key)).toEqual(["mental", "imaging", "preventive", "inpatient"]);
    expect(d.referralRequired).toBe(false);
    expect(d.excluded).toEqual(["Cosmetic surgery", "Long-term care"]);
  });

  it("uses the combined x-ray and blood work row for labs when there is no lab row", () => {
    const d = sanitize({ ...good, benefits: [{ service: "xray", text: "20% coinsurance", kind: "coinsurance", percent: 20, deductible_applies: true, page: 4 }] });
    expect(d.rows!.find((r) => r.key === "labs")).toMatchObject({ kind: "coinsurance", percent: 20, page: 4 });
    // A separate lab row wins.
    const own = sanitize({ ...good, benefits: [{ service: "xray", text: "20%", kind: "coinsurance", percent: 20 }, { service: "labs", text: "No charge", kind: "free" }] });
    expect(own.rows!.find((r) => r.key === "labs")!.kind).toBe("free");
  });

  it("feeds the rows into the engine plan, with card copays winning", () => {
    const card = decodedToCard(sanitize(withRows));
    const { plan } = cardPlan(card);
    expect(plan.costSharing[BENEFIT.MENTAL_HEALTH]).toEqual({ kind: "copay", amount: 30, afterDeductible: false, unit: "visit" });
    expect(plan.costSharing[BENEFIT.IMAGING]).toEqual({ kind: "coinsurance", rate: 0.2, afterDeductible: true });
    expect(plan.costSharing[BENEFIT.INPATIENT]).toMatchObject({ kind: "copay", amount: 500, unit: "day", afterDeductible: true });
    expect(plan.costSharing[BENEFIT.PRIMARY_CARE]).toMatchObject({ kind: "copay", amount: 25 });
  });
});
