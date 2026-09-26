/**
 * Probe the CMS Marketplace API with your key and cache the responses.
 *
 *   node scripts/marketplace-probe.mjs
 *
 * Reads CMS_MARKETPLACE_API_KEY from app/.env.local. Writes raw JSON into
 * app/data/marketplace-cache/ so the demo can run with the wifi off, and prints
 * the top-level keys of each response so you can see the real shape before
 * writing any code against it.
 *
 * The key is passed as an apikey query parameter. Keys are rate limited, so this
 * makes three calls, not a loop.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const cacheDir = join(appDir, "data", "marketplace-cache");

const BASE = "https://marketplace.api.healthcare.gov/api/v1";

// Columbia, Missouri. Boone County is FIPS 29019, Rating Area 5.
const PLACE = { zipcode: "65201", countyfips: "29019", state: "MO" };
const YEAR = 2026;

function readKey() {
  const fromEnv = process.env.CMS_MARKETPLACE_API_KEY;
  if (fromEnv) return fromEnv.trim();
  try {
    const text = readFileSync(join(appDir, ".env.local"), "utf8");
    const line = text.split(/\r?\n/).find((l) => l.startsWith("CMS_MARKETPLACE_API_KEY="));
    if (line) return line.slice("CMS_MARKETPLACE_API_KEY=".length).trim();
  } catch {
    // fall through to the error below
  }
  console.error("No key found. Put CMS_MARKETPLACE_API_KEY=... in app/.env.local");
  process.exit(1);
}

const KEY = readKey();

async function call(name, path, body) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${KEY}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const limit = res.headers.get("x-ratelimit-remaining");
  const text = await res.text();

  if (!res.ok) {
    console.error(`${name}: HTTP ${res.status}`);
    console.error(text.slice(0, 600));
    return null;
  }

  const json = JSON.parse(text);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, `${name}.json`), JSON.stringify(json, null, 2));
  console.log(`${name}: ok, keys [${Object.keys(json).join(", ")}]${limit ? `, ${limit} calls left` : ""}`);
  return json;
}

// 1. Does the zip resolve to the county we think it does?
await call("counties", `/counties/by/zip/${PLACE.zipcode}?year=${YEAR}`);

// 2. Plans for a 21-year-old who cannot get a tax credit (on a parent's plan or
//    over the income line), which is the list price our JSON already holds.
const household = (income, aptc) => ({
  household: {
    income,
    people: [{ age: 21, aptc_eligible: aptc, gender: "Male", uses_tobacco: false }],
  },
  market: "Individual",
  place: PLACE,
  year: YEAR,
  limit: 10,
  offset: 0,
});

const listPrice = await call("plans-age21-no-credit", "/plans/search", household(60000, false));

// 3. The same person at an income where the tax credit bites. This is the number
//    a real 21-year-old would pay, and our current JSON does not have it.
await call("plans-age21-with-credit", "/plans/search", household(24000, true));

if (listPrice?.plans?.length) {
  const p = listPrice.plans[0];
  console.log("\nFirst plan, fields worth reading:");
  console.log(JSON.stringify(p, null, 2).slice(0, 1800));
}
