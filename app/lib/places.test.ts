import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import full from "./fixtures/places/text-search-urgent-full.json";
import err403 from "./fixtures/places/text-search-error-403.json";
import geocode from "./fixtures/places/geocode-65203.json";

// In-memory stand-in for the disk cache and daily budgets.
const mem = vi.hoisted(() => ({ cache: new Map<string, unknown>(), used: new Map<string, number>() }));
vi.mock("./server-cache", () => ({
  cacheGet: async (ns: string, k: string) => mem.cache.get(`${ns}:${k}`),
  cacheSet: async (ns: string, k: string, v: unknown) => void mem.cache.set(`${ns}:${k}`, v),
  cached: async (ns: string, k: string, _t: number, f: () => Promise<unknown>) => {
    const id = `${ns}:${k}`;
    if (mem.cache.has(id)) return mem.cache.get(id);
    const v = await f();
    mem.cache.set(id, v);
    return v;
  },
  spend: async (name: string, limit: number) => {
    const u = mem.used.get(name) ?? 0;
    if (u + 1 > limit) return false;
    mem.used.set(name, u + 1);
    return true;
  },
  envLimit: (name: string, fallback: number) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  },
  fetchWithTimeout: (url: string, init?: RequestInit) => fetch(url, init),
}));

import { BENEFIT_CATEGORIES, fieldMask, NoPlacesKey, PLACES_URL, PlacesBudgetExhausted, PlacesHttpError, PlacesInputError, resolveCategory, searchPlaces } from "./places";
import { haversineMiles } from "./geo";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mem.cache.clear();
  mem.used.clear();
  process.env.GOOGLE_PLACES_KEY = "test-key-not-real";
  delete process.env.PLACES_DAILY_LIMIT;
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith(PLACES_URL)) return json(full);
    if (url.includes("geocode")) return json(geocode);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const placesCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(PLACES_URL));

describe("field masks", () => {
  it("list stays on Enterprise fields, full adds Atmosphere", () => {
    expect(fieldMask("list")).toContain("places.rating");
    expect(fieldMask("list")).toContain("places.nationalPhoneNumber");
    expect(fieldMask("list")).not.toContain("reviews");
    expect(fieldMask("list")).not.toContain("reviewSummary");
    expect(fieldMask("full")).toContain("places.reviews");
    expect(fieldMask("full")).toContain("places.reviewSummary");
    expect(fieldMask("full").split(",").every((f) => f.startsWith("places."))).toBe(true);
  });
});

describe("categories", () => {
  it("resolves keys and the older CareKind names", () => {
    expect(resolveCategory("urgent")).toBe("urgent");
    expect(resolveCategory("physical-therapy")).toBe("physical_therapy");
    expect(resolveCategory("specialist")).toBe("orthopedics");
    expect(resolveCategory("nope")).toBeNull();
  });

  it("only uses includedType values from Places Table A", () => {
    const tableA = new Set(["doctor", "hospital", "dentist", "pharmacy", "physiotherapist", "medical_lab", "medical_clinic", "drugstore", "skin_care_clinic"]);
    for (const c of Object.values(BENEFIT_CATEGORIES)) if (c.includedType) expect(tableA.has(c.includedType)).toBe(true);
  });
});

describe("searchPlaces", () => {
  it("sends one Text Search with the key header, mask and location bias", async () => {
    const r = await searchPlaces({ category: "urgent", zip: "65203", detail: "full" });
    expect(placesCalls()).toHaveLength(1);
    const [, init] = placesCalls()[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key-not-real");
    expect(headers["X-Goog-FieldMask"]).toBe(fieldMask("full"));
    const body = JSON.parse(init.body as string);
    expect(body.textQuery).toBe("urgent care near 65203");
    expect(body.pageSize).toBe(10);
    expect(body.locationBias.circle.center).toEqual({ latitude: 38.9331, longitude: -92.3713 });
    expect(body.locationBias.circle.radius).toBe(16093);
    expect(r.centerSource).toBe("geocode");
    expect(r.cached).toBe(false);
  });

  it("keeps hospitals and ERs out of urgent care results", async () => {
    const r = await searchPlaces({ category: "urgent", zip: "65203" });
    expect(r.places.map((p) => p.id)).toEqual(["ChIJfixtureStadiumUrgent01"]);
  });

  it("maps places, drops closed and unlocated rows, and measures distance", async () => {
    // The ER category keeps hospitals, so both located, open rows come through.
    const r = await searchPlaces({ category: "er", zip: "65203" });
    expect(r.places.map((p) => p.id)).toEqual(["ChIJfixtureStadiumUrgent01", "ChIJfixtureBoone02"]);
    const s = r.places[0];
    expect(s).toMatchObject({ name: "Stadium Urgent Care", rating: 4.4, ratingCount: 528, openNow: true, phone: "(573) 555-0142", primaryType: "medical_clinic" });
    expect(s.hours).toHaveLength(7);
    expect(s.distanceMiles).toBe(haversineMiles(r.center!, s.location));
    expect(s.distanceMiles).toBeGreaterThan(0);
    expect(s.distanceMiles).toBeLessThan(2);
    // Hours fall back to regularOpeningHours; openNow only comes from currentOpeningHours.
    expect(r.places[1].hours).toEqual(["Monday: Open 24 hours"]);
    expect(r.places[1].openNow).toBeNull();
  });

  it("keeps at most three reviews with author attribution, plus the Gemini disclosure", async () => {
    const r = await searchPlaces({ category: "urgent", zip: "65203", detail: "full" });
    const s = r.places[0];
    expect(s.reviews).toHaveLength(3);
    expect(s.reviews![0]).toEqual({
      rating: 5,
      text: "In and out in 40 minutes with an X-ray.",
      author: "Sam R.",
      authorUri: "https://www.google.com/maps/contrib/1",
      authorPhoto: "https://lh3.googleusercontent.com/a/sam",
      relativeTime: "2 weeks ago",
      flagUri: "https://www.google.com/local/review/rap/report?r1",
    });
    expect(s.reviewSummary).toMatchObject({ disclosure: "Summarized with Gemini", text: expect.stringContaining("X-rays") });
    expect(s.reviewSummary!.reviewsUri).toContain("ChIJfixtureStadiumUrgent01");
    expect(r.attribution.text).toBe("Google Maps");
  });

  it("list detail uses the Enterprise mask and returns no reviews", async () => {
    const r = await searchPlaces({ category: "urgent", zip: "65203", detail: "list" });
    expect((placesCalls()[0][1].headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(fieldMask("list"));
    expect(r.places[0].reviews).toBeUndefined();
    expect(r.places[0].reviewSummary).toBeUndefined();
  });

  it("caches per category, place and detail, and serves list from a cached full result", async () => {
    await searchPlaces({ category: "urgent", zip: "65203" });
    const again = await searchPlaces({ category: "urgent", zip: "65203" });
    const list = await searchPlaces({ category: "urgent", zip: "65203", detail: "list" });
    expect(placesCalls()).toHaveLength(1);
    expect(again.cached).toBe(true);
    expect(list.cached).toBe(true);
    expect(list.detail).toBe("list");
    expect(list.places[0].reviews).toBeUndefined();
    await searchPlaces({ category: "er", zip: "65203" });
    expect(placesCalls()).toHaveLength(2);
  });

  it("geocodes a ZIP once and reuses it across categories", async () => {
    await searchPlaces({ category: "urgent", zip: "65203" });
    await searchPlaces({ category: "pharmacy", zip: "65203" });
    const geo = fetchMock.mock.calls.filter(([u]) => String(u).includes("geocode"));
    expect(geo).toHaveLength(1);
    expect(String(geo[0][0])).toContain("postal_code%3A65203");
  });

  it("falls back to the result centroid when geocoding is denied", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("geocode") ? json({ status: "REQUEST_DENIED", results: [] }) : json(full)
    );
    const r = await searchPlaces({ category: "urgent", zip: "65203" });
    expect(r.centerSource).toBe("results");
    const body = JSON.parse(placesCalls()[0][1].body as string);
    expect(body.locationBias).toBeUndefined();
    expect(body.textQuery).toBe("urgent care near 65203");
    expect(r.center!.lat).toBeCloseTo((38.9406 + 38.9492 + 38.95) / 3, 4);
  });

  it("uses lat and lng directly without geocoding", async () => {
    const r = await searchPlaces({ category: "er", lat: 38.95, lng: -92.33, radiusMeters: 99_999 });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("geocode"))).toBe(false);
    const body = JSON.parse(placesCalls()[0][1].body as string);
    expect(body.textQuery).toBe("emergency room");
    expect(body.includedType).toBe("hospital");
    expect(body.locationBias.circle.radius).toBe(50_000);
    expect(r.centerSource).toBe("latlng");
  });

  it("returns telehealth empty with a note and no calls", async () => {
    delete process.env.GOOGLE_PLACES_KEY;
    delete process.env.GOOGLE_MAPS_KEY;
    const r = await searchPlaces({ category: "telehealth", zip: "65203" });
    expect(r.places).toEqual([]);
    expect(r.note).toMatch(/telehealth/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws NoPlacesKey without a key, but still serves a cached result", async () => {
    await searchPlaces({ category: "urgent", zip: "65203" });
    delete process.env.GOOGLE_PLACES_KEY;
    delete process.env.GOOGLE_MAPS_KEY;
    await expect(searchPlaces({ category: "urgent", zip: "65203" })).resolves.toMatchObject({ cached: true });
    await expect(searchPlaces({ category: "dentist", zip: "65203" })).rejects.toBeInstanceOf(NoPlacesKey);
  });

  it("throws PlacesBudgetExhausted when the daily budget is spent", async () => {
    process.env.PLACES_DAILY_LIMIT = "1";
    await searchPlaces({ category: "urgent", zip: "65203" });
    await expect(searchPlaces({ category: "dentist", zip: "65203" })).rejects.toBeInstanceOf(PlacesBudgetExhausted);
    expect(placesCalls()).toHaveLength(1);
  });

  it("throws PlacesHttpError with the status and never includes the key", async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes("geocode") ? json(geocode) : json(err403, 403)));
    const e = await searchPlaces({ category: "urgent", zip: "65203" }).catch((x) => x);
    expect(e).toBeInstanceOf(PlacesHttpError);
    expect(e.status).toBe(403);
    expect(e.googleStatus).toBe("PERMISSION_DENIED");
    expect(String(e.message)).not.toContain("test-key-not-real");
  });

  it("rejects bad input", async () => {
    await expect(searchPlaces({ category: "spa", zip: "65203" })).rejects.toBeInstanceOf(PlacesInputError);
    await expect(searchPlaces({ category: "urgent", zip: "652" })).rejects.toMatchObject({ code: "bad_location" });
  });
});

describe("haversineMiles", () => {
  it("measures a known distance", () => {
    // Columbia MO to St. Louis MO is about 110 to 115 miles in a straight line.
    const d = haversineMiles({ lat: 38.9517, lng: -92.3341 }, { lat: 38.627, lng: -90.1994 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(120);
  });
});
