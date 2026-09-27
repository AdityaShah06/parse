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
import { parseCostShare, type CostShare } from "./parse-cost-share";

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
  /** True if specialists need a referral from a primary care doctor. */
  referralRequired?: boolean | null;
  coveragePeriod?: string | null;
  /** "Services your plan generally does NOT cover", as printed. */
  excluded?: string[];
  /** "Other covered services", as printed. */
  otherCovered?: string[];
};

/** Row keys we map onto the engine's benefit names. */
export const ROW_KEYS = [
  "preventive",
  "primary",
  "specialist",
  "mental",
  "urgent",
  "er",
  "ambulance",
  "labs",
  "xray",
  "imaging",
  "generic",
  "brand",
  "specialty",
  "outpatient_surgery",
  "inpatient",
] as const;
export type RowKey = (typeof ROW_KEYS)[number];

export const ROW_BENEFIT: Record<RowKey, string> = {
  preventive: BENEFIT.PREVENTIVE,
  primary: BENEFIT.PRIMARY_CARE,
  specialist: BENEFIT.SPECIALIST,
  mental: BENEFIT.MENTAL_HEALTH,
  urgent: BENEFIT.URGENT_CARE,
  er: BENEFIT.EMERGENCY_ROOM,
  ambulance: BENEFIT.AMBULANCE,
  labs: BENEFIT.LAB,
  xray: BENEFIT.XRAY,
  imaging: BENEFIT.IMAGING,
  generic: BENEFIT.GENERIC_DRUGS,
  brand: BENEFIT.BRAND_DRUGS,
  specialty: BENEFIT.SPECIALTY_DRUGS,
  outpatient_surgery: BENEFIT.OUTPATIENT_SURGERY,
  inpatient: BENEFIT.INPATIENT,
};

/** One row of the SBC's "common medical event" table, in-network column. */
export type BenefitRow = Evidence & {
  key: RowKey;
  text: string;
  kind: "copay" | "coinsurance" | "free" | "not_covered" | "unknown";
  amount: number | null;
  percent: number | null;
  deductibleApplies: boolean | null;
  per: "visit" | "day" | "stay" | "fill" | null;
};

export type Decoded = PlanInfo & {
  deductible: NumField;
  coinsurancePct: NumField;
  outOfPocketMax: NumField;
  copays: Record<CopayKey, CopayField>;
  /** Every benefit row the reader found, beyond the five card copays. */
  rows?: BenefitRow[];
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
const ROW_KEYS_LITERAL = ROW_KEYS;

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
      referral_required: { type: ["boolean", "null"], description: "Answer to 'Do you need a referral to see a specialist?': true, false, or null if not printed." },
      coverage_period: textField("Coverage period as printed, e.g. '01/01/2026 - 12/31/2026'."),
      benefits: {
        type: "array",
        description: "Every row of the 'Common Medical Event' table you can map to one of the service keys, using the in-network (preferred) provider column only.",
        items: {
          type: "object",
          properties: {
            service: { type: "string", enum: [...ROW_KEYS_LITERAL], description: "Which service this row is. mental = outpatient mental/behavioral health visits; imaging = CT/PET/MRI; xray = diagnostic test (x-ray, blood work); use labs only for a separate lab or blood work row; outpatient_surgery = facility fee for outpatient surgery; inpatient = hospital stay facility fee." },
            text: { type: "string", description: "The in-network cost cell exactly as printed, under 25 words." },
            kind: { type: "string", enum: ["copay", "coinsurance", "free", "not_covered", "unknown"] },
            amount: { type: ["number", "null"], description: "Dollar copay if kind is copay." },
            percent: { type: ["number", "null"], description: "Coinsurance percent if kind is coinsurance, e.g. 20." },
            deductible_applies: { type: ["boolean", "null"], description: "True if the cell or the plan says the deductible applies first; false if it says the deductible does not apply; null if unclear." },
            per: { type: ["string", "null"], enum: ["visit", "day", "stay", "fill", null] },
            page: { type: ["integer", "null"] },
          },
          required: ["service", "text", "kind"],
        },
      },
      excluded_services: { type: "array", items: { type: "string" }, description: "The list under 'Services Your Plan Generally Does NOT Cover', each item as printed, short." },
      other_covered_services: { type: "array", items: { type: "string" }, description: "The list under 'Other Covered Services', each item as printed, short." },
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
  "For the benefits list, read the in-network column of the Common Medical Event table row by row; a cell like 'No charge' is kind free; '$30 copay/visit' is a copay with amount 30; '20% coinsurance' is coinsurance with percent 20; say whether the deductible applies only if the cell or its note says so.",
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

/** Like cleanText, but a long item ends at a word with an ellipsis instead of mid-word. */
function clip(v: unknown, maxLen: number): string | null {
  const t = cleanText(v, 1000)?.replace(/\s+/g, " ");
  if (!t || t.length <= maxLen) return t ?? null;
  return t.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

/** SBCs print "High-Deductible Health Plan" or "PPO Plan"; the app wants the short type. */
function planTypeOf(v: unknown): string | null {
  const t = cleanText(v, 200);
  if (!t) return null;
  const code = t.toUpperCase().match(/\b(HMO|PPO|EPO|POS|HDHP)\b/);
  if (code) return code[1];
  if (/high[\s-]*deductible/i.test(t)) return "HDHP";
  return t.length <= 12 ? t : null;
}

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

function cleanList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => clip(x, 100)).filter((x): x is string => !!x).slice(0, 30) : [];
}

function cleanRows(v: unknown): BenefitRow[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: BenefitRow[] = [];
  for (const raw of v.slice(0, 40)) {
    const o = obj(raw);
    const key = o.service as RowKey;
    if (!ROW_KEYS.includes(key) || seen.has(key)) continue;
    const kind = ["copay", "coinsurance", "free", "not_covered", "unknown"].includes(o.kind as string) ? (o.kind as BenefitRow["kind"]) : "unknown";
    const amount = cleanNumber(o.amount, 20000);
    const percent = cleanNumber(o.percent, 100);
    // A row must carry the number its kind needs, or it isn't trusted.
    if (kind === "copay" && amount === null) continue;
    if (kind === "coinsurance" && percent === null) continue;
    seen.add(key);
    out.push({
      key,
      text: cleanText(o.text, 160) ?? "",
      kind,
      amount: kind === "copay" ? amount : null,
      percent: kind === "coinsurance" ? percent : null,
      deductibleApplies: typeof o.deductible_applies === "boolean" ? o.deductible_applies : null,
      per: ["visit", "day", "stay", "fill"].includes(o.per as string) ? (o.per as BenefitRow["per"]) : null,
      quote: cleanText(o.text, 160),
      page: cleanPage(o.page),
    });
  }
  return out;
}

/**
 * The standard SBC template prints one row, "Diagnostic test (x-ray, blood
 * work)", for both. When the document has no separate lab row, that printed
 * row is the lab price too, with the same quote and page.
 */
function withLabs(rows: BenefitRow[]): BenefitRow[] {
  const xray = rows.find((r) => r.key === "xray");
  if (!xray || rows.some((r) => r.key === "labs")) return rows;
  return [...rows, { ...xray, key: "labs" }];
}

/** A benefit row as the engine's cost-sharing shape, or null when it shouldn't override the plan default. */
export function rowToCostShare(r: BenefitRow): CostShare | null {
  if (r.kind === "free") return { kind: "coinsurance", rate: 0, afterDeductible: r.deductibleApplies === true };
  if (r.kind === "copay" && r.amount !== null)
    return { kind: "copay", amount: r.amount, afterDeductible: r.deductibleApplies === true, unit: r.per === "day" ? "day" : r.per === "stay" ? "stay" : "visit" };
  if (r.kind === "coinsurance" && r.percent !== null) return { kind: "coinsurance", rate: r.percent / 100, afterDeductible: r.deductibleApplies !== false };
  return null;
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
    planType: planTypeOf(o.plan_type),
    memberPhone: cleanText(o.member_phone, 40),
    nurseLine: cleanText(o.nurse_line, 40),
    website: cleanText(o.website, 120),
    selfFunded: typeof o.self_funded === "boolean" ? o.self_funded : null,
    referralRequired: typeof o.referral_required === "boolean" ? o.referral_required : null,
    coveragePeriod: cleanText(o.coverage_period, 60),
    excluded: cleanList(o.excluded_services),
    otherCovered: cleanList(o.other_covered_services),
    rows: withLabs(cleanRows(o.benefits)),
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
  const rows: Record<string, CostShare> = {};
  for (const r of d.rows ?? []) {
    const cs = rowToCostShare(r);
    if (cs) rows[ROW_BENEFIT[r.key]] = cs;
  }
  return {
    deductible: d.deductible.value,
    coinsurancePct: d.coinsurancePct.value,
    outOfPocketMax: d.outOfPocketMax.value,
    monthlyPremium: null,
    copays,
    copaysAfterDeductible,
    rows,
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
