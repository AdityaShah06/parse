#!/usr/bin/env node
/**
 * Pings every outside service the app uses and saves small response samples
 * so the parsers can be checked against real data.
 *
 *   node scripts/check-apis.mjs
 *
 * Reads keys from .env.local. Never prints or saves a key. Uses about a dozen
 * requests in total: 6 CMS, 1 Google Places (only if a key is set), 1
 * ElevenLabs account check (costs no credits), and a few free public APIs.
 *
 * Writes data/api-samples/*.json and prints a status table.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "api-samples");
mkdirSync(OUT, { recursive: true });

const env = {};
const envFile = join(ROOT, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
const KEYS = Object.values(env).filter((v) => v && v.length > 8);
const scrub = (s) => KEYS.reduce((acc, k) => acc.split(k).join("<key>"), String(s));

const rows = [];
function trim(x, depth = 0) {
  if (Array.isArray(x)) return x.slice(0, 3).map((v) => trim(v, depth + 1));
  if (x && typeof x === "object") {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = depth > 6 ? "..." : trim(v, depth + 1);
    return o;
  }
  return x;
}
async function call(name, url, init = {}, { save = true } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    rows.push({ name, status: res.status, ms: Date.now() - t0, note: res.ok ? "" : scrub(text.slice(0, 160)) });
    if (save) writeFileSync(join(OUT, `${name}.json`), scrub(JSON.stringify(json ? trim(json) : { raw: text.slice(0, 2000) }, null, 2)));
    return res.ok ? json : null;
  } catch (e) {
    rows.push({ name, status: "ERR", ms: Date.now() - t0, note: scrub(e.message) });
    return null;
  }
}

const CMS = "https://marketplace.api.healthcare.gov/api/v1";
const ck = env.CMS_MARKETPLACE_KEY;
if (ck) {
  const k = `apikey=${encodeURIComponent(ck)}`;
  const counties = await call("cms-counties", `${CMS}/counties/by/zip/65201?${k}`);
  const c = counties?.counties?.[0];
  let planId = null;
  if (c) {
    const plans = await call("cms-plans-search", `${CMS}/plans/search?${k}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        household: { income: 24000, people: [{ age: 21, aptc_eligible: true, gender: "Female", uses_tobacco: false }] },
        market: "Individual",
        place: { countyfips: c.fips, state: c.state, zipcode: "65201" },
        year: 2026,
      }),
    });
    planId = plans?.plans?.[0]?.id ?? null;
    if (plans?.plans?.[0]) writeFileSync(join(OUT, "cms-plan-full.json"), JSON.stringify(plans.plans[0], null, 2));
  }
  const prov = await call("cms-providers-search", `${CMS}/providers/search?${k}&q=${encodeURIComponent("Boone Hospital")}&zipcode=65201&type=Facility`);
  const npi = prov?.providers?.[0]?.provider?.npi ?? prov?.providers?.[0]?.npi;
  await call("cms-providers-search-doctor", `${CMS}/providers/search?${k}&q=${encodeURIComponent("family medicine")}&zipcode=65201&type=Individual`);
  if (npi && planId) await call("cms-providers-covered", `${CMS}/providers/covered?${k}&providerids=${npi}&planids=${planId}&year=2026`);
  const drugs = await call("cms-drugs-autocomplete", `${CMS}/drugs/autocomplete?${k}&q=atorvastatin`);
  const rx = drugs?.[0]?.rxcui ?? drugs?.drugs?.[0]?.rxcui;
  if (rx && planId) await call("cms-drugs-covered", `${CMS}/drugs/covered?${k}&drugs=${rx}&planids=${planId}&year=2026`);
} else rows.push({ name: "cms", status: "no key", ms: 0, note: "CMS_MARKETPLACE_KEY missing" });

const gk = env.GOOGLE_PLACES_KEY || env.GOOGLE_MAPS_KEY;
if (gk) {
  await call("google-places-textsearch", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": gk,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.reviewSummary,places.googleMapsUri",
    },
    body: JSON.stringify({ textQuery: "urgent care near 65201", pageSize: 3 }),
  });
} else rows.push({ name: "google-places", status: "no key", ms: 0, note: "GOOGLE_MAPS_KEY missing" });

const ek = env.ELEVENLABS_API_KEY;
if (ek) {
  const sub = await call("elevenlabs-subscription", "https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": ek } }, { save: false });
  if (sub) rows.push({ name: "elevenlabs-credits", status: 200, ms: 0, note: `${sub.character_count} of ${sub.character_limit} used this period (${sub.tier})` });
}

await call("rxnav-drugs", "https://rxnav.nlm.nih.gov/REST/drugs.json?name=sertraline");
await call("costplus", "https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main?brand_name=zoloft&generic_equivalent_ok=true&quantity_units=30");
await call("nadac", "https://data.medicaid.gov/api/1/datastore/query/fbb83258-11c7-47f5-8b18-5f8e79f7e704/0?conditions[0][property]=ndc_description&conditions[0][value]=%25SERTRALINE%2050%25&conditions[0][operator]=like&limit=2");
await call("npi-registry", "https://npiregistry.cms.hhs.gov/api/?version=2.1&organization_name=boone*&postal_code=65201&limit=3");

console.log("\nservice                          status   ms   note");
for (const r of rows) console.log(`${r.name.padEnd(32)} ${String(r.status).padEnd(8)} ${String(r.ms).padStart(5)}  ${r.note}`);
writeFileSync(join(OUT, "_status.json"), JSON.stringify(rows, null, 2));
console.log(`\nSamples saved in data/api-samples (keys removed).`);
