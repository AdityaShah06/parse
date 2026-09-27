/**
 * NPI Registry (CMS NPPES) lookups: who a place is, as a licensed provider.
 *
 * API v2.1, free, no key: https://npiregistry.cms.hhs.gov/api/?version=2.1
 * Every HTTP call spends one unit of the "npi" daily budget and is cached for
 * 7 days per exact query URL. Matches are cached 7 days per place.
 *
 * matchPlaceToNpi scores candidates by normalized name token overlap, address
 * (street number, ZIP, street name) and taxonomy fit, and returns the best one
 * above MIN_CONFIDENCE, or null. It never guesses a match it cannot support.
 *
 * Server only.
 */

import { cached, envLimit, fetchWithTimeout, spend } from "./server-cache";
import { BENEFIT_CATEGORIES, resolveCategory } from "./places";

export const NPI_URL = "https://npiregistry.cms.hhs.gov/api/";
const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
export const MIN_CONFIDENCE = 0.5;

export class NpiBudgetExhausted extends Error {
  readonly code = "budget";
  constructor() {
    super("Daily NPI Registry budget is used up");
    this.name = "NpiBudgetExhausted";
  }
}

export class NpiHttpError extends Error {
  readonly code = "upstream";
  constructor(
    readonly status: number,
    detail?: string
  ) {
    super(`NPI Registry error ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "NpiHttpError";
  }
}

// ---------------------------------------------------------------------------
// Raw and normalized shapes

type RawAddress = {
  address_purpose?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  telephone_number?: string;
};

export type RawNpiResult = {
  number?: string | number;
  enumeration_type?: string;
  basic?: {
    organization_name?: string;
    first_name?: string;
    last_name?: string;
    middle_name?: string;
    credential?: string;
  };
  other_names?: { organization_name?: string; first_name?: string; last_name?: string; type?: string }[];
  addresses?: RawAddress[];
  taxonomies?: { code?: string; desc?: string; primary?: boolean }[];
};

export type NpiRecord = {
  npi: string;
  type: "NPI-1" | "NPI-2";
  name: string;
  /** Legal name plus any other names (DBA, former) the registry lists. */
  names: string[];
  credential: string | null;
  address: { line1: string; line2: string; city: string; state: string; zip5: string; phone: string | null };
  taxonomy: string | null;
  taxonomies: string[];
};

export type NpiSearchInput = {
  /** Organization name. A trailing * is a prefix wildcard (at least 2 characters before it). */
  name?: string;
  first?: string;
  last?: string;
  taxonomy?: string;
  zip?: string;
  city?: string;
  state?: string;
  type: "NPI-1" | "NPI-2" | "any";
  limit?: number;
  skip?: number;
};

const zip5 = (z?: string) => (z ?? "").replace(/\D/g, "").slice(0, 5);

export function normalizeRecord(r: RawNpiResult): NpiRecord | null {
  if (r.number === undefined || r.number === null) return null;
  const type = r.enumeration_type === "NPI-1" ? "NPI-1" : "NPI-2";
  const b = r.basic ?? {};
  const person = [b.first_name, b.last_name].filter(Boolean).join(" ");
  const name = (type === "NPI-1" ? person : b.organization_name) || person || b.organization_name || "";
  const others = (r.other_names ?? [])
    .map((o) => o.organization_name || [o.first_name, o.last_name].filter(Boolean).join(" "))
    .filter((s): s is string => !!s);
  const addrs = r.addresses ?? [];
  const a = addrs.find((x) => x.address_purpose === "LOCATION") ?? addrs[0] ?? {};
  const tax = r.taxonomies ?? [];
  const primary = tax.find((t) => t.primary) ?? tax[0];
  return {
    npi: String(r.number),
    type,
    name,
    names: [name, ...others].filter(Boolean),
    credential: b.credential ?? null,
    address: {
      line1: a.address_1 ?? "",
      line2: a.address_2 ?? "",
      city: a.city ?? "",
      state: a.state ?? "",
      zip5: zip5(a.postal_code),
      phone: a.telephone_number ?? null,
    },
    taxonomy: primary?.desc ?? null,
    taxonomies: tax.map((t) => t.desc).filter((d): d is string => !!d),
  };
}

/** The request URL for a search. Exported for tests. */
export function npiUrl(q: NpiSearchInput): string {
  const p = new URLSearchParams({ version: "2.1" });
  if (q.type !== "any") p.set("enumeration_type", q.type);
  if (q.name) p.set("organization_name", q.name);
  if (q.first) p.set("first_name", q.first);
  if (q.last) p.set("last_name", q.last);
  if (q.taxonomy) p.set("taxonomy_description", q.taxonomy);
  if (q.city) p.set("city", q.city);
  if (q.state) p.set("state", q.state);
  if (q.zip) p.set("postal_code", q.zip);
  p.set("limit", String(Math.min(200, Math.max(1, q.limit ?? 50))));
  if (q.skip) p.set("skip", String(q.skip));
  return `${NPI_URL}?${p.toString()}`;
}

/** Search the NPI Registry. Cached 7 days per query; each miss spends one "npi" unit. */
export async function npiSearch(q: NpiSearchInput): Promise<NpiRecord[]> {
  if (!q.name && !q.first && !q.last && !q.taxonomy && !q.zip && !q.city) {
    throw new NpiHttpError(400, "need a name, taxonomy, ZIP or city");
  }
  const url = npiUrl(q);
  return cached("npi", url, SEVEN_DAYS, async () => {
    if (!(await spend("npi", envLimit("NPI_DAILY_LIMIT", 3000)))) throw new NpiBudgetExhausted();
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 10_000);
    } catch {
      throw new NpiHttpError(504, "timeout or network");
    }
    if (!res.ok) throw new NpiHttpError(res.status);
    const j = (await res.json()) as { results?: RawNpiResult[]; Errors?: { description?: string }[] };
    if (j.Errors?.length) throw new NpiHttpError(400, j.Errors.map((e) => e.description).join("; ").slice(0, 200));
    return (j.results ?? []).map(normalizeRecord).filter((r): r is NpiRecord => r !== null);
  });
}

// ---------------------------------------------------------------------------
// Matching

const DROP = new Set([
  "llc", "inc", "pc", "pllc", "llp", "lp", "corp", "corporation", "co", "ltd", "pa", "dba",
  "md", "do", "dds", "dmd", "od", "np", "phd", "psyd", "lcsw", "lpc", "dpt", "pt", "aprn", "fnp", "rn", "pac",
  "the", "of", "and", "at", "a", "an", "dr",
]);
const EXPAND: Record<string, string> = {
  st: "saint", ctr: "center", cntr: "center", centre: "center", hosp: "hospital", med: "medical", hlth: "health",
  univ: "university", mt: "mount", assoc: "associate", svc: "service", svcs: "service", orthopaedic: "orthopedic",
  ortho: "orthopedic", pharm: "pharmacy", phcy: "pharmacy", "&": "and",
};

/** Lowercase tokens with business suffixes, credentials and filler words removed. */
export function nameTokens(s: string): string[] {
  const words = s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => EXPAND[w] ?? w)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => !DROP.has(w));
  return [...new Set(words)];
}

/** Half Dice coefficient, half containment of the smaller set. 0 to 1. */
export function nameSimilarity(a: string, b: string): number {
  const A = nameTokens(a);
  const B = new Set(nameTokens(b));
  if (!A.length || !B.size) return 0;
  const inter = A.filter((t) => B.has(t)).length;
  const dice = (2 * inter) / (A.length + B.size);
  const contain = inter / Math.min(A.length, B.size);
  return 0.5 * dice + 0.5 * contain;
}

const STREET_SUFFIX = new Set(["st", "street", "dr", "drive", "rd", "road", "ave", "avenue", "blvd", "boulevard", "ln", "lane", "ct", "court", "way", "pkwy", "parkway", "hwy", "highway", "pl", "place", "cir", "circle", "ste", "suite", "n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);

export type ParsedAddress = { number: string | null; streetTokens: string[]; city: string | null; state: string | null; zip5: string | null };

/** Parse a Google formattedAddress such as "1 Hospital Dr, Columbia, MO 65212, USA". */
export function parseAddress(address: string): ParsedAddress {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  const street = parts[0] ?? "";
  const number = street.match(/^(\d+)/)?.[1] ?? null;
  const stateZipIdx = parts.findIndex((p) => /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(p));
  const stateZip = stateZipIdx >= 0 ? parts[stateZipIdx] : "";
  const state = stateZip.match(/^([A-Z]{2})/)?.[1] ?? null;
  const zip = stateZip.match(/\d{5}/)?.[0] ?? null;
  const city = stateZipIdx > 0 ? parts[stateZipIdx - 1] : null;
  return { number, streetTokens: streetTokens(street), city, state, zip5: zip };
}

function streetTokens(line: string): string[] {
  return line
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !STREET_SUFFIX.has(w));
}

/** 0 to 1: street number 0.5, ZIP 0.3, a shared street name word 0.2. */
export function addressSimilarity(place: ParsedAddress, rec: NpiRecord["address"]): number {
  let s = 0;
  const recNumber = rec.line1.match(/^\s*(\d+)/)?.[1] ?? null;
  if (place.number && recNumber && place.number === recNumber) s += 0.5;
  if (place.zip5 && rec.zip5 && place.zip5 === rec.zip5) s += 0.3;
  const recStreet = new Set(streetTokens(rec.line1));
  if (place.streetTokens.some((t) => recStreet.has(t))) s += 0.2;
  return Math.round(s * 100) / 100;
}

/** 1 when any of the record's taxonomies fits a hint, 0.5 with no hints, else 0. */
export function taxonomyFit(taxonomies: string[], hints: string[]): number {
  if (!hints.length) return 0.5;
  const descs = taxonomies.map((t) => t.toLowerCase());
  const hit = hints.some((h) => {
    const hl = h.toLowerCase();
    const ht = hl.split(/[^a-z]+/).filter((w) => w.length > 2);
    return descs.some((d) => d.includes(hl) || (ht.length > 0 && ht.every((w) => d.includes(w))));
  });
  return hit ? 1 : 0;
}

export type NpiMatch = { npi: string; name: string; address: string; taxonomy: string | null; confidence: number };

export type PlaceLike = { id?: string; name: string; address: string };

/** Score one candidate. Weights: name 0.5, address 0.35, taxonomy 0.15. */
export function scoreCandidate(place: PlaceLike, rec: NpiRecord, hints: string[]): number {
  const parsed = parseAddress(place.address);
  const personName = rec.type === "NPI-1" ? personTokens(place.name) : null;
  const name = Math.max(
    ...rec.names.map((n) => nameSimilarity(personName ?? place.name, n)),
    0
  );
  const addr = addressSimilarity(parsed, rec.address);
  const tax = taxonomyFit(rec.taxonomies, hints);
  // A weak name needs a strong address (number and ZIP) to count at all.
  if (name < 0.3 && addr < 0.8) return 0;
  return Math.round((0.5 * name + 0.35 * addr + 0.15 * tax) * 100) / 100;
}

const CREDENTIAL = /,?\s*\b(M\.?D|D\.?O|N\.?P|PA-C|D\.?D\.?S|D\.?M\.?D|O\.?D|Ph\.?D|Psy\.?D|LCSW|LPC|DPT|FNP(-C)?|APRN)\b\.?/gi;

/** Whether a Google place name looks like one person ("Jane Smith, MD", "Dr. Jane Smith"). */
export function looksLikePerson(name: string): boolean {
  return /^dr\.?\s/i.test(name) || /,\s*(MD|DO|NP|PA-C|DDS|DMD|OD|PhD|PsyD|LCSW|LPC|DPT|FNP|APRN)\b/i.test(name);
}

function personTokens(name: string): string {
  return name.replace(/^dr\.?\s+/i, "").replace(CREDENTIAL, " ").replace(/\s+/g, " ").trim();
}

/** First word of the name worth searching on, as an NPI prefix wildcard. */
function orgPrefix(name: string): string | null {
  const w = name
    .replace(/&/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .find((x) => x.length >= 2 && !["the", "dr"].includes(x.toLowerCase()));
  return w ? `${w}*` : null;
}

function hintsFor(hint: string | string[]): string[] {
  if (Array.isArray(hint)) return hint;
  const cat = resolveCategory(hint);
  return cat ? BENEFIT_CATEGORIES[cat].npiTaxonomies : [hint];
}

const fmtAddress = (a: NpiRecord["address"]) => [a.line1, a.city, [a.state, a.zip5].filter(Boolean).join(" ")].filter(Boolean).join(", ");

/**
 * Find the NPI record behind a Google place. `hint` is a category key, one
 * taxonomy description, or a list of them. At most two registry calls per
 * place (by ZIP, then by city and state), and none on a cache hit.
 */
export async function matchPlaceToNpi(place: PlaceLike, hint: string | string[]): Promise<NpiMatch | null> {
  const hints = hintsFor(hint);
  const cacheKey = `${place.id ?? ""}|${place.name}|${place.address}|${hints.join(";")}`;
  return cached<NpiMatch | null>("npi-match", cacheKey, SEVEN_DAYS, async () => {
    const addr = parseAddress(place.address);
    const person = looksLikePerson(place.name);
    const queries: NpiSearchInput[] = [];
    if (person) {
      const parts = personTokens(place.name).split(" ").filter(Boolean);
      if (parts.length >= 2) {
        const first = parts[0];
        const last = parts[parts.length - 1];
        if (addr.zip5) queries.push({ type: "NPI-1", first, last, zip: addr.zip5 });
        if (addr.state) queries.push({ type: "NPI-1", first, last, state: addr.state });
      }
    } else {
      const prefix = orgPrefix(place.name);
      if (prefix) {
        if (addr.zip5) queries.push({ type: "NPI-2", name: prefix, zip: addr.zip5 });
        if (addr.city && addr.state) queries.push({ type: "NPI-2", name: prefix, city: addr.city, state: addr.state });
      }
    }

    let best: { rec: NpiRecord; score: number } | null = null;
    for (const q of queries) {
      const recs = await npiSearch({ ...q, limit: 50 });
      for (const rec of recs) {
        const score = scoreCandidate(place, rec, hints);
        if (!best || score > best.score) best = { rec, score };
      }
      if (best && best.score >= MIN_CONFIDENCE) break;
    }
    if (!best || best.score < MIN_CONFIDENCE) return null;
    return { npi: best.rec.npi, name: best.rec.name, address: fmtAddress(best.rec.address), taxonomy: best.rec.taxonomy, confidence: best.score };
  });
}
