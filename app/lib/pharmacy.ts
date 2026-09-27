/**
 * The cheapest honest way to fill a prescription.
 *
 * Sources, all free and public:
 *  - RxNav (U.S. National Library of Medicine) turns what the visitor typed
 *    into an RxNorm concept and its NDC package codes.
 *  - Cost Plus Drugs public API gives a real cash price for an NDC.
 *  - NADAC (CMS, data.medicaid.gov) is what pharmacies pay wholesale, used as
 *    a benchmark and to estimate what a plan would be billed.
 *  - lib/kb/rx-programs.ts holds cited cash and maker programs.
 *
 * Privacy: queries are never stored or logged. Only the drug name, NDC and
 * quantity leave this server, and they go from the server, not the visitor's
 * browser, so no third party sees who asked. Caches are keyed by the public
 * API URL, which holds nothing about the visitor.
 *
 * Every network step degrades: if RxNav, Cost Plus or NADAC fail or the daily
 * budget is spent, the result falls back to the static programs.
 *
 * Server only.
 */

import { cached, envLimit, fetchWithTimeout, spend } from "./server-cache";
import { DEDUCTIBLE_NOTE, DISPENSING_FEE, RX_PROGRAMS, type DeductibleCredit, type RxProgram } from "./kb/rx-programs";

export const RXNAV = "https://rxnav.nlm.nih.gov/REST";
export const COST_PLUS = "https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main";
/** NADAC dataset id on data.medicaid.gov. Changes every year: update here only. */
export const NADAC_DATASET = "fbb83258-11c7-47f5-8b18-5f8e79f7e704";
export const NADAC_URL = `https://data.medicaid.gov/api/1/datastore/query/${NADAC_DATASET}/0`;

export const ATTRIBUTION = [
  "This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.",
  "Prices from Cost Plus Drugs public API",
  "NADAC from CMS data.medicaid.gov",
];

const HOUR = 3_600_000;
const TTL = { rxnav: 24 * HOUR, costPlus: 12 * HOUR, nadac: 24 * HOUR };
const BUDGET = "rx-apis";
const MAX_COST_PLUS_CALLS = 8;
const MAX_NADAC_CALLS = 3;
const NADAC_BATCH = 40;
/** Cost Plus charges a flat pharmacy fee per order plus shipping. */
export const COST_PLUS_SHIPPING_ESTIMATE = 5;

// ---------------------------------------------------------------------------
// Types

export type DrugTty = "SCD" | "SBD" | string;

export type ResolvedDrug = {
  rxcui: string;
  /** RxNorm name, e.g. "atorvastatin 20 MG Oral Tablet". */
  name: string;
  /** Lowercase active ingredient, e.g. "atorvastatin". */
  ingredient: string;
  /** Brand in brackets for SBD concepts, e.g. "Eliquis". */
  brand: string | null;
  strength: string;
  form: string;
  tty: DrugTty;
  generic: boolean;
  ndcs: string[];
  /** Other strengths and forms of the same drug the visitor could pick. */
  alternatives: { rxcui: string; name: string; strength: string; form: string; tty: DrugTty }[];
};

export type CostPlusQuote = {
  ndc: string;
  name: string;
  brandName: string | null;
  strength: string;
  form: string;
  generic: boolean;
  qty: number;
  unitPrice: number;
  unitBillingPrice: number;
  /** Cost Plus's quote for the quantity, drug plus their $5 pharmacy fee. */
  quote: number;
  insuranceEligible: boolean;
  url: string;
  /** "ndc" when the NDC is one RxNav lists for this exact drug, else "strength". */
  matchedBy: "ndc" | "strength";
};

export type NadacPrice = {
  ndc: string;
  description: string;
  perUnit: number;
  unit: string;
  total: number;
  qty: number;
  effectiveDate: string;
  asOf: string;
};

export type FillOptionKind = "cost-plus" | "nadac-benchmark" | "program" | "manufacturer" | "insurance";

export type FillOption = {
  id: string;
  kind: FillOptionKind;
  title: string;
  /** What the visitor pays for the whole fill, or null when there is no single price. */
  price: number | null;
  priceNote: string;
  eligibility: string;
  countsTowardDeductible: DeductibleCredit;
  privacy: string;
  url: string | null;
  source: string;
  asOf: string | null;
  /** Approximate extra cost not in `price` (shipping). */
  extraEstimate?: number;
  /** Insurance row only: estimated allowed amount to run through the plan engine. */
  allowedAmountEstimate?: number;
  /** Row comes from a secondhand report, not the seller's own page. */
  reported?: boolean;
  /** Row's source page was fetched and checked. */
  verified?: boolean;
};

export type FillResult = {
  drug: ResolvedDrug | null;
  benchmark: NadacPrice | null;
  options: FillOption[];
  /** Plain notes about what could not be looked up. */
  notes: string[];
};

class RxSourceError extends Error {}

// ---------------------------------------------------------------------------
// Fetch plumbing

/** Tests set RX_NO_CACHE=1 so fixtures are read fresh every run. */
function memo<T>(ns: string, key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
  if (process.env.RX_NO_CACHE === "1") return compute();
  return cached(ns, key, ttl, compute);
}

async function getJson<T>(url: string): Promise<T> {
  if (!(await spend(BUDGET, envLimit("RX_DAILY_LIMIT", 3000)))) throw new RxSourceError("daily budget spent");
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { accept: "application/json" } }, 10_000);
  } catch (e) {
    throw new RxSourceError(`network: ${(e as Error).message}`);
  }
  if (!res.ok) throw new RxSourceError(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** "$0.0119" or "0.0119" to 0.0119; NaN when unreadable. */
export function money(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  return Number(v.replace(/[$,\s]/g, ""));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// RxNav

type RxConcept = { rxcui: string; name: string; synonym?: string; tty: string };
type DrugsResponse = { drugGroup?: { conceptGroup?: { tty: string; conceptProperties?: RxConcept[] }[] } };
type NdcsResponse = { ndcGroup?: { ndcList?: { ndc?: string[] } | null } };
type ApproxResponse = { approximateGroup?: { candidate?: { rxcui?: string; name?: string; score?: string; rank?: string }[] } };
type PropsResponse = { properties?: { rxcui: string; name: string; tty: string } };

const UNIT = "(?:MG|MCG|G|ML|UNT|MEQ|%|MG/ML|MCG/ML|MG/HR|MCG/HR|MG/ACTUAT|MCG/ACTUAT|UNT/ML)";
const NAME_RE = new RegExp(`^(.+?) (\\d[\\d.,]*\\s?${UNIT})(?:\\s|$)(.*)$`, "i");

/** Split an RxNorm clinical name into ingredient, strength, form and brand. */
export function parseRxName(name: string): { ingredient: string; strength: string; form: string; brand: string | null } {
  const brandMatch = name.match(/\s*\[([^\]]+)\]\s*$/);
  const brand = brandMatch ? brandMatch[1] : null;
  const bare = brandMatch ? name.slice(0, brandMatch.index).trim() : name.trim();
  const m = bare.match(NAME_RE);
  if (!m) return { ingredient: bare.toLowerCase(), strength: "", form: "", brand };
  return { ingredient: m[1].toLowerCase(), strength: m[2].toUpperCase().replace(/\s+/g, " "), form: m[3].trim(), brand };
}

/** Pull a strength like "20mg" or "2.5 mg" out of the visitor's text. */
export function parseQuery(q: string): { name: string; strength: number | null; unit: string | null } {
  const text = q.trim().replace(/\s+/g, " ");
  const m = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|%|units?)\b/i);
  if (!m) return { name: text, strength: null, unit: null };
  const name = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();
  return { name, strength: Number(m[1]), unit: m[2].toUpperCase().replace(/^UNITS?$/, "UNT") };
}

function strengthNumber(strength: string): number | null {
  const m = strength.match(/^(\d[\d.,]*)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

const isCombo = (name: string) => / \/ /.test(name) || /^\{/.test(name);

const FORM_RANK = ["Oral Tablet", "Oral Capsule", "Delayed Release Oral Tablet", "Extended Release Oral Tablet", "Extended Release Oral Capsule"];
const formRank = (form: string) => {
  const i = FORM_RANK.indexOf(form);
  return i === -1 ? FORM_RANK.length : i;
};

async function rxnavDrugs(name: string): Promise<RxConcept[]> {
  const url = `${RXNAV}/drugs.json?name=${encodeURIComponent(name)}`;
  const data = await memo<DrugsResponse>("rxnav", url, TTL.rxnav, () => getJson<DrugsResponse>(url));
  return (data.drugGroup?.conceptGroup ?? []).flatMap((g) => g.conceptProperties ?? []);
}

async function rxnavApproximate(term: string): Promise<string | null> {
  const url = `${RXNAV}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=5`;
  const data = await memo<ApproxResponse>("rxnav", url, TTL.rxnav, () => getJson<ApproxResponse>(url));
  const hit = (data.approximateGroup?.candidate ?? []).find((c) => c.rxcui);
  return hit?.rxcui ?? null;
}

async function rxnavProperties(rxcui: string): Promise<PropsResponse["properties"] | null> {
  const url = `${RXNAV}/rxcui/${encodeURIComponent(rxcui)}/properties.json`;
  const data = await memo<PropsResponse>("rxnav", url, TTL.rxnav, () => getJson<PropsResponse>(url));
  return data.properties ?? null;
}

/** 11-digit NDCs RxNav lists for one concept. */
export async function rxnavNdcs(rxcui: string): Promise<string[]> {
  const url = `${RXNAV}/rxcui/${encodeURIComponent(rxcui)}/ndcs.json`;
  const data = await memo<NdcsResponse>("rxnav", url, TTL.rxnav, () => getJson<NdcsResponse>(url));
  return (data.ndcGroup?.ndcList?.ndc ?? []).filter((n) => /^\d{11}$/.test(n));
}

/**
 * Pick the concept that best fits what the visitor typed: exact strength if
 * given, a brand if they typed one, single-ingredient tablets before other forms.
 */
export function pickConcept(concepts: RxConcept[], query: string): RxConcept | null {
  const q = parseQuery(query);
  const typed = q.name.toLowerCase();
  const wantsCombo = /\/| and /.test(typed);
  const pool = concepts.filter((c) => (c.tty === "SCD" || c.tty === "SBD") && (wantsCombo || !isCombo(c.name)));
  if (!pool.length) return null;

  const scored = pool.map((c) => {
    const p = parseRxName(c.name);
    const typedBrand = !!p.brand && typed.includes(p.brand.toLowerCase());
    const typedIngredient = typed.includes(p.ingredient);
    let score = 0;
    const n = strengthNumber(p.strength);
    if (q.strength != null) score += n === q.strength ? 100 : -100;
    if (q.unit && p.strength && !p.strength.startsWith(`${n} ${q.unit}`)) score -= 5;
    if (typedBrand) score += 40;
    else if (p.brand) score -= typedIngredient ? 30 : 0; // generic wanted: prefer SCD
    score -= formRank(p.form) * 3;
    return { c, score, n: n ?? Infinity };
  });
  scored.sort((a, b) => b.score - a.score || a.n - b.n);
  return scored[0].c;
}

/** Turn free text ("sertraline 50mg", "Eliquis 5 mg") into an RxNorm drug with NDCs. */
export async function resolveDrug(query: string): Promise<ResolvedDrug | null> {
  const q = parseQuery(query);
  if (!q.name) return null;
  let concepts = await rxnavDrugs(q.name);

  if (!concepts.length) {
    // Misspellings and partial names: ask approximateTerm, then look up what it found.
    const rxcui = await rxnavApproximate(query);
    if (!rxcui) return null;
    const props = await rxnavProperties(rxcui);
    if (!props) return null;
    if (props.tty === "SCD" || props.tty === "SBD") concepts = [props];
    else {
      concepts = await rxnavDrugs(props.name);
      if (!concepts.length) return null;
    }
  }

  const chosen = pickConcept(concepts, query);
  if (!chosen) return null;
  const parsed = parseRxName(chosen.name);
  const ndcs = await rxnavNdcs(chosen.rxcui);

  const alternatives = concepts
    .filter((c) => (c.tty === "SCD" || c.tty === "SBD") && !isCombo(c.name) && c.rxcui !== chosen.rxcui)
    .map((c) => ({ rxcui: c.rxcui, name: c.name, tty: c.tty, ...parseRxName(c.name) }))
    .filter((c) => c.ingredient === parsed.ingredient)
    .sort((a, b) => formRank(a.form) - formRank(b.form) || (strengthNumber(a.strength) ?? 0) - (strengthNumber(b.strength) ?? 0))
    .map(({ rxcui, name, strength, form, tty }) => ({ rxcui, name, strength, form, tty }));

  return {
    rxcui: chosen.rxcui,
    name: chosen.name,
    ingredient: parsed.ingredient,
    brand: parsed.brand,
    strength: parsed.strength,
    form: parsed.form,
    tty: chosen.tty,
    generic: chosen.tty === "SCD",
    ndcs,
    alternatives,
  };
}

// ---------------------------------------------------------------------------
// Cost Plus Drugs

type CostPlusRow = {
  brand_generic?: string;
  brand_name?: string;
  form?: string;
  insurance_eligible?: string;
  medication_name?: string;
  ndc?: string;
  requested_quote?: string;
  requested_quote_units?: string;
  strength?: string;
  unit_billing_price?: string;
  unit_price?: string;
  url?: string;
};
type CostPlusResponse = { results?: CostPlusRow[] };

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** "20mg", "20 MG", "20 mg" all become "20mg". */
const normStrength = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const formWord = (form: string) => (form.match(/tablet|capsule|solution|suspension|inhaler|injection|pen|cream|patch/i)?.[0] ?? "").toLowerCase();

async function costPlusQuery(params: Record<string, string>): Promise<CostPlusRow[]> {
  const url = `${COST_PLUS}?${new URLSearchParams(params).toString()}`;
  const data = await memo<CostPlusResponse>("costplus", url, TTL.costPlus, () => getJson<CostPlusResponse>(url));
  return data.results ?? [];
}

function toQuote(row: CostPlusRow, qty: number, matchedBy: CostPlusQuote["matchedBy"]): CostPlusQuote | null {
  const unitBilling = money(row.unit_billing_price);
  const quoted = Number(row.requested_quote_units) === qty ? money(row.requested_quote) : NaN;
  // The quote is qty x unit billing price plus the $5 pharmacy fee.
  const quote = Number.isFinite(quoted) ? quoted : Number.isFinite(unitBilling) ? round2(qty * unitBilling + 5) : NaN;
  if (!row.ndc || !Number.isFinite(quote)) return null;
  return {
    ndc: row.ndc,
    name: [row.medication_name, row.strength, row.form].filter(Boolean).join(" "),
    brandName: row.brand_name || null,
    strength: row.strength ?? "",
    form: row.form ?? "",
    generic: (row.brand_generic ?? "").toLowerCase() === "generic",
    qty,
    unitPrice: money(row.unit_price),
    unitBillingPrice: unitBilling,
    quote,
    insuranceEligible: (row.insurance_eligible ?? "").toLowerCase() === "yes",
    url: row.url ?? "https://www.costplusdrugs.com/",
    matchedBy,
  };
}

/**
 * Cash price at Cost Plus Drugs. Accepts the drug (preferred) or a bare NDC
 * list. Tries, within MAX_COST_PLUS_CALLS requests:
 *  1. medication_name (the ingredient), keeping a row whose NDC RxNav lists
 *     for this exact drug, or failing that the same strength and form;
 *  2. brand_name with generic_equivalent_ok, same matching;
 *  3. individual NDCs.
 * Returns null when nothing matches.
 */
export async function costPlusQuote(
  target: ResolvedDrug | { ndcs: string[]; brand?: string | null; ingredient?: string; strength?: string; form?: string; generic?: boolean },
  qty: number,
): Promise<CostPlusQuote | null> {
  const ndcSet = new Set(target.ndcs);
  const strength = target.strength ? normStrength(target.strength) : "";
  const form = target.form ? formWord(target.form) : "";
  const q = String(qty);
  let calls = 0;

  const pick = (rows: CostPlusRow[]): CostPlusQuote | null => {
    const exact = rows.find((r) => r.ndc && ndcSet.has(r.ndc));
    if (exact) return toQuote(exact, qty, "ndc");
    if (!strength) return null;
    const wantGeneric = target.generic;
    const near = rows.find(
      (r) =>
        normStrength(r.strength ?? "") === strength &&
        (!form || formWord(r.form ?? "") === form) &&
        (wantGeneric == null || ((r.brand_generic ?? "").toLowerCase() === "generic") === wantGeneric),
    );
    return near ? toQuote(near, qty, "strength") : null;
  };

  if (target.ingredient) {
    calls++;
    const hit = pick(await costPlusQuery({ medication_name: titleCase(target.ingredient), quantity_units: q }));
    if (hit) return hit;
  }
  if (target.brand) {
    calls++;
    const hit = pick(await costPlusQuery({ brand_name: target.brand, generic_equivalent_ok: "true", quantity_units: q }));
    if (hit) return hit;
  }
  for (const ndc of target.ndcs) {
    if (calls >= MAX_COST_PLUS_CALLS) break;
    calls++;
    const rows = await costPlusQuery({ ndc, quantity_units: q });
    const row = rows.find((r) => r.ndc === ndc) ?? (rows.length === 1 ? rows[0] : undefined);
    if (row) return toQuote(row, qty, "ndc");
  }
  return null;
}

// ---------------------------------------------------------------------------
// NADAC

type NadacRow = {
  ndc_description?: string;
  ndc?: string;
  nadac_per_unit?: string;
  pricing_unit?: string;
  effective_date?: string;
  as_of_date?: string;
};
type NadacResponse = { results?: NadacRow[] };

function nadacUrl(ndcs: string[]): string {
  const p = new URLSearchParams();
  if (ndcs.length === 1) {
    p.set("conditions[0][property]", "ndc");
    p.set("conditions[0][value]", ndcs[0]);
    p.set("conditions[0][operator]", "=");
  } else {
    p.set("conditions[0][property]", "ndc");
    p.set("conditions[0][operator]", "in");
    ndcs.forEach((n, i) => p.set(`conditions[0][value][${i}]`, n));
  }
  p.set("sort[0][property]", "as_of_date");
  p.set("sort[0][order]", "desc");
  p.set("limit", ndcs.length === 1 ? "1" : "50");
  return `${NADAC_URL}?${p.toString()}`;
}

async function nadacQuery(ndcs: string[]): Promise<NadacRow[]> {
  const url = nadacUrl(ndcs);
  const data = await memo<NadacResponse>("nadac", url, TTL.nadac, () => getJson<NadacResponse>(url));
  return data.results ?? [];
}

function toNadac(row: NadacRow, qty: number): NadacPrice | null {
  const perUnit = money(row.nadac_per_unit);
  if (!row.ndc || !Number.isFinite(perUnit)) return null;
  return {
    ndc: row.ndc,
    description: row.ndc_description ?? "",
    perUnit,
    unit: row.pricing_unit ?? "EA",
    total: round2(perUnit * qty),
    qty,
    effectiveDate: (row.effective_date ?? "").slice(0, 10),
    asOf: (row.as_of_date ?? "").slice(0, 10),
  };
}

/**
 * NADAC per unit for the drug. `preferred` NDCs (for example the one Cost
 * Plus sells) are tried first one by one, then the rest in batches. Among the
 * latest weekly snapshot, the median per-unit price across matching NDCs is
 * used so one odd repackager does not set the benchmark.
 */
export async function nadacPrice(ndcs: string[], qty: number, preferred: string[] = []): Promise<NadacPrice | null> {
  let calls = 0;
  for (const ndc of preferred) {
    if (calls >= MAX_NADAC_CALLS) break;
    calls++;
    const row = (await nadacQuery([ndc]))[0];
    const hit = row && toNadac(row, qty);
    if (hit) return hit;
  }
  const rest = ndcs.filter((n) => !preferred.includes(n));
  for (let i = 0; i < rest.length && calls < MAX_NADAC_CALLS; i += NADAC_BATCH) {
    calls++;
    const rows = await nadacQuery(rest.slice(i, i + NADAC_BATCH));
    if (!rows.length) continue;
    const latest = rows.reduce((m, r) => ((r.as_of_date ?? "") > m ? (r.as_of_date ?? "") : m), "");
    const seen = new Set<string>();
    const current = rows
      .filter((r) => (r.as_of_date ?? "") === latest && r.ndc && !seen.has(r.ndc) && seen.add(r.ndc))
      .map((r) => toNadac(r, qty))
      .filter((r): r is NadacPrice => !!r)
      .sort((a, b) => a.perUnit - b.perUnit);
    if (current.length) return current[Math.floor((current.length - 1) / 2)];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Programs

const INHALED = /inhal|aerosol|powder for inhalation|metered/i;

/** Static programs that could apply to this drug. With no drug, the general finders only. */
export function programsFor(drug: Pick<ResolvedDrug, "ingredient" | "brand" | "generic" | "form"> | null): RxProgram[] {
  return RX_PROGRAMS.filter((p) => {
    const m = p.match;
    const general = !m.generics && !m.ingredients && !m.brands;
    if (general) return true;
    if (!drug) return false;
    if (m.inhaledOnly && !INHALED.test(drug.form)) return false;
    if (m.generics && drug.generic) return true;
    const ingredient = drug.ingredient.toLowerCase();
    const brand = drug.brand?.toLowerCase() ?? "";
    // When a program lists brands and the drug is a brand, the brand must match
    // (Ozempic and Wegovy share an ingredient but not a price).
    if (m.brands && brand) return m.brands.includes(brand);
    return !!m.ingredients?.some((i) => ingredient.split(/[ /,]+/).includes(i));
  });
}

function programPrice(p: RxProgram, daysSupply: number): number | null {
  if (p.price30 == null) return null;
  if (daysSupply <= 30) return p.price30;
  if (p.price90 != null && daysSupply <= 90) return p.price90;
  return round2(p.price30 * Math.ceil(daysSupply / 30));
}

// ---------------------------------------------------------------------------
// The ranked list

export type FillInput = { query: string; qty: number; daysSupply: number };

async function safely<T>(label: string, notes: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    notes.push(`${label} unavailable right now${e instanceof RxSourceError && e.message.includes("budget") ? " (daily lookup limit reached)" : ""}.`);
    return null;
  }
}

const RANK: Record<FillOptionKind, number> = { "cost-plus": 0, program: 0, manufacturer: 0, insurance: 1, "nadac-benchmark": 2 };

/** Rank: priced options cheapest first (with shipping), then the insurance row, then unpriced, then the benchmark. */
export function rankOptions(options: FillOption[]): FillOption[] {
  const effective = (o: FillOption) => (o.price == null ? Infinity : o.price + (o.extraEstimate ?? 0));
  return [...options].sort((a, b) => {
    const ga = a.kind === "nadac-benchmark" ? 3 : a.price != null ? 0 : a.kind === "insurance" ? 1 : 2;
    const gb = b.kind === "nadac-benchmark" ? 3 : b.price != null ? 0 : b.kind === "insurance" ? 1 : 2;
    return ga - gb || effective(a) - effective(b) || RANK[a.kind] - RANK[b.kind];
  });
}

export async function fillOptions({ query, qty, daysSupply }: FillInput): Promise<FillResult> {
  const notes: string[] = [];
  const drug = await safely("Drug lookup (RxNav)", notes, () => resolveDrug(query));
  if (!drug && !notes.length) notes.push("No matching drug found in RxNorm. Try the generic name and strength, like \"sertraline 50 mg\".");

  const quote = drug ? await safely("Cost Plus Drugs price", notes, () => costPlusQuote(drug, qty)) : null;
  const benchmark = drug?.ndcs.length
    ? await safely("NADAC benchmark", notes, () => nadacPrice(drug.ndcs, qty, quote ? [quote.ndc] : []))
    : null;

  const options: FillOption[] = [];

  if (quote) {
    options.push({
      id: "cost-plus",
      kind: "cost-plus",
      title: `Mark Cuban Cost Plus Drugs, ${quote.qty} x ${quote.name}`,
      price: quote.quote,
      extraEstimate: COST_PLUS_SHIPPING_ESTIMATE,
      priceNote: `${quote.qty} units at $${quote.unitBillingPrice.toFixed(4)} each plus Cost Plus's $5 pharmacy fee. Shipping is extra, about $${COST_PLUS_SHIPPING_ESTIMATE} (approximate). Mail order, so allow several days.${quote.matchedBy === "strength" ? " Matched by strength and form, not the exact package." : ""}`,
      eligibility: quote.insuranceEligible
        ? "Anyone with a prescription. Cost Plus also accepts some insurance plans for this drug; paying cash is always allowed."
        : "Anyone with a prescription. Cash only for this drug.",
      countsTowardDeductible: quote.insuranceEligible ? "ask-plan" : "usually-no",
      privacy: "Ordering needs a Cost Plus account. This app sent only the drug and quantity to Cost Plus, from our server, nothing about you.",
      url: quote.url,
      source: "Cost Plus Drugs public API",
      asOf: new Date().toISOString().slice(0, 10),
    });
  }

  if (benchmark) {
    options.push({
      id: "nadac",
      kind: "nadac-benchmark",
      title: "What pharmacies pay (NADAC benchmark)",
      price: benchmark.total,
      priceNote: `National average acquisition cost: $${benchmark.perUnit.toFixed(4)} per ${benchmark.unit} x ${benchmark.qty}. Not a price you can buy at: a cash quote far above this is a markup.`,
      eligibility: "Benchmark only.",
      countsTowardDeductible: "no",
      privacy: "Public CMS data; nothing about you is sent.",
      url: "https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704",
      source: "NADAC, CMS data.medicaid.gov",
      asOf: benchmark.asOf || null,
    });
    const allowed = round2(benchmark.total * 1.0 + DISPENSING_FEE.amount);
    options.push({
      id: "insurance",
      kind: "insurance",
      title: "Through your insurance",
      price: null,
      allowedAmountEstimate: allowed,
      priceNote: `Your cost depends on your plan's drug tier, deductible and copay. Estimated amount billed to the plan: $${allowed.toFixed(2)} (NADAC $${benchmark.total.toFixed(2)} plus a typical $${DISPENSING_FEE.amount.toFixed(2)} dispensing fee). ${DISPENSING_FEE.note}`,
      eligibility: "If your plan covers this drug. Some plans require prior authorization.",
      countsTowardDeductible: "yes",
      privacy: "Your pharmacy and plan see the claim, as with any insured fill.",
      url: DISPENSING_FEE.source.url,
      source: `NADAC plus dispensing fee estimate (${DISPENSING_FEE.source.name})`,
      asOf: benchmark.asOf || null,
    });
  }

  for (const p of programsFor(drug)) {
    options.push({
      id: p.id,
      kind: p.kind,
      title: p.title,
      price: programPrice(p, daysSupply),
      priceNote: p.priceNote,
      eligibility: p.eligibility,
      countsTowardDeductible: p.countsTowardDeductible,
      privacy: p.privacy,
      url: p.source.url,
      source: p.source.name,
      asOf: p.source.asOf ?? null,
      reported: p.reported,
      verified: p.verified,
    });
  }

  if (options.some((o) => o.countsTowardDeductible !== "yes" && o.kind !== "nadac-benchmark")) notes.push(DEDUCTIBLE_NOTE);

  return { drug, benchmark, options: rankOptions(options), notes };
}

// ---------------------------------------------------------------------------
// Autocomplete (Clinical Tables RxTerms, NLM)

export const RXTERMS_URL = "https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search";

export type Suggestion = { name: string; strengths: string[]; rxcuis: string[] };

/** RxTerms returns [total, names, {STRENGTHS_AND_FORMS, RXCUIS}, display]. */
type RxTermsResponse = [number, string[], { STRENGTHS_AND_FORMS?: string[][]; RXCUIS?: string[][] } | null, unknown];

export async function suggestDrugs(text: string, max = 8): Promise<Suggestion[]> {
  const term = text.trim().slice(0, 60);
  if (term.length < 2) return [];
  const url = `${RXTERMS_URL}?terms=${encodeURIComponent(term)}&ef=STRENGTHS_AND_FORMS,RXCUIS&maxList=${max}`;
  const data = await memo<RxTermsResponse>("rxterms", url, TTL.rxnav, () => getJson<RxTermsResponse>(url));
  const names = data?.[1] ?? [];
  const extra = data?.[2] ?? {};
  return names.map((name, i) => ({
    name,
    strengths: (extra.STRENGTHS_AND_FORMS?.[i] ?? []).map((s) => s.trim()),
    rxcuis: extra.RXCUIS?.[i] ?? [],
  }));
}
