/**
 * Live Find care search over Google Places API (New) Text Search.
 *
 * One Text Search request per (category, location, detail) per day. The
 * request is billed at the highest SKU of any field in the mask, so the mask
 * is picked per detail level:
 *   - "list": Enterprise (rating, count, hours, phone, website)
 *   - "full": Enterprise + Atmosphere (adds reviews and the Gemini review summary)
 * A "list" request is served from a cached "full" result when one exists.
 *
 * Places never produce a dollar figure. Cost of a visit stays in the engine.
 *
 * Server only. GOOGLE_PLACES_KEY is sent as a header and never logged.
 */

import { cacheGet, cacheSet, envLimit, fetchWithTimeout, spend } from "./server-cache";
import { centroid, haversineMiles, isLatLng, isZip, zipCentroid, type LatLng } from "./geo";

// ---------------------------------------------------------------------------
// Categories

export type BenefitCategory =
  | "primary"
  | "urgent"
  | "er"
  | "mental"
  | "psychiatry"
  | "imaging"
  | "orthopedics"
  | "physical_therapy"
  | "pharmacy"
  | "obgyn"
  | "dermatology"
  | "dentist"
  | "eye"
  | "lab"
  | "telehealth";

export type CategoryConfig = {
  label: string;
  /** Text Search query. The ZIP is appended as "near 12345" when searching by ZIP. */
  query: string;
  /** A Places (New) Table A type. Biases results; strictTypeFiltering stays off. */
  includedType?: string;
  /** NPI taxonomy descriptions that count as a fit for this category (for matching). */
  npiTaxonomies: string[];
  /** Whether Google Places has anything to show. Telehealth does not. */
  searchable: boolean;
  note?: string;
};

/**
 * includedType values checked against the Places (New) Table A list, Health
 * and Wellness group: chiropractor, dental_clinic, dentist, doctor, drugstore,
 * general_hospital, hospital, medical_center, medical_clinic, medical_lab,
 * pharmacy, physiotherapist, skin_care_clinic, and others. There is no
 * urgent_care, psychiatrist, psychologist or mental health type, so those
 * categories rely on the query text alone.
 */
export const BENEFIT_CATEGORIES: Record<BenefitCategory, CategoryConfig> = {
  primary: { label: "Primary care", query: "primary care doctor", includedType: "doctor", npiTaxonomies: ["Family Medicine", "Internal Medicine", "General Practice", "Primary Care"], searchable: true },
  urgent: { label: "Urgent care", query: "urgent care", npiTaxonomies: ["Urgent Care", "Emergency Medicine", "Family Medicine"], searchable: true },
  er: { label: "Emergency room", query: "emergency room", includedType: "hospital", npiTaxonomies: ["General Acute Care Hospital", "Hospital", "Emergency Medicine"], searchable: true },
  mental: { label: "Mental health", query: "therapist counseling", npiTaxonomies: ["Counselor", "Psychologist", "Social Worker", "Marriage & Family Therapist"], searchable: true },
  psychiatry: { label: "Psychiatry", query: "psychiatrist", npiTaxonomies: ["Psychiatry", "Psychiatric"], searchable: true },
  imaging: { label: "Imaging", query: "imaging center MRI", npiTaxonomies: ["Radiology", "Diagnostic Radiology"], searchable: true },
  orthopedics: { label: "Orthopedics", query: "orthopedic doctor", includedType: "doctor", npiTaxonomies: ["Orthopaedic Surgery", "Sports Medicine"], searchable: true },
  physical_therapy: { label: "Physical therapy", query: "physical therapy", includedType: "physiotherapist", npiTaxonomies: ["Physical Therapist", "Physical Therapy"], searchable: true },
  pharmacy: { label: "Pharmacy", query: "pharmacy", includedType: "pharmacy", npiTaxonomies: ["Pharmacy", "Pharmacist"], searchable: true },
  obgyn: { label: "OB-GYN", query: "OB-GYN women's health clinic", includedType: "doctor", npiTaxonomies: ["Obstetrics & Gynecology"], searchable: true },
  dermatology: { label: "Dermatology", query: "dermatologist", includedType: "doctor", npiTaxonomies: ["Dermatology"], searchable: true },
  dentist: { label: "Dentist", query: "dentist", includedType: "dentist", npiTaxonomies: ["Dentist", "Dental"], searchable: true },
  eye: { label: "Eye doctor", query: "optometrist eye doctor", npiTaxonomies: ["Optometrist", "Ophthalmology"], searchable: true },
  lab: { label: "Lab work", query: "lab blood test", includedType: "medical_lab", npiTaxonomies: ["Clinical Medical Laboratory", "Laboratory"], searchable: true },
  telehealth: {
    label: "Telehealth",
    query: "",
    npiTaxonomies: [],
    searchable: false,
    note: "Telehealth has no storefront to map. Check your plan's telehealth benefit and the app or phone line on your insurance card.",
  },
};

/** Keys the older Find care room uses (CareKind) that are not category keys. */
const ALIASES: Record<string, BenefitCategory> = { specialist: "orthopedics", ortho: "orthopedics", pt: "physical_therapy", mentalhealth: "mental", optometrist: "eye" };

export function resolveCategory(key: unknown): BenefitCategory | null {
  if (typeof key !== "string") return null;
  const k = key.trim().toLowerCase().replace(/-/g, "_");
  if (k in BENEFIT_CATEGORIES) return k as BenefitCategory;
  return ALIASES[k] ?? null;
}

// ---------------------------------------------------------------------------
// Errors

export class NoPlacesKey extends Error {
  readonly code = "no_key";
  constructor() {
    super("GOOGLE_PLACES_KEY is not set");
    this.name = "NoPlacesKey";
  }
}

export class PlacesBudgetExhausted extends Error {
  readonly code = "budget";
  constructor() {
    super("Daily Google Places budget is used up");
    this.name = "PlacesBudgetExhausted";
  }
}

export class PlacesHttpError extends Error {
  readonly code = "upstream";
  constructor(
    readonly status: number,
    readonly googleStatus?: string,
    detail?: string
  ) {
    super(`Google Places returned HTTP ${status}${googleStatus ? ` ${googleStatus}` : ""}${detail ? `: ${detail}` : ""}`);
    this.name = "PlacesHttpError";
  }
}

export class PlacesInputError extends Error {
  constructor(
    readonly code: "bad_category" | "bad_location",
    message: string
  ) {
    super(message);
    this.name = "PlacesInputError";
  }
}

// ---------------------------------------------------------------------------
// Types

export type Detail = "list" | "full";

export type PlaceReview = {
  rating: number | null;
  text: string;
  author: string;
  authorUri: string | null;
  authorPhoto: string | null;
  relativeTime: string;
  flagUri: string | null;
};

export type ReviewSummary = {
  text: string;
  /** "Summarized with Gemini". Must be shown next to the text. */
  disclosure: string;
  flagUri: string | null;
  /** Link to the place's reviews on Google Maps. Must be shown with the summary. */
  reviewsUri: string | null;
};

export type Place = {
  id: string;
  name: string;
  address: string;
  location: LatLng;
  rating: number | null;
  ratingCount: number | null;
  /** As of fetchedAt. Results are cached up to a day, so treat as a hint. */
  openNow: boolean | null;
  hours: string[];
  phone: string | null;
  website: string | null;
  mapsUri: string | null;
  types: string[];
  primaryType: string | null;
  businessStatus: string | null;
  reviewSummary?: ReviewSummary;
  reviews?: PlaceReview[];
  distanceMiles: number | null;
};

export type Attribution = {
  /** Show exactly "Google Maps" (or the logo) near the list. Not localized, not wrapped. */
  text: "Google Maps";
  rules: string[];
};

export type PlacesResult = {
  category: BenefitCategory;
  detail: Detail;
  center: LatLng | null;
  /** How the center was found. */
  centerSource: "latlng" | "geocode" | "results" | "none";
  places: Place[];
  attribution: Attribution;
  cached: boolean;
  fetchedAt: string;
  note?: string;
};

export type SearchInput = {
  category: BenefitCategory | string;
  zip?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  detail?: Detail;
  pageSize?: number;
};

export const ATTRIBUTION: Attribution = {
  text: "Google Maps",
  rules: [
    "Show the Google Maps logo, or the text Google Maps, near the results (Roboto 400, 12 to 16 px, not localized, not wrapped). A visible Google map's own attribution covers this.",
    "Places results drawn on a map must be drawn on a Google map, not another provider's.",
    "A review summary must show its disclosure text (Summarized with Gemini), a link to reviewsUri, and a way to report it via flagUri.",
    "Each review must show the author's name and photo, link the name to authorUri when space allows, show relativeTime, and offer flagUri.",
    "Link each place to mapsUri so people can see the source listing.",
  ],
};

// ---------------------------------------------------------------------------
// Google request

export const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

const PRO_FIELDS = ["id", "displayName", "formattedAddress", "location", "googleMapsUri", "types", "primaryType", "businessStatus"];
const ENTERPRISE_FIELDS = ["rating", "userRatingCount", "currentOpeningHours", "regularOpeningHours", "nationalPhoneNumber", "websiteUri"];
const ATMOSPHERE_FIELDS = ["reviews", "reviewSummary"];

/** The X-Goog-FieldMask for a detail level. */
export function fieldMask(detail: Detail): string {
  const fields = [...PRO_FIELDS, ...ENTERPRISE_FIELDS, ...(detail === "full" ? ATMOSPHERE_FIELDS : [])];
  return fields.map((f) => `places.${f}`).join(",");
}

/** Raw Google place, only the fields we ask for. */
export type GPlace = {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  reviews?: {
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    relativePublishTimeDescription?: string;
    authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
    flagContentUri?: string;
  }[];
  reviewSummary?: {
    text?: { text?: string; languageCode?: string };
    disclosureText?: { text?: string; languageCode?: string };
    flagContentUri?: string;
    reviewsUri?: string;
  };
};

const DAY = 24 * 3600 * 1000;
const DEFAULT_RADIUS = 16_093; // 10 miles
const MAX_REVIEWS = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Convert one Google place to our shape. Returns null for unusable or permanently closed rows. */
export function toPlace(g: GPlace, center: LatLng | null, detail: Detail): Place | null {
  const lat = g.location?.latitude;
  const lng = g.location?.longitude;
  if (!g.id || !g.displayName?.text || !isLatLng(lat, lng)) return null;
  if (g.businessStatus === "CLOSED_PERMANENTLY") return null;
  const location = { lat: lat as number, lng: lng as number };
  const hoursSrc = g.currentOpeningHours ?? g.regularOpeningHours;
  const place: Place = {
    id: g.id,
    name: g.displayName.text,
    address: g.formattedAddress ?? "",
    location,
    rating: typeof g.rating === "number" ? g.rating : null,
    ratingCount: typeof g.userRatingCount === "number" ? g.userRatingCount : null,
    openNow: typeof g.currentOpeningHours?.openNow === "boolean" ? g.currentOpeningHours.openNow : null,
    hours: hoursSrc?.weekdayDescriptions ?? [],
    phone: g.nationalPhoneNumber ?? null,
    website: g.websiteUri ?? null,
    mapsUri: g.googleMapsUri ?? null,
    types: g.types ?? [],
    primaryType: g.primaryType ?? null,
    businessStatus: g.businessStatus ?? null,
    distanceMiles: center ? haversineMiles(center, location) : null,
  };
  if (detail === "full") {
    const s = g.reviewSummary;
    if (s?.text?.text) {
      place.reviewSummary = {
        text: s.text.text,
        disclosure: s.disclosureText?.text ?? "Summarized with Gemini",
        flagUri: s.flagContentUri ?? null,
        reviewsUri: s.reviewsUri ?? g.googleMapsUri ?? null,
      };
    }
    const reviews = (g.reviews ?? [])
      .filter((r) => (r.text?.text ?? r.originalText?.text) && r.authorAttribution?.displayName)
      .slice(0, MAX_REVIEWS)
      .map((r) => ({
        rating: typeof r.rating === "number" ? r.rating : null,
        text: (r.text?.text ?? r.originalText?.text) as string,
        author: r.authorAttribution?.displayName as string,
        authorUri: r.authorAttribution?.uri ?? null,
        authorPhoto: r.authorAttribution?.photoUri ?? null,
        relativeTime: r.relativePublishTimeDescription ?? "",
        flagUri: r.flagContentUri ?? null,
      }));
    if (reviews.length) place.reviews = reviews;
  }
  return place;
}

function stripToList(r: PlacesResult): PlacesResult {
  return {
    ...r,
    detail: "list",
    places: r.places.map(({ reviews: _r, reviewSummary: _s, ...p }) => p),
  };
}

async function callTextSearch(key: string, body: Record<string, unknown>, detail: Detail): Promise<GPlace[]> {
  let res: Response;
  try {
    res = await fetchWithTimeout(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": fieldMask(detail),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PlacesHttpError(504, "TIMEOUT_OR_NETWORK");
  }
  if (!res.ok) {
    let gStatus: string | undefined;
    let detailMsg: string | undefined;
    try {
      const j = (await res.json()) as { error?: { status?: string; message?: string } };
      gStatus = j.error?.status;
      detailMsg = j.error?.message?.slice(0, 200);
    } catch {
      // body not JSON
    }
    throw new PlacesHttpError(res.status, gStatus, detailMsg);
  }
  const j = (await res.json()) as { places?: GPlace[] };
  return j.places ?? [];
}

// ---------------------------------------------------------------------------
// Public entry

/**
 * Search places for a benefit category near a ZIP or a point.
 *
 * Order: validate, telehealth short circuit, cache (a cached result is served
 * even without a key), key check, budget, geocode ZIP, one Text Search call.
 */
export async function searchPlaces(input: SearchInput): Promise<PlacesResult> {
  const r = await search(input);
  return { ...r, places: r.places.filter((p) => fits(r.category, p)) };
}

/**
 * Text Search for "urgent care" also returns ERs and the hospital itself, and
 * pricing an ER at the urgent care copay is wrong. Only the ER and hospital
 * categories keep them. Applied after the cache, so cached rows are filtered too.
 */
const HOSPITAL_TYPES = new Set(["hospital", "general_hospital"]);
function fits(category: BenefitCategory, p: Place): boolean {
  if (category === "er") return true;
  if (/\bemergency (room|department)\b|\bER\b/i.test(p.name)) return false;
  return category === "imaging" || category === "lab" || !HOSPITAL_TYPES.has(p.primaryType ?? "");
}

async function search(input: SearchInput): Promise<PlacesResult> {
  const category = resolveCategory(input.category);
  if (!category) throw new PlacesInputError("bad_category", `Unknown category: ${String(input.category)}`);
  const cfg = BENEFIT_CATEGORIES[category];
  const detail: Detail = input.detail === "list" ? "list" : "full";
  const hasPoint = isLatLng(input.lat, input.lng);
  const zip = isZip(input.zip) ? input.zip : undefined;
  if (!hasPoint && !zip) throw new PlacesInputError("bad_location", "Give a 5 digit ZIP or lat and lng");

  const radius = clamp(Math.round(input.radiusMeters ?? DEFAULT_RADIUS), 500, 50_000);
  const pageSize = clamp(Math.round(input.pageSize ?? 10), 1, 20);
  const point = hasPoint ? { lat: input.lat as number, lng: input.lng as number } : null;

  if (!cfg.searchable) {
    return { category, detail, center: point, centerSource: point ? "latlng" : "none", places: [], attribution: ATTRIBUTION, cached: false, fetchedAt: new Date().toISOString(), note: cfg.note };
  }

  // A point wins over a ZIP; rounded to about 100 m so nearby visitors share a cache row.
  const where = point ? `pt:${point.lat.toFixed(3)},${point.lng.toFixed(3)}` : `zip:${zip}`;
  const keyFor = (d: Detail) => `${category}|${where}|r${radius}|n${pageSize}|${d}`;
  const ttl = envLimit("PLACES_CACHE_HOURS", 24) * 3600 * 1000 || DAY;

  const hit = await cacheGet<PlacesResult>("google-places", keyFor(detail));
  if (hit) return { ...hit, cached: true };
  if (detail === "list") {
    const full = await cacheGet<PlacesResult>("google-places", keyFor("full"));
    if (full) return { ...stripToList(full), cached: true };
  }

  const key = (process.env.GOOGLE_PLACES_KEY || process.env.GOOGLE_MAPS_KEY)?.trim().replace(/^["']|["']$/g, "");
  if (!key) throw new NoPlacesKey();

  let center: LatLng | null = point;
  let centerSource: PlacesResult["centerSource"] = point ? "latlng" : "none";
  if (!center && zip) {
    center = await zipCentroid(zip, key);
    if (center) centerSource = "geocode";
  }

  if (!(await spend("google-places", envLimit("PLACES_DAILY_LIMIT", 250)))) throw new PlacesBudgetExhausted();

  const body: Record<string, unknown> = {
    textQuery: zip && !point ? `${cfg.query} near ${zip}` : cfg.query,
    pageSize,
    languageCode: "en",
    regionCode: "US",
  };
  if (cfg.includedType) body.includedType = cfg.includedType;
  if (center) body.locationBias = { circle: { center: { latitude: center.lat, longitude: center.lng }, radius } };

  const raw = await callTextSearch(key, body, detail);

  if (!center) {
    const pts = raw
      .map((g) => ({ lat: g.location?.latitude, lng: g.location?.longitude }))
      .filter((p): p is LatLng => isLatLng(p.lat, p.lng));
    center = centroid(pts);
    if (center) centerSource = "results";
  }

  const places = raw.map((g) => toPlace(g, center, detail)).filter((p): p is Place => p !== null);
  const result: PlacesResult = { category, detail, center, centerSource, places, attribution: ATTRIBUTION, cached: false, fetchedAt: new Date().toISOString() };
  await cacheSet("google-places", keyFor(detail), result, ttl);
  return result;
}
