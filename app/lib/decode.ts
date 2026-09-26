/**
 * Decoding a Summary of Benefits and Coverage (SBC) into card numbers.
 *
 * The AI only reads. It returns what the document prints, with a quote and a
 * page for every number, and the visitor confirms each one before it reaches
 * the engine. This file validates whatever the model sent back, so a malformed
 * or invented answer turns into a blank field, never into a number.
 */

import type { CardInput, CopayKey } from "./card";
import rows from "../data/mo-plans.json";
import type { PlanRow } from "./load-plans";
import { BENEFIT } from "./load-plans";
import { parseCostShare } from "./parse-cost-share";

export type Evidence = { quote: string | null; page: number | null };
export type NumField = Evidence & { value: number | null };
export type CopayField = NumField & { afterDeductible: boolean };

export const COPAY_KEYS: CopayKey[] = ["primary", "specialist", "urgent", "er", "generic"];

export type PlanInfo = {
  planName: string | null;
  insurer: string | null;
  network: string | null;
  planType: string | null;
  memberPhone: string | null;
  nurseLine: string | null;
  website: string | null;
  /**
   * True if the document says the employer pays claims itself (self-funded).
   * State insurance laws, including ambulance protections, usually do not
   * reach these plans, and complaints go to the U.S. Department of Labor.
   */
  selfFunded: boolean | null;
};

export type Decoded = PlanInfo & {
  deductible: NumField;
  coinsurancePct: NumField;
  outOfPocketMax: NumField;
  copays: Record<CopayKey, CopayField>;
  source: "pdf" | "sample";
};

// ---------------------------------------------------------------------------
// The tool the model must call. Strict shapes, everything nullable.
// ---------------------------------------------------------------------------

const numField = (description: string) => ({
  type: "object",
  description,
  properties: {
    value: { type: ["number", "null"], description: "The number exactly as printed, or null if absent." },
    quote: { type: ["string", "null"], description: "The exact words from the document, under 20 words." },
    page: { type: ["integer", "null"], description: "1-based page number where the quote appears." },
  },
  required: ["value", "quote", "page"],
});

const copayField = (description: string) => ({
  ...numField(description),
  properties: {
    ...numField(description).properties,
    after_deductible: {
      type: "boolean",
      description: "True only if the document says the deductible must be met before this copay applies.",
    },
  },
  required: ["value", "quote", "page", "after_deductible"],
});

const textField = (description: string) => ({ type: ["string", "null"], description });

/** JSON Schema for what the model must return. */
export const EXTRACT_SCHEMA = {
    type: "object",
    properties: {
      is_sbc: {
        type: "boolean",
        description: "False if this document is not a health plan Summary of Benefits and Coverage.",
      },
      plan_name: textField("Plan name as printed."),
      insurer: textField("Insurance company name."),
      network: textField("Network name if printed, for example 'Choice Plus'."),
      plan_type: textField("HMO, PPO, EPO, POS or HDHP if printed."),
      member_phone: textField("Member or customer service phone number."),
      nurse_line: textField("24/7 nurse line phone number if printed."),
      website: textField("Plan website if printed."),
      self_funded: {
        type: ["boolean", "null"],
        description:
          "True if the document says the plan is self-funded or self-insured by the employer, false if it says the insurer bears the risk, null if not stated.",
      },
      deductible: numField("In-network individual (single) overall deductible in dollars."),
      coinsurance_percent: numField(
        "In-network coinsurance percent the member pays after the deductible for most services, e.g. 20 for 20%."
      ),
      out_of_pocket_max: numField("In-network individual out-of-pocket limit in dollars."),
      copay_primary: copayField("In-network copay in dollars for a primary care visit to treat an injury or illness."),
      copay_specialist: copayField("In-network copay in dollars for a specialist visit."),
      copay_urgent: copayField("In-network copay in dollars for urgent care."),
      copay_er: copayField("In-network copay in dollars for emergency room care (facility)."),
      copay_generic: copayField("Copay in dollars for a generic (tier 1) prescription, retail 30-day supply."),
    },
    required: [
      "is_sbc",
      "deductible",
      "coinsurance_percent",
      "out_of_pocket_max",
      "copay_primary",
      "copay_specialist",
      "copay_urgent",
      "copay_er",
      "copay_generic",
    ],
} as const;

export const EXTRACT_SYSTEM = [
  "You read health plan documents and record numbers. You never compute, estimate or infer a number.",
  "Record only in-network, individual (single person) values exactly as printed.",
  "If a value is missing, unclear, or only given for a family, record null.",
  "A service billed as coinsurance, not a flat dollar copay, has a null copay value.",
  "Every value must come with a short exact quote and its page number.",
  "You give no medical advice and no opinions about the plan.",
].join(" ");

// ---------------------------------------------------------------------------
// Validation: anything that does not look right becomes null.
// ---------------------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function cleanNumber(v: unknown, max: number): number | null {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string"
        ? Number(v.replace(/[$,%\s]/g, ""))
        : NaN;
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

const cleanText = (v: unknown, maxLen = 160): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, maxLen) : null;

const cleanPage = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v < 100 ? v : null;

function num(raw: unknown, max: number): NumField {
  const o = obj(raw);
  const value = cleanNumber(o.value, max);
  return { value, quote: value === null ? null : cleanText(o.quote), page: value === null ? null : cleanPage(o.page) };
}

function copay(raw: unknown): CopayField {
  return { ...num(raw, 5000), afterDeductible: obj(raw).after_deductible === true };
}

export class NotAnSbc extends Error {}

/** Turn the model's tool input into a Decoded, or throw NotAnSbc. */
export function sanitize(raw: unknown): Decoded {
  const o = obj(raw);
  if (o.is_sbc === false) throw new NotAnSbc("This does not look like a Summary of Benefits and Coverage.");
  return {
    planName: cleanText(o.plan_name),
    insurer: cleanText(o.insurer),
    network: cleanText(o.network),
    planType: cleanText(o.plan_type, 12),
    memberPhone: cleanText(o.member_phone, 40),
    nurseLine: cleanText(o.nurse_line, 40),
    website: cleanText(o.website, 120),
    selfFunded: typeof o.self_funded === "boolean" ? o.self_funded : null,
    deductible: num(o.deductible, 50000),
    coinsurancePct: num(o.coinsurance_percent, 100),
    outOfPocketMax: num(o.out_of_pocket_max, 50000),
    copays: {
      primary: copay(o.copay_primary),
      specialist: copay(o.copay_specialist),
      urgent: copay(o.copay_urgent),
      er: copay(o.copay_er),
      generic: copay(o.copay_generic),
    },
    source: "pdf",
  };
}

/** What the confirm screen hands to the engine after the visitor checks it. */
export function decodedToCard(d: Decoded): CardInput {
  const copays: CardInput["copays"] = {};
  const copaysAfterDeductible: NonNullable<CardInput["copaysAfterDeductible"]> = {};
  for (const k of COPAY_KEYS) {
    const c = d.copays[k];
    if (c.value !== null) {
      copays[k] = c.value;
      if (c.afterDeductible) copaysAfterDeductible[k] = true;
    }
  }
  return {
    deductible: d.deductible.value,
    coinsurancePct: d.coinsurancePct.value,
    outOfPocketMax: d.outOfPocketMax.value,
    monthlyPremium: null,
    copays,
    copaysAfterDeductible,
  };
}

// ---------------------------------------------------------------------------
// Offline sample: a real 2026 Missouri plan, read from the federal data we
// already ship, so the demo works with no key and no network.
// ---------------------------------------------------------------------------

const SAMPLE_ID = "95426MO0410013-01";

export function sampleDecoded(): Decoded {
  const row = (rows as unknown as PlanRow[]).find((r) => r.variant_id === SAMPLE_ID)!;
  const benefit = (name: string) => row.cost_sharing?.find((b) => b.benefit === name);
  const cite = "CMS 2026 plan data";

  const copayFrom = (name: string): CopayField => {
    const b = benefit(name);
    const cs = parseCostShare(b?.copay_raw ?? null);
    return cs.kind === "copay"
      ? { value: cs.amount, afterDeductible: cs.afterDeductible, quote: b?.copay_raw ?? null, page: null }
      : { value: null, afterDeductible: false, quote: null, page: null };
  };

  return {
    planName: row.plan_name,
    insurer: row.issuer,
    network: null,
    planType: row.plan_type,
    memberPhone: null,
    nurseLine: null,
    website: row.sbc_url,
    selfFunded: false,
    deductible: { value: row.deductible, quote: `Deductible $${row.deductible?.toLocaleString()}`, page: null },
    coinsurancePct: {
      value: row.default_coinsurance === null ? null : Math.round(row.default_coinsurance * 100),
      quote: `${Math.round((row.default_coinsurance ?? 0) * 100)}% coinsurance after deductible`,
      page: null,
    },
    outOfPocketMax: {
      value: row.out_of_pocket_max,
      quote: `Out-of-pocket maximum $${row.out_of_pocket_max?.toLocaleString()}`,
      page: null,
    },
    copays: {
      primary: copayFrom(BENEFIT.PRIMARY_CARE),
      specialist: copayFrom(BENEFIT.SPECIALIST),
      urgent: copayFrom(BENEFIT.URGENT_CARE),
      er: copayFrom(BENEFIT.EMERGENCY_ROOM),
      generic: copayFrom(BENEFIT.GENERIC_DRUGS),
    },
    source: "sample",
  };
}

export const SAMPLE_CITATION = "A real 2026 Missouri plan, from CMS public plan data";
