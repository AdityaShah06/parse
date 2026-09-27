/**
 * What care actually costs in Columbia, Missouri.
 *
 * Hospital parts are real negotiated rates from MU Health Care's own
 * machine-readable standard charges file (federal hospital price
 * transparency rule, 45 CFR 180), built by scripts/build-local-prices.mjs
 * into data/local-prices.json. "Typical" is the median across every insurer
 * contract in that file; the low and high are the 25th and 75th percentiles.
 * applyPayer() swaps in your own insurer's contracted rate where the file has
 * one, so a UnitedHealthcare plan is priced at UnitedHealthcare's rates.
 *
 * Doctors bill separately from the hospital for some services (the ER
 * physician, the surgeon, the radiologist reading an MRI). Those parts are the
 * 2026 Medicare Physician Fee Schedule rate times 1.84, the commercial-to-
 * Medicare ratio for professional services in RAND's Round 5.1 study
 * (v2, December 2024, 2022 data).
 *
 * These are inputs to the engine, never outputs. Two drug rows are estimates
 * and say so; the pharmacy room prices real drugs live.
 */

import local from "../data/local-prices.json";
import { BENEFIT } from "./load-plans";
import type { LocalPriceFile } from "./local-prices";

type LocalFile = LocalPriceFile;
const FILE = local as unknown as LocalFile;
const MU = "MU Health Care negotiated rates";
const MU_URL = "https://www.muhealth.org/billing/pricing";
const PFS = "2026 Medicare Physician Fee Schedule x 1.84 (RAND Round 5.1 professional ratio)";
const PFS_URL = "https://www.rand.org/pubs/research_reports/RRA1144-2-v2.html";
const RAND_PRO = 1.84;

export type Component = {
  code: string;
  what: string;
  /** "hospital" parts come from MU Health Care's file; "doctor" parts from Medicare x RAND. */
  kind: "hospital" | "doctor" | "estimate";
  typical: number;
  low: number;
  high: number;
  qty?: number;
};

export type Price = {
  label: string;
  serviceType: string;
  typical: number;
  low: number;
  high: number;
  preventive?: boolean;
  source: string;
  sourceUrl?: string;
  components?: Component[];
  /** Set by applyPayer: whose contract these numbers are. */
  payer?: string | null;
};

// ---------------------------------------------------------------------------
// Reading the hospital file

/** Commercial contracts only: Medicare Advantage and Medicaid rates are set differently and would skew a private-insurance price. */
const isCommercial = (plan: string) => !/medicare|medicaid/i.test(plan);

function dollars(code: string): number[] {
  const e = FILE.codes?.[code];
  if (!e) return [];
  return e.payers
    .filter((p) => isCommercial(p.plan))
    .map((p) => p.amount)
    .filter((a): a is number => typeof a === "number" && a > 0)
    .sort((a, b) => a - b);
}

/** How each insurer appears in MU Health Care's file. Ambetter has no contract there. */
const PAYER_NAMES: [RegExp, RegExp][] = [
  [/united\s*health|uhc/i, /^united healthcare$/i],
  [/anthem|healthy alliance|blue cross/i, /^anthem$/i],
  [/medica/i, /^medica/i],
  [/aetna|coventry/i, /^aetna$|^coventry/i],
  [/cigna/i, /^cigna$/i],
  [/cox/i, /^cox/i],
];

/**
 * One insurer's own contracted rate for a code. Marketplace plans use the
 * contract labeled "Exchange" when the file has one; employer and parent
 * plans use the insurer's commercial PPO/HMO contracts.
 */
export function payerRate(code: string, issuer: string, marketplace: boolean): number | null {
  const e = FILE.codes?.[code];
  const hit = PAYER_NAMES.find(([issuerRe]) => issuerRe.test(issuer));
  if (!e || !hit) return null;
  const rows = e.payers.filter((p) => hit[1].test(p.payer) && isCommercial(p.plan) && typeof p.amount === "number" && p.amount > 0);
  if (!rows.length) return null;
  const exchange = rows.filter((p) => /exchange|marketplace|individual/i.test(p.plan));
  const pool = (marketplace && exchange.length ? exchange : rows.filter((p) => !/exchange/i.test(p.plan))).map((p) => p.amount as number);
  const use = pool.length ? pool : rows.map((p) => p.amount as number);
  return pct(use.sort((a, b) => a - b), 0.5);
}

/** True when the file shows no contract at all with this insurer (so MU Health Care is likely out of network). */
export function noContract(issuer: string | null): boolean {
  if (!issuer) return false;
  const any = Object.values(FILE.codes ?? {}).some((e) => e.payers.some((p) => PAYER_NAMES.some(([ir, pr]) => ir.test(issuer) && pr.test(p.payer))));
  return !any && Object.keys(FILE.codes ?? {}).length > 0;
}

function pct(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const i = (xs.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round((xs[lo] + (xs[hi] - xs[lo]) * (i - lo)) * 100) / 100;
}

/** A hospital component: median, 25th and 75th percentile across insurer contracts. */
function mu(code: string, what: string, fallback: number, qty = 1): Component {
  const xs = dollars(code);
  if (!xs.length) return { code, what, kind: "estimate", typical: fallback * qty, low: fallback * qty * 0.7, high: fallback * qty * 1.4, qty };
  return { code, what, kind: "hospital", typical: pct(xs, 0.5) * qty, low: pct(xs, 0.25) * qty, high: pct(xs, 0.75) * qty, qty };
}

/** A doctor component: 2026 Medicare rate x the RAND professional ratio. */
function doc(code: string, what: string, medicare: number): Component {
  const v = Math.round(medicare * RAND_PRO * 100) / 100;
  return { code, what, kind: "doctor", typical: v, low: Math.round(medicare * 1.4 * 100) / 100, high: Math.round(medicare * 2.6 * 100) / 100 };
}

function row(label: string, serviceType: string, parts: Component[], extra: Partial<Price> = {}): Price {
  const sum = (k: "typical" | "low" | "high") => Math.round(parts.reduce((a, p) => a + p[k], 0));
  const kinds = new Set(parts.map((p) => p.kind));
  const source = [kinds.has("hospital") ? MU : null, kinds.has("doctor") ? PFS : null, kinds.has("estimate") ? "estimate" : null].filter(Boolean).join(" + ");
  return { label, serviceType, typical: sum("typical"), low: sum("low"), high: sum("high"), source, sourceUrl: kinds.has("hospital") ? MU_URL : PFS_URL, components: parts, ...extra };
}

// ---------------------------------------------------------------------------
// The price list. Fallbacks apply only when data/local-prices.json is empty.

export const PRICES = {
  physical: row("Yearly physical", BENEFIT.PREVENTIVE, [mu("99395", "Preventive visit, age 18 to 39", 143)], { preventive: true }),
  sickVisit: row("Doctor visit, sick", BENEFIT.PRIMARY_CARE, [mu("99213", "Office visit, established patient", 110)]),
  specialist: row("Specialist visit", BENEFIT.SPECIALIST, [mu("99214", "Office visit, moderate complexity", 162)]),
  therapy: row("Therapy session", BENEFIT.MENTAL_HEALTH, [mu("90834", "Psychotherapy, 45 minutes", 180)]),
  telehealth: row("Video visit", BENEFIT.PRIMARY_CARE, [doc("99213", "Video visit, billed as an office visit (facility rate)", 57.45)]),
  urgentCare: row("Urgent care visit", BENEFIT.URGENT_CARE, [mu("99214", "Urgent care visit, billed as an office visit", 162)]),
  er: row("Emergency room visit", BENEFIT.EMERGENCY_ROOM, [mu("99284", "ER facility fee, level 4", 1260), doc("99284", "ER physician, level 4", 118.24)]),
  ambulance: row("Ground ambulance ride", BENEFIT.AMBULANCE, [mu("A0427", "Advanced life support, emergency transport", 1712)]),
  xray: row("X-ray", BENEFIT.XRAY, [mu("73560", "Knee X-ray, 1 or 2 views", 243)]),
  mri: row("MRI", BENEFIT.IMAGING, [mu("72148", "MRI lumbar spine, no contrast", 1082), doc("72148-26", "Radiologist reading", 57.49)]),
  ctScan: row("CT scan", BENEFIT.IMAGING, [mu("70450", "CT head, no contrast", 713)]),
  labs: row("Blood work", BENEFIT.LAB, [
    mu("80053", "Comprehensive metabolic panel", 93),
    mu("80061", "Lipid panel", 59),
    mu("85025", "Complete blood count", 24),
    mu("36415", "Blood draw", 22),
  ]),
  genericFill: row("Generic prescription, 30 days", BENEFIT.GENERIC_DRUGS, [
    { code: "NADAC", what: "Common generic: pharmacy cost plus a typical dispensing fee", kind: "estimate", typical: 15, low: 8, high: 30 },
  ]),
  brandFill: row("Brand inhaler, 30 days", BENEFIT.BRAND_DRUGS, [
    { code: "WAC", what: "Brand controller inhaler, list price range", kind: "estimate", typical: 350, low: 250, high: 450 },
  ]),
  kneeSurgery: row("Knee surgery, outpatient", BENEFIT.OUTPATIENT_SURGERY, [mu("29888", "ACL reconstruction, hospital outpatient", 6924), doc("29888", "Surgeon", 889.47)]),
  appendectomy: row("Appendix removal, laparoscopic", BENEFIT.INPATIENT, [mu("44970", "Laparoscopic appendectomy, hospital", 5655), doc("44970", "Surgeon", 578.17)]),
  traumaStay: row("Hospital stay after a crash", BENEFIT.INPATIENT, [mu("MS-DRG:964", "Multiple significant trauma with complications, inpatient stay", 14921)]),
} satisfies Record<string, Price>;

export type PriceKey = keyof typeof PRICES;

/** One-line method statement for the interface. */
export const PRICE_METHOD =
  "Hospital prices are MU Health Care's negotiated rates from its public price file; doctors' fees are 2026 Medicare rates times the commercial markup RAND measured.";

export const PRICE_FILE_META = {
  hospital: (FILE as { hospital?: string }).hospital ?? null,
  lastUpdatedOn: (FILE as { lastUpdatedOn?: string }).lastUpdatedOn ?? null,
  url: (FILE as { url?: string }).url ?? null,
};

// Frozen copy of the all-insurer medians, so applyPayer can always go back.
const BASE: Record<string, { typical: number; low: number; high: number; source: string; components?: Component[] }> = Object.fromEntries(
  Object.entries(PRICES).map(([k, p]) => [k, { typical: p.typical, low: p.low, high: p.high, source: p.source, components: (p as Price).components?.map((c) => ({ ...c })) }])
);

let currentPayer: string | null = null;

/**
 * Price everything at one insurer's own contracted rates where MU Health
 * Care's file has them, and the all-insurer median elsewhere. Pass null to go
 * back to the medians. Returns how many hospital components used the
 * insurer's own rate.
 */
export function applyPayer(payer: string | null, marketplace = false): number {
  const key = payer ? `${payer}|${marketplace}` : null;
  if (key === currentPayer) return countPayer();
  currentPayer = key;
  for (const [k, p] of Object.entries(PRICES) as [PriceKey, Price][]) {
    const base = BASE[k];
    const parts = (base.components ?? []).map((c) => {
      if (!payer || c.kind !== "hospital") return { ...c };
      const r = payerRate(c.code, payer, marketplace);
      if (r !== null) return { ...c, typical: Math.round(r * (c.qty ?? 1) * 100) / 100, payerRate: true } as Component;
      return { ...c };
    });
    p.components = parts;
    p.typical = Math.round(parts.reduce((a, c) => a + c.typical, 0));
    const own = parts.some((c) => (c as Component & { payerRate?: boolean }).payerRate);
    p.payer = own ? payer : null;
    p.source = own ? `${payer}'s negotiated rates at MU Health Care` + (parts.some((c) => c.kind === "doctor") ? ` + ${PFS}` : "") : base.source;
  }
  return countPayer();
}

function countPayer(): number {
  return Object.values(PRICES).reduce((n, p) => n + ((p as Price).components ?? []).filter((c) => (c as Component & { payerRate?: boolean }).payerRate).length, 0);
}

/**
 * The out-of-network ambulance balance bill: the part above the allowed amount
 * that the ambulance company can bill you directly.
 *
 * Source: Commonwealth Fund, Feb 18 2026, "Consumers Still Face Surprise Bills
 * for Ground Ambulances": average surprise charge of $1,093 in 2021 data.
 * It is a national average from older data, so the interface labels it that way.
 */
export const AMBULANCE_BALANCE_BILL = {
  amount: 1093,
  source: "Commonwealth Fund (2026), average ground ambulance surprise charge, 2021 data",
};
