import { describe, expect, it } from "vitest";
import { HAS_LOCAL_PRICES, localRate, lookupRate, normalizeCode, type LocalPriceFile } from "./local-prices";

// A small made-up file in the shape scripts/build-local-prices.mjs writes.
const FIXTURE: LocalPriceFile = {
  source: "fixture",
  url: "file:fixture",
  fetchedAt: "2026-09-27T00:00:00Z",
  hospital: "Fixture Hospital",
  codes: {
    "99213": {
      description: "Office visit",
      setting: "outpatient",
      gross: 1000,
      cash: 600,
      payers: [
        { payer: "UnitedHealthcare", plan: "Choice Plus", amount: 300, methodology: "fee schedule" },
        { payer: "UnitedHealthcare", plan: "Navigate", amount: 200, methodology: "fee schedule" },
        { payer: "UnitedHealthcare", plan: "Individual Exchange", amount: 250, methodology: "fee schedule" },
        { payer: "Anthem Blue Cross and Blue Shield", plan: "PPO", amount: 280, methodology: "fee schedule" },
        { payer: "Blue Cross Blue Shield of Kansas City", plan: "Preferred Care Blue", amount: 999, methodology: "fee schedule" },
        { payer: "Cigna", plan: "OAP", amount: null, percentage: 45, methodology: "percent of total billed charges" },
        { payer: "Aetna", plan: "Open Access", amount: null, algorithm: "120% of Medicare", methodology: "other" },
      ],
    },
    "MS-DRG:343": {
      description: "Appendectomy",
      setting: "inpatient",
      gross: 50000,
      cash: null,
      payers: [{ payer: "Home State Health", plan: "Ambetter", amount: 14000, methodology: "case rate" }],
    },
    A0427: { description: "ALS emergency", setting: "outpatient", gross: 2100, cash: null, payers: [] },
  },
  extra: [
    {
      source: "fixture two",
      url: "file:two",
      fetchedAt: "2026-09-27T00:00:00Z",
      hospital: "Second Hospital",
      codes: {
        "99213": {
          description: "Office visit",
          setting: "outpatient",
          gross: 900,
          cash: 500,
          payers: [{ payer: "Medica", plan: "Choice", amount: 190, methodology: "fee schedule" }],
        },
      },
    },
  ],
};

describe("lookupRate", () => {
  it("returns a payer's negotiated rate, the median across its plans", () => {
    const r = lookupRate(FIXTURE, "99213", "UnitedHealthcare");
    expect(r).toMatchObject({ amount: 250, basis: "negotiated", payer: "UnitedHealthcare", plan: "Individual Exchange", hospital: "Fixture Hospital" });
  });

  it("matches payer hints loosely", () => {
    expect(lookupRate(FIXTURE, "99213", "uhc")?.amount).toBe(250);
    expect(lookupRate(FIXTURE, "99213", "united healthcare")?.amount).toBe(250);
    expect(lookupRate(FIXTURE, "99213", "Anthem")).toMatchObject({ amount: 280, basis: "negotiated" });
    expect(lookupRate(FIXTURE, "343", "Ambetter")).toMatchObject({ amount: 14000, payer: "Home State Health" });
  });

  it("does not treat Blue KC as Anthem", () => {
    expect(lookupRate(FIXTURE, "99213", "Anthem")?.payer).toMatch(/Anthem/);
  });

  it("turns a percent of billed charges into dollars with the file's gross charge", () => {
    expect(lookupRate(FIXTURE, "99213", "Cigna")).toMatchObject({ amount: 450, basis: "negotiated", derivedFromPercent: true });
  });

  it("falls back to cash when the payer has only a formula, then to gross", () => {
    expect(lookupRate(FIXTURE, "99213", "Aetna")).toMatchObject({ amount: 600, basis: "cash" });
    expect(lookupRate(FIXTURE, "99213")).toMatchObject({ amount: 600, basis: "cash", hospital: "Fixture Hospital" });
    expect(lookupRate(FIXTURE, "a0427")).toMatchObject({ amount: 2100, basis: "gross" });
  });

  it("looks in the extra hospitals for a negotiated match", () => {
    expect(lookupRate(FIXTURE, "99213", "Medica")).toMatchObject({ amount: 190, basis: "negotiated", hospital: "Second Hospital" });
  });

  it("returns null for a code that is not in the file", () => {
    expect(lookupRate(FIXTURE, "12345")).toBeNull();
    expect(lookupRate({ ...FIXTURE, codes: {}, extra: [] }, "99213")).toBeNull();
  });
});

describe("normalizeCode", () => {
  it("normalizes DRG spellings", () => {
    expect(normalizeCode("DRG 343")).toBe("MS-DRG:343");
    expect(normalizeCode("MS-DRG 0343")).toBe("MS-DRG:343");
    expect(normalizeCode("ms-drg:965")).toBe("MS-DRG:965");
    expect(normalizeCode("a0427")).toBe("A0427");
  });
});

describe("localRate with the shipped file", () => {
  it("never throws, and returns null while the file is an empty shell", () => {
    const r = localRate("99213", "Anthem");
    if (!HAS_LOCAL_PRICES) expect(r).toBeNull();
    else expect(r === null || r.amount > 0).toBe(true);
  });
});
