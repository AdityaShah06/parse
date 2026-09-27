import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import uh from "./fixtures/places/npi-university-hospital.json";
import boone from "./fixtures/places/npi-boone.json";
import person from "./fixtures/places/npi-individual.json";
import empty from "./fixtures/places/npi-empty.json";
import npiErr from "./fixtures/places/npi-error.json";

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

import {
  addressSimilarity,
  looksLikePerson,
  matchPlaceToNpi,
  nameSimilarity,
  nameTokens,
  normalizeRecord,
  NpiBudgetExhausted,
  NpiHttpError,
  npiSearch,
  npiUrl,
  parseAddress,
  taxonomyFit,
} from "./npi";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;

function route(url: string) {
  const q = new URL(url).searchParams;
  const org = q.get("organization_name") ?? "";
  if (org.toLowerCase().startsWith("university")) return json(uh);
  if (org.toLowerCase().startsWith("boone")) return json(boone);
  if (q.get("last_name") === "Example") return json(person);
  return json(empty);
}

beforeEach(() => {
  mem.cache.clear();
  mem.used.clear();
  delete process.env.NPI_DAILY_LIMIT;
  fetchMock = vi.fn(async (url: string) => route(url));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("normalization", () => {
  it("uses the LOCATION address, the primary taxonomy, other names, and a string NPI", () => {
    const r = normalizeRecord(uh.results[0])!;
    expect(r.npi).toBe("1999999901");
    expect(r.type).toBe("NPI-2");
    expect(r.address).toMatchObject({ line1: "1 HOSPITAL DR", zip5: "65212", city: "COLUMBIA" });
    expect(r.taxonomy).toBe("General Acute Care Hospital");
    expect(r.names).toEqual(["THE CURATORS OF THE UNIVERSITY OF MISSOURI", "UNIVERSITY HOSPITAL"]);
    expect(normalizeRecord(boone.results[0])!.npi).toBe("1999999903");
    const p = normalizeRecord(person.results[0])!;
    expect(p.name).toBe("JANE EXAMPLE");
    expect(p.credential).toBe("M.D.");
  });

  it("builds a v2.1 query URL", () => {
    const u = new URL(npiUrl({ type: "NPI-2", name: "Boone*", zip: "65201", limit: 500 }));
    expect(u.searchParams.get("version")).toBe("2.1");
    expect(u.searchParams.get("enumeration_type")).toBe("NPI-2");
    expect(u.searchParams.get("organization_name")).toBe("Boone*");
    expect(u.searchParams.get("postal_code")).toBe("65201");
    expect(u.searchParams.get("limit")).toBe("200");
  });
});

describe("name and address scoring", () => {
  it("strips suffixes, credentials and filler words", () => {
    expect(nameTokens("Boone Medical Group, LLC")).toEqual(["boone", "medical", "group"]);
    expect(nameTokens("The Curators of the University of Missouri")).toEqual(["curator", "university", "missouri"]);
    expect(nameTokens("St. Mary's Hosp & Clinics, Inc.")).toEqual(["saint", "mary", "hospital", "clinic"]);
  });

  it("scores identical names 1 and unrelated names 0", () => {
    expect(nameSimilarity("Boone Hospital Center", "BOONE HOSPITAL CENTER")).toBe(1);
    expect(nameSimilarity("Boone Hospital Center", "Walgreens")).toBe(0);
    expect(nameSimilarity("CVS Pharmacy", "MISSOURI CVS PHARMACY, L.L.C.")).toBeGreaterThan(0.85);
  });

  it("parses a Google formatted address", () => {
    expect(parseAddress("1600 E Broadway, Columbia, MO 65201, USA")).toEqual({
      number: "1600",
      streetTokens: ["broadway"],
      city: "Columbia",
      state: "MO",
      zip5: "65201",
    });
    expect(parseAddress("Clark Ln, Columbia, MO 65202, USA").number).toBeNull();
  });

  it("weights street number, ZIP and street name", () => {
    const place = parseAddress("1600 E Broadway, Columbia, MO 65201, USA");
    expect(addressSimilarity(place, normalizeRecord(boone.results[0])!.address)).toBe(1);
    expect(addressSimilarity(place, normalizeRecord(boone.results[1])!.address)).toBe(0.5);
  });

  it("fits taxonomy hints loosely", () => {
    expect(taxonomyFit(["Clinic/Center, Radiology"], ["Radiology"])).toBe(1);
    expect(taxonomyFit(["Orthopaedic Surgery, Sports Medicine"], ["Sports Medicine"])).toBe(1);
    expect(taxonomyFit(["Family Medicine"], ["General Acute Care Hospital"])).toBe(0);
  });

  it("detects a person's listing", () => {
    expect(looksLikePerson("Jane Example, MD")).toBe(true);
    expect(looksLikePerson("Dr. Jane Example")).toBe(true);
    expect(looksLikePerson("Boone Hospital Center")).toBe(false);
  });
});

describe("matchPlaceToNpi", () => {
  it("matches a hospital through its DBA name and exact address", async () => {
    const m = await matchPlaceToNpi({ id: "p1", name: "University Hospital", address: "1 Hospital Dr, Columbia, MO 65212, USA" }, "er");
    expect(m).toEqual({ npi: "1999999901", name: "THE CURATORS OF THE UNIVERSITY OF MISSOURI", address: "1 HOSPITAL DR, COLUMBIA, MO 65212", taxonomy: "General Acute Care Hospital", confidence: 1 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("organization_name")).toBe("University*");
    expect(url.searchParams.get("postal_code")).toBe("65212");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prefers the hospital over a neighbor that shares the first word", async () => {
    const m = await matchPlaceToNpi({ name: "Boone Hospital Center", address: "1600 E Broadway, Columbia, MO 65201, USA" }, "er");
    expect(m?.npi).toBe("1999999903");
    expect(m?.confidence).toBe(1);
  });

  it("matches an individual doctor by first and last name", async () => {
    const m = await matchPlaceToNpi({ name: "Jane Example, MD", address: "3400 Berrywood Dr #100, Columbia, MO 65201, USA" }, "orthopedics");
    expect(m?.npi).toBe("1999999905");
    expect(m?.taxonomy).toBe("Orthopaedic Surgery");
    expect(m!.confidence).toBeGreaterThan(0.9);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("enumeration_type")).toBe("NPI-1");
  });

  it("returns null when nothing fits, after trying ZIP then city and state", async () => {
    const m = await matchPlaceToNpi({ name: "Nowhere Clinic", address: "5 Main St, Columbia, MO 65201, USA" }, "urgent");
    expect(m).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("city")).toBe("Columbia");
  });

  it("rejects a same-prefix record with the wrong name and address", async () => {
    const m = await matchPlaceToNpi({ name: "University Urgent Care", address: "900 College Ave, Columbia, MO 65212, USA" }, "urgent");
    expect(m).toBeNull();
  });

  it("caches matches and searches", async () => {
    const p = { id: "p1", name: "University Hospital", address: "1 Hospital Dr, Columbia, MO 65212, USA" };
    await matchPlaceToNpi(p, "er");
    await matchPlaceToNpi(p, "er");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mem.used.get("npi")).toBe(1);
  });
});

describe("npiSearch errors and budget", () => {
  it("throws NpiHttpError on the Errors envelope", async () => {
    fetchMock.mockImplementation(async () => json(npiErr));
    await expect(npiSearch({ type: "NPI-2", zip: "65201" })).rejects.toBeInstanceOf(NpiHttpError);
  });

  it("refuses an empty query without a call", async () => {
    await expect(npiSearch({ type: "any", state: "MO" })).rejects.toBeInstanceOf(NpiHttpError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at the daily budget", async () => {
    process.env.NPI_DAILY_LIMIT = "1";
    await npiSearch({ type: "NPI-2", name: "Boone*", zip: "65201" });
    await expect(npiSearch({ type: "NPI-2", name: "Boone*", zip: "65203" })).rejects.toBeInstanceOf(NpiBudgetExhausted);
    // A cached query costs nothing.
    await expect(npiSearch({ type: "NPI-2", name: "Boone*", zip: "65201" })).resolves.toHaveLength(2);
  });
});
