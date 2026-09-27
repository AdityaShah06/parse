/**
 * CMS Marketplace API client (HealthCare.gov's own plan, provider and drug
 * data) plus the mapping from its plan shape onto the engine's Plan.
 *
 * Spec: https://developer.cms.gov/marketplace-api/api-spec (Swagger 2.0).
 * Base https://marketplace.api.healthcare.gov/api/v1, key as ?apikey=.
 *
 * Server only. The key lives in CMS_MARKETPLACE_KEY and never leaves this
 * file: it is not part of any cache key, log line or error message. Keys
 * rotate every 60 days, so a 401/403 here usually means "rotate the key".
 *
 * Every request goes through cached() and a daily budget
 * (CMS_DAILY_LIMIT, default 2000 calls). Cache hits spend nothing.
 *
 * This file never computes a dollar figure a person will see. It only
 * reshapes CMS data into a Plan; lib/engine.ts does the math and
 * lib/parse-cost-share.ts owns the cost-sharing grammar.
 */

import type { Plan } from "./engine";
import { pickCostShare, type CostShare } from "./parse-cost-share";
import { BENEFIT } from "./load-plans";
import { cached, envLimit, fetchWithTimeout, spend } from "./server-cache";

export const MARKETPLACE_BASE = "https://marketplace.api.healthcare.gov/api/v1";
export const MARKETPLACE_YEAR = 2026;
export const MARKETPLACE_SOURCE = "CMS Marketplace API";

const HOUR = 60 * 60 * 1000;
const TTL = {
  plans: 12 * HOUR,
  geo: 7 * 24 * HOUR,
  coverage: 24 * HOUR,
  autocomplete: 7 * 24 * HOUR,
} as const;

const BUDGET = "cms-marketplace";

// ---------------------------------------------------------------------------
// Errors

export type MarketplaceErrorCode = "no_key" | "budget" | "http" | "network" | "bad_request" | "bad_response";

export class MarketplaceError extends Error {
  readonly code: MarketplaceErrorCode;
  readonly status?: number;
  constructor(code: MarketplaceErrorCode, message: string, status?: number) {
    super(message);
    this.name = "MarketplaceError";
    this.code = code;
    this.status = status;
  }
}

export class NoMarketplaceKey extends MarketplaceError {
  constructor() {
    super("no_key", "CMS_MARKETPLACE_KEY is not set");
    this.name = "NoMarketplaceKey";
  }
}

export class MarketplaceBudgetExceeded extends MarketplaceError {
  constructor() {
    super("budget", "Daily CMS Marketplace budget is used up");
    this.name = "MarketplaceBudgetExceeded";
  }
}

export class MarketplaceHttpError extends MarketplaceError {
  constructor(status: number, path: string, detail: string) {
    super("http", `CMS Marketplace ${path} answered ${status}${detail ? `: ${detail}` : ""}`, status);
    this.name = "MarketplaceHttpError";
  }
}

/** Map any error from this module to an HTTP status and JSON body for a route. */
export function toHttpError(err: unknown): { status: number; body: { ok: false; code: string; message: string; upstreamStatus?: number } } {
  if (err instanceof MarketplaceError) {
    switch (err.code) {
      case "no_key":
        return { status: 503, body: { ok: false, code: "no_key", message: "Marketplace lookups are not configured on this server." } };
      case "budget":
        return { status: 429, body: { ok: false, code: "budget", message: "Daily Marketplace lookup budget is used up. Try again tomorrow." } };
      case "bad_request":
        return { status: 400, body: { ok: false, code: "bad_request", message: err.message } };
      case "http": {
        const s = err.status ?? 502;
        const code = s === 401 || s === 403 ? "key_rejected" : s === 429 ? "rate_limited" : "upstream";
        return { status: s === 404 ? 404 : 502, body: { ok: false, code, message: err.message, upstreamStatus: s } };
      }
      default:
        return { status: 502, body: { ok: false, code: err.code, message: err.message } };
    }
  }
  return { status: 500, body: { ok: false, code: "internal", message: "Unexpected error" } };
}

// ---------------------------------------------------------------------------
// Transport

function apiKey(): string {
  const key = process.env.CMS_MARKETPLACE_KEY?.trim();
  if (!key) throw new NoMarketplaceKey();
  return key;
}

function scrub(text: string, key: string): string {
  return key ? text.split(key).join("[key]") : text;
}

type Query = Record<string, string | number | undefined>;

function queryString(q: Query): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(q).sort()) {
    const v = q[k];
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  opts: { query?: Query; body?: unknown; ttl: number; ns: string }
): Promise<T> {
  const key = apiKey();
  const qs = queryString(opts.query ?? {});
  // The cache key is the request minus the credential.
  const cacheKey = `${method} ${path}?${qs} ${opts.body === undefined ? "" : JSON.stringify(opts.body)}`;

  return cached<T>(opts.ns, cacheKey, opts.ttl, async () => {
    if (!(await spend(BUDGET, envLimit("CMS_DAILY_LIMIT", 2000)))) throw new MarketplaceBudgetExceeded();

    const url = `${MARKETPLACE_BASE}${path}?${qs ? `${qs}&` : ""}apikey=${encodeURIComponent(key)}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method,
        headers: { accept: "application/json", ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      const why = e instanceof Error ? e.name : "error";
      throw new MarketplaceError("network", `CMS Marketplace ${path} unreachable (${why})`);
    }

    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        try {
          const j = JSON.parse(text) as { message?: unknown; error?: unknown };
          detail = String(j.message ?? j.error ?? "");
        } catch {
          detail = text;
        }
      } catch {
        // no body
      }
      throw new MarketplaceHttpError(res.status, path, scrub(detail, key).replace(/\s+/g, " ").trim().slice(0, 200));
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new MarketplaceError("bad_response", `CMS Marketplace ${path} returned non-JSON`);
    }
  });
}

/**
 * Coverage endpoints document their array under the key
 * "Provider & Drug Coverage"; the live service has been seen answering
 * "coverage". Accept either, a bare array, or any single array-valued key.
 */
export function pickArray<T>(json: unknown, keys: string[]): T[] {
  if (Array.isArray(json)) return json as T[];
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as T[];
  const arrays = Object.values(o).filter(Array.isArray);
  return arrays.length === 1 ? (arrays[0] as T[]) : [];
}

// ---------------------------------------------------------------------------
// API shapes (Swagger definitions, trimmed to what we read)

export type NetworkTier = "In-Network" | "In-Network Tier 2" | "Out-of-Network" | "Combined In-Out of Network" | (string & {});
export type Coverage = "Covered" | "NotCovered" | "GenericCovered" | "DataNotProvided";
export type Accepting = "accepting" | "not accepting" | "accepting in some locations" | "unknown";

export type ApiCostSharing = {
  coinsurance_options?: string | null;
  coinsurance_rate?: number | null;
  copay_amount?: number | null;
  copay_options?: string | null;
  network_tier?: NetworkTier | null;
  csr?: string | null;
  display_string?: string | null;
};

export type ApiBenefit = {
  name: string;
  /** Not in the Swagger definition, but some responses carry an UPPER_SNAKE type. */
  type?: string | null;
  covered?: boolean | null;
  cost_sharings?: ApiCostSharing[] | null;
  explanation?: string | null;
  exclusions?: string | null;
  has_limits?: boolean | null;
  limit_unit?: string | null;
  limit_quantity?: number | null;
};

export type ApiDeductible = {
  type?: "Medical EHB Deductible" | "Combined Medical and Drug EHB Deductible" | "Drug EHB Deductible" | (string & {});
  amount?: number | null;
  csr?: string | null;
  network_tier?: NetworkTier | null;
  family_cost?: "Individual" | "Family Per Person" | "Family" | (string & {}) | null;
  individual?: boolean | null;
  family?: boolean | null;
  display_string?: string | null;
};

export type ApiMoop = Omit<ApiDeductible, "type"> & {
  type?:
    | "Maximum Out of Pocket for Medical and Drug EHB Benefits (Total)"
    | "Maximum Out of Pocket for Medical EHB Benefits"
    | "Maximum Out of Pocket for Drug EHB Benefits"
    | (string & {});
};

export type ApiQualityRating = {
  available?: boolean;
  year?: number;
  global_rating?: number;
  global_not_rated_reason?: string;
  clinical_quality_management_rating?: number;
  enrollee_experience_rating?: number;
  plan_efficiency_rating?: number;
};

export type ApiIssuer = {
  id?: string;
  name?: string;
  state?: string;
  toll_free?: string;
  tty?: string;
  individual_url?: string;
};

export type ApiPlan = {
  id: string;
  name: string;
  state?: string;
  type?: "Indemnity" | "PPO" | "HMO" | "EPO" | "POS" | (string & {});
  metal_level?: "Catastrophic" | "Bronze" | "Expanded Bronze" | "Silver" | "Gold" | "Platinum" | (string & {});
  issuer?: ApiIssuer;
  premium?: number | null;
  premium_w_credit?: number | null;
  ehb_premium?: number | null;
  hsa_eligible?: boolean;
  has_national_network?: boolean;
  specialist_referral_required?: boolean;
  quality_rating?: ApiQualityRating | null;
  deductibles?: ApiDeductible[] | null;
  moops?: ApiMoop[] | null;
  benefits?: ApiBenefit[] | null;
  benefits_url?: string;
  brochure_url?: string;
  formulary_url?: string;
  network_url?: string;
};

export type ApiCounty = { fips: string; name: string; state: string; zipcode?: string };

// The live API answers street1/street2 (seen Sept 2026); the spec says street_1/street_2. Accept both.
type ApiAddress = { street_1?: string; street_2?: string; street1?: string; street2?: string; city?: string; state?: string; zipcode?: string; countyfips?: string; phone?: string };
type ApiProvider = {
  npi: string;
  name: string;
  type?: "Individual" | "Facility";
  /** Live field name. "Group" is a practice or facility. */
  provider_type?: string;
  specialties?: string[];
  accepting?: string;
  facility_types?: string[];
  gender?: string;
  taxonomy?: string;
};
type ApiNearbyProvider = { provider?: ApiProvider; address?: ApiAddress; distance?: number } & Partial<ApiProvider>;

// ---------------------------------------------------------------------------
// States

/**
 * State-run marketplaces for plan year 2026. The Marketplace API has no plans
 * for these states; send people to their own exchange instead. Georgia moved
 * off HealthCare.gov for 2025 and Illinois for 2026. Oregon is announced for
 * 2027, so it stays on HealthCare.gov here.
 */
export const STATE_MARKETPLACES: Record<string, { name: string; url: string }> = {
  CA: { name: "Covered California", url: "https://www.coveredca.com" },
  CO: { name: "Connect for Health Colorado", url: "https://connectforhealthco.com" },
  CT: { name: "Access Health CT", url: "https://www.accesshealthct.com" },
  DC: { name: "DC Health Link", url: "https://dchealthlink.com" },
  GA: { name: "Georgia Access", url: "https://georgiaaccess.gov" },
  ID: { name: "Your Health Idaho", url: "https://www.yourhealthidaho.org" },
  IL: { name: "Get Covered Illinois", url: "https://getcovered.illinois.gov" },
  KY: { name: "kynect", url: "https://kynect.ky.gov" },
  ME: { name: "CoverME.gov", url: "https://www.coverme.gov" },
  MD: { name: "Maryland Health Connection", url: "https://www.marylandhealthconnection.gov" },
  MA: { name: "Massachusetts Health Connector", url: "https://www.mahealthconnector.org" },
  MN: { name: "MNsure", url: "https://www.mnsure.org" },
  NV: { name: "Nevada Health Link", url: "https://www.nevadahealthlink.com" },
  NJ: { name: "Get Covered New Jersey", url: "https://nj.gov/getcoverednj" },
  NM: { name: "beWellnm", url: "https://www.bewellnm.com" },
  NY: { name: "NY State of Health", url: "https://nystateofhealth.ny.gov" },
  PA: { name: "Pennie", url: "https://pennie.com" },
  RI: { name: "HealthSource RI", url: "https://healthsourceri.com" },
  VT: { name: "Vermont Health Connect", url: "https://info.healthconnect.vermont.gov" },
  VA: { name: "Virginia's Insurance Marketplace", url: "https://www.marketplace.virginia.gov" },
  WA: { name: "Washington Healthplanfinder", url: "https://www.wahealthplanfinder.org" },
};

const ALL_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

/** 50 states plus DC, minus the state-run exchanges. Territories are neither. */
export const HEALTHCARE_GOV_STATES: readonly string[] = ALL_STATES.filter((s) => !(s in STATE_MARKETPLACES));

export function isHealthcareGovState(state: string | null | undefined): boolean {
  return !!state && HEALTHCARE_GOV_STATES.includes(state.trim().toUpperCase());
}

// ---------------------------------------------------------------------------
// Validation

const ZIP = /^\d{5}$/;
const NPI = /^\d{10}$/;
const RXCUI = /^\d+$/;
const PLAN_ID = /^\d{5}[A-Z]{2}\d{7}$/;

function bad(message: string): never {
  throw new MarketplaceError("bad_request", message);
}

function cleanList(values: string[], re: RegExp, what: string): string[] {
  const out = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  for (const v of out) if (!re.test(v)) bad(`Invalid ${what}: ${v.slice(0, 20)}`);
  return out;
}

export const isPlanId = (s: string) => PLAN_ID.test(s.trim());

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------
// Endpoints

/** GET /counties/by/zip/{zipcode}. A ZIP can straddle counties; all are returned. */
export async function countiesByZip(zip: string, year = MARKETPLACE_YEAR): Promise<ApiCounty[]> {
  if (!ZIP.test(zip)) bad("zip must be 5 digits");
  const json = await request<{ counties?: ApiCounty[] }>("GET", `/counties/by/zip/${zip}`, {
    query: { year },
    ttl: TTL.geo,
    ns: "cms-geo",
  });
  return (json.counties ?? []).filter((c) => c && c.fips && c.state);
}

export type SearchPlansInput = {
  zip: string;
  age: number;
  /** Household yearly income in dollars. Omit to skip the tax credit estimate. */
  income?: number;
  year?: number;
  /** Most plans to return. The API pages 10 at a time; each page is one budget unit. */
  limit?: number;
  /** Use a specific county when the ZIP spans several. Defaults to the first. */
  countyfips?: string;
  usesTobacco?: boolean;
  /** Premiums do not vary by gender under the ACA; the API example sends one, so we do too. */
  gender?: "Female" | "Male";
};

export type SearchPlansResult = {
  county: ApiCounty;
  counties: ApiCounty[];
  total: number;
  plans: ApiPlan[];
};

const PAGE = 10;

/** POST /plans/search for a one-person household, paging by offset. */
export async function searchPlans(input: SearchPlansInput): Promise<SearchPlansResult> {
  const year = input.year ?? MARKETPLACE_YEAR;
  if (!Number.isFinite(input.age) || input.age < 0 || input.age > 120) bad("age must be 0 to 120");
  if (input.income !== undefined && (!Number.isFinite(input.income) || input.income < 0)) bad("income must be a positive number");
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 100)));

  const counties = await countiesByZip(input.zip, year);
  if (counties.length === 0) throw new MarketplaceHttpError(404, `/counties/by/zip/${input.zip}`, "no county for this ZIP");
  const county = counties.find((c) => c.fips === input.countyfips) ?? counties[0];

  const hasIncome = input.income !== undefined;
  const baseBody = {
    household: {
      ...(hasIncome ? { income: input.income } : {}),
      people: [
        {
          age: Math.floor(input.age),
          aptc_eligible: hasIncome,
          gender: input.gender ?? "Female",
          uses_tobacco: input.usesTobacco ?? false,
        },
      ],
    },
    market: "Individual",
    place: { countyfips: county.fips, state: county.state, zipcode: input.zip },
    year,
    order: "asc",
    sort: "premium",
  };

  const plans: ApiPlan[] = [];
  let total = Infinity;
  for (let offset = 0; plans.length < limit && offset < total; offset += PAGE) {
    const page = await request<{ plans?: ApiPlan[]; total?: number }>("POST", "/plans/search", {
      query: { year },
      body: { ...baseBody, offset },
      ttl: TTL.plans,
      ns: "cms-plans",
    });
    const got = page.plans ?? [];
    total = typeof page.total === "number" ? page.total : plans.length + got.length;
    if (got.length === 0) break;
    for (const p of got) if (!plans.some((q) => q.id === p.id)) plans.push(p);
    if (got.length > PAGE) break; // the server ignored paging and sent everything
  }

  return { county, counties, total: Number.isFinite(total) ? total : plans.length, plans: plans.slice(0, limit) };
}

/** GET /plans/{plan_id}. No household, so no premium on the result. */
export async function getPlan(id: string, year = MARKETPLACE_YEAR): Promise<ApiPlan> {
  if (!isPlanId(id)) bad("planId must be a 14-character HIOS plan id");
  const json = await request<{ plan?: ApiPlan }>("GET", `/plans/${id.trim()}`, {
    query: { year },
    ttl: TTL.plans,
    ns: "cms-plans",
  });
  if (!json.plan) throw new MarketplaceError("bad_response", "CMS Marketplace plan response had no plan");
  return json.plan;
}

export type ProviderAddress = { street1: string; street2: string; city: string; state: string; zip: string };

export type MarketplaceProvider = {
  npi: string;
  name: string;
  type: "Individual" | "Facility" | null;
  specialties: string[];
  accepting: string | null;
  address: ProviderAddress | null;
  distance: number | null;
};

function normAddress(a: ApiAddress | undefined | null): ProviderAddress | null {
  if (!a) return null;
  return {
    street1: a.street_1 ?? a.street1 ?? "",
    street2: a.street_2 ?? a.street2 ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    zip: a.zipcode ?? "",
  };
}

export function formatAddress(a: ProviderAddress | null): string {
  if (!a) return "";
  const street = [a.street1, a.street2].filter(Boolean).join(" ");
  const cityState = [a.city, a.state].filter(Boolean).join(", ");
  return [street, [cityState, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** GET /providers/search near a ZIP. `type` defaults to both kinds. */
export async function providersSearch(input: {
  zip: string;
  q: string;
  type?: "Individual" | "Facility" | "Individual,Facility";
  specialty?: string;
  year?: number;
}): Promise<MarketplaceProvider[]> {
  if (!ZIP.test(input.zip)) bad("zip must be 5 digits");
  const q = input.q.trim();
  if (q.length < 3) bad("search needs at least 3 characters");
  const json = await request<unknown>("GET", "/providers/search", {
    query: {
      q: q.slice(0, 100),
      zipcode: input.zip,
      type: input.type ?? "Individual,Facility",
      specialty: input.specialty,
      year: input.year ?? MARKETPLACE_YEAR,
    },
    ttl: TTL.coverage,
    ns: "cms-providers",
  });
  return pickArray<ApiNearbyProvider>(json, ["providers"])
    .map((row): MarketplaceProvider | null => {
      const p = row.provider ?? (row as ApiProvider);
      if (!p || !p.npi) return null;
      return {
        npi: String(p.npi),
        name: p.name ?? "",
        type: (() => {
          const t = p.type ?? p.provider_type;
          return t === "Individual" ? "Individual" : t === "Facility" || t === "Group" ? "Facility" : null;
        })(),
        specialties: p.specialties ?? [],
        accepting: p.accepting ?? null,
        address: normAddress(row.address),
        distance: typeof row.distance === "number" ? row.distance : null,
      };
    })
    .filter((p): p is MarketplaceProvider => p !== null);
}

export type ProviderCoverageItem = {
  npi: string;
  planId: string;
  coverage: Coverage;
  accepting: string | null;
  addresses: ProviderAddress[];
};

const COVERAGE_KEYS = ["coverage", "Provider & Drug Coverage"];

function normCoverage(v: unknown): Coverage {
  return v === "Covered" || v === "NotCovered" || v === "GenericCovered" ? v : "DataNotProvided";
}

/** GET /providers/covered: one row per (NPI, plan). NPIs are sent in batches of 20. */
export async function providersCovered(npis: string[], planIds: string[], year = MARKETPLACE_YEAR): Promise<ProviderCoverageItem[]> {
  const n = cleanList(npis, NPI, "NPI");
  const p = cleanList(planIds, PLAN_ID, "plan id");
  if (n.length === 0 || p.length === 0) return [];
  const out: ProviderCoverageItem[] = [];
  for (const batch of chunk(n, 20)) {
    const json = await request<unknown>("GET", "/providers/covered", {
      query: { providerids: batch.join(","), planids: p.join(","), year },
      ttl: TTL.coverage,
      ns: "cms-coverage",
    });
    for (const r of pickArray<Record<string, unknown>>(json, COVERAGE_KEYS)) {
      out.push({
        npi: String(r.npi ?? ""),
        planId: String(r.plan_id ?? ""),
        coverage: normCoverage(r.coverage),
        accepting: typeof r.accepting === "string" ? r.accepting : null,
        addresses: Array.isArray(r.addresses) ? (r.addresses as ApiAddress[]).map((a) => normAddress(a)!).filter(Boolean) : [],
      });
    }
  }
  return out;
}

export type MarketplaceDrug = { rxcui: string; name: string; strength: string | null; route: string | null; fullName: string | null };

/** GET /drugs/autocomplete (minimum 3 characters). */
export async function drugsAutocomplete(q: string, year = MARKETPLACE_YEAR): Promise<MarketplaceDrug[]> {
  const query = q.trim();
  if (query.length < 3) bad("drug search needs at least 3 characters");
  const json = await request<unknown>("GET", "/drugs/autocomplete", {
    query: { q: query.slice(0, 100).toLowerCase(), year },
    ttl: TTL.autocomplete,
    ns: "cms-drugs",
  });
  return pickArray<Record<string, unknown>>(json, ["drugs"])
    .filter((d) => d && d.rxcui)
    .map((d) => ({
      rxcui: String(d.rxcui),
      name: String(d.name ?? d.full_name ?? ""),
      strength: typeof d.strength === "string" ? d.strength : null,
      route: typeof d.route === "string" ? d.route : null,
      fullName: typeof d.full_name === "string" ? d.full_name : null,
    }));
}

export type DrugCoverageItem = { rxcui: string; planId: string; coverage: Coverage; genericRxcui: string | null };

/** GET /drugs/covered: one row per (RxCUI, plan). */
export async function drugsCovered(rxcuis: string[], planIds: string[], year = MARKETPLACE_YEAR): Promise<DrugCoverageItem[]> {
  const r = cleanList(rxcuis, RXCUI, "RxCUI");
  const p = cleanList(planIds, PLAN_ID, "plan id");
  if (r.length === 0 || p.length === 0) return [];
  const out: DrugCoverageItem[] = [];
  for (const batch of chunk(r, 20)) {
    const json = await request<unknown>("GET", "/drugs/covered", {
      query: { drugs: batch.join(","), planids: p.join(","), year },
      ttl: TTL.coverage,
      ns: "cms-coverage",
    });
    for (const row of pickArray<Record<string, unknown>>(json, COVERAGE_KEYS)) {
      out.push({
        rxcui: String(row.rxcui ?? ""),
        planId: String(row.plan_id ?? ""),
        coverage: normCoverage(row.coverage),
        genericRxcui: row.generic_rxcui ? String(row.generic_rxcui) : null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan mapping

/**
 * PUF BenefitName strings we know about. API benefit names are matched to
 * these after lowercasing and collapsing punctuation, so "PRIMARY_CARE_VISIT_
 * TO_TREAT_AN_INJURY_OR_ILLNESS" and "Primary care visit to treat an injury
 * or illness" both land on the PUF spelling the engine keys by.
 */
const KNOWN_BENEFITS: string[] = [
  ...Object.values(BENEFIT),
  "Inpatient Hospital Services (e.g., Hospital Stay)",
  "Outpatient Facility Fee (e.g., Ambulatory Surgery Center)",
  "Non-Preferred Brand Drugs",
  "Mental/Behavioral Health Inpatient Services",
  "Substance Abuse Disorder Outpatient Services",
  "Substance Abuse Disorder Inpatient Services",
  "Other Practitioner Office Visit (Nurse, Physician Assistant)",
  "Outpatient Rehabilitation Services",
  "Skilled Nursing Facility",
  "Home Health Care Services",
  "Hospice Services",
  "Durable Medical Equipment",
  "Prenatal and Postnatal Care",
  "Delivery and All Inpatient Services for Maternity Care",
  "Chiropractic Care",
];

/** Spellings that differ by more than case and punctuation. */
const BENEFIT_ALIASES: Record<string, string> = {
  "primary care visit": BENEFIT.PRIMARY_CARE,
  "primary care": BENEFIT.PRIMARY_CARE,
  "specialist visit to treat an injury or illness": BENEFIT.SPECIALIST,
  "preventive care screening immunizations": BENEFIT.PREVENTIVE,
  "emergency room": BENEFIT.EMERGENCY_ROOM,
  "emergency transportation ambulance services": BENEFIT.AMBULANCE,
  "urgent care": BENEFIT.URGENT_CARE,
  "laboratory outpatient and professional services lab": BENEFIT.LAB,
  "x rays and diagnostic imaging services": BENEFIT.XRAY,
  "imaging ct pet scans mri s": BENEFIT.IMAGING,
  "mental behavioral health outpatient": BENEFIT.MENTAL_HEALTH,
};

const benefitKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CANONICAL = new Map<string, string>([
  ...KNOWN_BENEFITS.map((n) => [benefitKey(n), n] as [string, string]),
  ...Object.entries(BENEFIT_ALIASES),
]);

/** PUF BenefitName for an API benefit, or null when we do not recognize it. */
export function canonicalBenefitName(name: string | null | undefined, type?: string | null): string | null {
  for (const s of [name, type]) {
    if (!s) continue;
    const hit = CANONICAL.get(benefitKey(s));
    if (hit) return hit;
  }
  return null;
}

const NO_CSR = "Exchange variant (no CSR)";

function isInNetwork(tier: string | null | undefined): boolean {
  // Tier 1 in-network only. A missing tier is treated as in-network.
  return !tier || tier === "In-Network";
}

function isIndividual(x: { individual?: boolean | null; family_cost?: string | null }): boolean {
  if (x.individual === true) return true;
  if (x.family_cost === "Individual") return true;
  return x.individual == null && x.family_cost == null;
}

/**
 * Pick one CSR variant for the whole plan. A plan search for a
 * CSR-eligible household can return that variant's numbers; when more than
 * one variant is present, prefer the one requested, then the standard
 * exchange variant, then whatever came first.
 */
function chooseCsr(plan: ApiPlan, preferred?: string): string | null {
  const seen: string[] = [];
  const add = (c: string | null | undefined) => {
    if (c && !seen.includes(c)) seen.push(c);
  };
  for (const d of plan.deductibles ?? []) if (isInNetwork(d.network_tier)) add(d.csr);
  for (const m of plan.moops ?? []) if (isInNetwork(m.network_tier)) add(m.csr);
  if (seen.length === 0) return null;
  if (preferred && seen.includes(preferred)) return preferred;
  if (seen.length === 1) return seen[0];
  return seen.includes(NO_CSR) ? NO_CSR : seen[0];
}

const csrMatches = (csr: string | null | undefined, chosen: string | null) => !csr || !chosen || csr === chosen;

function pickAmount<T extends { type?: string; amount?: number | null; csr?: string | null; network_tier?: string | null; individual?: boolean | null; family_cost?: string | null }>(
  rows: T[] | null | undefined,
  types: string[],
  csr: string | null
): { amount: number; type: string } | null {
  const ok = (rows ?? []).filter(
    (r) => isInNetwork(r.network_tier) && isIndividual(r) && csrMatches(r.csr, csr) && typeof r.amount === "number" && Number.isFinite(r.amount)
  );
  for (const t of types) {
    const hit = ok.find((r) => r.type === t);
    if (hit) return { amount: hit.amount as number, type: t };
  }
  return null;
}

const pctText = (rate: number) => {
  const pct = rate > 1 ? rate : rate * 100;
  return `${Math.round(pct * 100) / 100}%`;
};

/**
 * Rebuild the PUF's CopayInnTier1 text from the API's structured copay
 * fields. `copay_options` carries the same suffix vocabulary the PUF does
 * ("Copay after deductible", "No Charge", "Copay per Day", ...).
 */
function copayText(cs: ApiCostSharing): string | null {
  const opts = cs.copay_options?.trim() || "";
  const amt = typeof cs.copay_amount === "number" ? cs.copay_amount : null;
  if (!opts && amt === null) return null;
  if (/not applicable/i.test(opts)) return "Not Applicable";
  if (/no charge/i.test(opts)) return opts;
  if (amt === null) return null;
  if (amt === 0 && !opts) return "Not Applicable";
  let suffix = opts ? (/copay/i.test(opts) ? opts : `Copay ${opts}`) : "Copay";
  // A per-day or per-stay unit that only made it into display_string still
  // matters: a per-day inpatient copay multiplies by the length of stay.
  const disp = cs.display_string ?? "";
  if (!/per\s+(day|stay)/i.test(suffix)) {
    const unit = disp.match(/per\s+(day|stay)/i);
    if (unit) suffix = suffix.replace(/copay/i, `Copay per ${unit[1][0].toUpperCase()}${unit[1].slice(1).toLowerCase()}`);
  }
  return `$${amt} ${suffix}`;
}

/** Rebuild the PUF's CoinsInnTier1 text from the structured coinsurance fields. */
function coinsText(cs: ApiCostSharing): string | null {
  const opts = cs.coinsurance_options?.trim() || "";
  const rate = typeof cs.coinsurance_rate === "number" ? cs.coinsurance_rate : null;
  if (!opts && rate === null) return null;
  if (/not applicable/i.test(opts)) return "Not Applicable";
  if (/no charge/i.test(opts)) return opts;
  if (rate === null) return null;
  if (!opts) return pctText(rate);
  return `${pctText(rate)} ${/coinsurance/i.test(opts) ? opts : `Coinsurance ${opts}`}`;
}

/** Split a display_string like "$30 Copay after deductible / 20% Coinsurance" into its two cells. */
function splitDisplay(display: string): [string | null, string | null] {
  const parts = display.split(/\s*(?:\/|;|,|\band\b|\bthen\b|\bplus\b)\s*/i).filter(Boolean);
  const copay = parts.find((p) => /\$/.test(p)) ?? null;
  const coins = parts.find((p) => /%/.test(p)) ?? null;
  if (copay || coins) return [copay, coins];
  return [display, null];
}

/**
 * One API cost-sharing entry to the engine's CostShare, always through the
 * shared parser. Structured fields win; display_string is the fallback.
 */
export function costShareFromApi(cs: ApiCostSharing): CostShare {
  const copay = copayText(cs);
  const coins = coinsText(cs);
  if (cs.copay_options || cs.coinsurance_options || (!cs.display_string && (copay || coins))) {
    return pickCostShare(copay, coins);
  }
  if (cs.display_string) {
    const [c, k] = splitDisplay(cs.display_string);
    return pickCostShare(c, k);
  }
  return pickCostShare(copay, coins);
}

function pickCostSharing(b: ApiBenefit, csr: string | null): ApiCostSharing | null {
  const inn = (b.cost_sharings ?? []).filter((c) => isInNetwork(c.network_tier));
  return inn.find((c) => csrMatches(c.csr, csr)) ?? inn.find((c) => c.csr === NO_CSR) ?? inn[0] ?? null;
}

/**
 * Benefits whose coinsurance best stands in for the plan's general
 * post-deductible coinsurance: the big-ticket medical services, where an
 * unmapped service (a surgery, a scan) would actually be billed.
 */
const CORE_FOR_COINSURANCE = [
  BENEFIT.INPATIENT,
  "Inpatient Hospital Services (e.g., Hospital Stay)",
  BENEFIT.OUTPATIENT_SURGERY,
  "Outpatient Facility Fee (e.g., Ambulatory Surgery Center)",
  BENEFIT.IMAGING,
  BENEFIT.EMERGENCY_ROOM,
  BENEFIT.XRAY,
  BENEFIT.LAB,
  BENEFIT.SPECIALIST,
  BENEFIT.PRIMARY_CARE,
  BENEFIT.URGENT_CARE,
];

function modeRate(rates: number[]): number | null {
  if (rates.length === 0) return null;
  const counts = new Map<number, number>();
  for (const r of rates) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const [r, n] of counts) {
    // Ties go to the higher rate: overstating a cost beats hiding one.
    if (n > bestN || (n === bestN && best !== null && r > best)) {
      best = r;
      bestN = n;
    }
  }
  return best;
}

export type EnginePlanNotes = {
  planId: string;
  /** CSR variant the numbers came from, or null when the API did not say. */
  csr: string | null;
  deductibleType: string;
  moopType: string;
  /**
   * Separate in-network drug deductible when the plan has one. The engine
   * models a single combined deductible, so drug costs on such a plan are
   * approximated through the medical deductible. Show this as a caveat.
   */
  separateDrugDeductible: number | null;
  separateDrugMoop: number | null;
  coinsuranceSource: "core-benefit-mode" | "any-benefit-mode" | "none";
  premiumSource: "premium_w_credit" | "premium" | "override";
  notCovered: string[];
  /** API benefit names that did not match a known PUF name (kept under their API name). */
  unmatchedBenefits: string[];
  limits: Record<string, string>;
  exclusions: Record<string, string>;
};

export type ToEnginePlanOptions = {
  /** "full" ignores the tax credit. Default uses premium_w_credit when present. */
  premium?: "withCredit" | "full";
  /** Monthly premium to use when the API plan has none (GET /plans/{id}). */
  monthlyPremium?: number;
  /** CSR variant to prefer when several are present. */
  csr?: string;
};

/**
 * Map a Marketplace API plan onto the engine's Plan, plus notes the
 * interface should surface. Returns null when the plan cannot be priced
 * (no in-network individual deductible, MOOP or premium), matching
 * loadPlan's rule that a missing number never becomes a quiet zero.
 *
 * Choices:
 *  - Deductible: in-network, individual, "Combined Medical and Drug EHB
 *    Deductible" if present, else "Medical EHB Deductible". A separate drug
 *    deductible is reported in notes, not modeled.
 *  - MOOP: in-network, individual, "(Total)" medical and drug if present,
 *    else the medical MOOP.
 *  - coinsuranceRate (the fallback for any benefit the map lacks): the most
 *    common after-deductible coinsurance across the core medical benefits,
 *    ties to the higher rate; else across all benefits; else 0.
 *  - costSharing: each benefit's in-network entry rebuilt into PUF text and
 *    run through pickCostShare. covered === false means notApplicable.
 */
export function toEnginePlanDetailed(api: ApiPlan, opts: ToEnginePlanOptions = {}): { plan: Plan; notes: EnginePlanNotes } | null {
  const csr = chooseCsr(api, opts.csr);

  const ded = pickAmount(api.deductibles, ["Combined Medical and Drug EHB Deductible", "Medical EHB Deductible"], csr);
  const moop = pickAmount(api.moops, ["Maximum Out of Pocket for Medical and Drug EHB Benefits (Total)", "Maximum Out of Pocket for Medical EHB Benefits"], csr);

  let monthlyPremium: number | undefined;
  let premiumSource: EnginePlanNotes["premiumSource"] = "premium";
  if (opts.premium !== "full" && typeof api.premium_w_credit === "number") {
    monthlyPremium = api.premium_w_credit;
    premiumSource = "premium_w_credit";
  } else if (typeof api.premium === "number") {
    monthlyPremium = api.premium;
  } else if (typeof opts.monthlyPremium === "number") {
    monthlyPremium = opts.monthlyPremium;
    premiumSource = "override";
  }

  if (!ded || !moop || monthlyPremium === undefined) return null;

  const drugDed =
    ded.type === "Medical EHB Deductible" ? pickAmount(api.deductibles, ["Drug EHB Deductible"], csr)?.amount ?? null : null;
  const drugMoop =
    moop.type === "Maximum Out of Pocket for Medical EHB Benefits"
      ? pickAmount(api.moops, ["Maximum Out of Pocket for Drug EHB Benefits"], csr)?.amount ?? null
      : null;

  const costSharing: Record<string, CostShare> = {};
  const notCovered: string[] = [];
  const unmatched: string[] = [];
  const limits: Record<string, string> = {};
  const exclusions: Record<string, string> = {};
  let inpatientDays: number | undefined;

  for (const b of api.benefits ?? []) {
    if (!b || !b.name) continue;
    const canonical = canonicalBenefitName(b.name, b.type);
    const name = canonical ?? b.name;
    if (!canonical) unmatched.push(b.name);

    if (b.covered === false) {
      costSharing[name] = { kind: "notApplicable" };
      notCovered.push(name);
    } else {
      const cs = pickCostSharing(b, csr);
      if (cs) {
        const share = costShareFromApi(cs);
        costSharing[name] = share;
        if (share.kind === "copay" && share.unit === "day" && /inpatient/i.test(name)) {
          const m = `${cs.display_string ?? ""} ${b.explanation ?? ""}`.match(/(?:first|up to|max(?:imum)?(?: of)?)\s+(\d+)\s+days?/i);
          if (m) inpatientDays = Math.max(inpatientDays ?? 0, Number(m[1]));
        }
      }
    }
    if (b.has_limits && b.limit_quantity && b.limit_unit) limits[name] = `${b.limit_quantity} ${b.limit_unit}`;
    if (b.exclusions && b.exclusions.trim()) exclusions[name] = b.exclusions.trim();
  }

  const afterDedRate = (names: string[]) =>
    names
      .map((n) => costSharing[n])
      .filter((c): c is Extract<CostShare, { kind: "coinsurance" }> => !!c && c.kind === "coinsurance" && c.afterDeductible)
      .map((c) => c.rate);

  let coinsuranceSource: EnginePlanNotes["coinsuranceSource"] = "core-benefit-mode";
  let coinsuranceRate = modeRate(afterDedRate(CORE_FOR_COINSURANCE));
  if (coinsuranceRate === null) {
    coinsuranceSource = "any-benefit-mode";
    coinsuranceRate = modeRate(afterDedRate(Object.keys(costSharing)));
  }
  if (coinsuranceRate === null) {
    coinsuranceSource = "none";
    coinsuranceRate = 0;
  }

  const plan: Plan = {
    name: api.name,
    deductible: ded.amount,
    coinsuranceRate,
    outOfPocketMax: moop.amount,
    monthlyPremium,
    costSharing,
    ...(inpatientDays ? { inpatientCopayMaxDays: inpatientDays } : {}),
  };

  return {
    plan,
    notes: {
      planId: api.id,
      csr,
      deductibleType: ded.type,
      moopType: moop.type,
      separateDrugDeductible: drugDed,
      separateDrugMoop: drugMoop,
      coinsuranceSource,
      premiumSource,
      notCovered,
      unmatchedBenefits: unmatched,
      limits,
      exclusions,
    },
  };
}

export function toEnginePlan(api: ApiPlan, opts?: ToEnginePlanOptions): Plan | null {
  return toEnginePlanDetailed(api, opts)?.plan ?? null;
}

// ---------------------------------------------------------------------------
// Matching a Google place to a directory provider

const STOP = new Set([
  "the", "of", "and", "at", "a", "an", "llc", "inc", "pc", "pllc", "pa", "ltd", "co", "corp", "md", "do", "dr",
  "np", "aprn", "fnp", "rn", "dds", "facs", "phd",
]);

const EXPAND: Record<string, string> = {
  st: "street", ste: "suite", ave: "avenue", av: "avenue", rd: "road", blvd: "boulevard", ln: "lane",
  pkwy: "parkway", hwy: "highway", ct: "court", pl: "place", cir: "circle", n: "north", s: "south",
  e: "east", w: "west", ctr: "center", centre: "center", hosp: "hospital", med: "medical", mt: "mount",
  univ: "university", hlth: "health", svcs: "services", assoc: "associates",
};

/**
 * Lowercase word tokens with abbreviations expanded and filler dropped.
 * In a name "Dr" is a title and is dropped; in an address it is "Drive".
 */
export function tokens(s: string | null | undefined, kind: "name" | "address" = "name"): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => (kind === "address" && t === "dr" ? "drive" : EXPAND[t] ?? t))
    .filter((t) => !STOP.has(t));
}

/** Dice coefficient over token sets, 0 to 1. */
export function tokenOverlap(a: string | null | undefined, b: string | null | undefined, kind: "name" | "address" = "name"): number {
  const A = new Set(tokens(a, kind));
  const B = new Set(tokens(b, kind));
  if (A.size === 0 || B.size === 0) return 0;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  return (2 * both) / (A.size + B.size);
}

const streetNumber = (s: string | null | undefined) => (s ?? "").match(/\b(\d{1,6})\b/)?.[1] ?? null;

/**
 * How well a directory entry matches a place, 0 to 1. Name carries most of
 * the weight; the address breaks ties between same-named offices, and a
 * matching street number is the strongest address signal.
 */
export function matchScore(place: { name: string; address?: string | null }, candidate: { name: string; address?: string | null }): number {
  const name = tokenOverlap(place.name, candidate.name);
  if (!place.address || !candidate.address) return Math.round(name * 1000) / 1000;
  const numA = streetNumber(place.address);
  const numB = streetNumber(candidate.address);
  const sameNumber = numA !== null && numA === numB ? 1 : 0;
  const addr = 0.5 * tokenOverlap(place.address, candidate.address, "address") + 0.5 * sameNumber;
  return Math.round((0.7 * name + 0.3 * addr) * 1000) / 1000;
}

/** Best candidate for a place, or null when nothing clears `threshold`. */
export function bestMatch<T extends { name: string; address?: string | null }>(
  place: { name: string; address?: string | null },
  candidates: T[],
  threshold = 0.4
): { candidate: T; score: number } | null {
  let best: { candidate: T; score: number } | null = null;
  for (const c of candidates) {
    const score = matchScore(place, c);
    if (!best || score > best.score) best = { candidate: c, score };
  }
  return best && best.score >= threshold ? best : null;
}
