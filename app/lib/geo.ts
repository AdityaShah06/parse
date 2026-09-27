/**
 * ZIP centroids and distance math for Find care.
 *
 * A ZIP becomes a point through the Geocoding API (Essentials SKU, 10k free
 * requests a month), cached per ZIP for 30 days. Thirty days is the longest
 * Google's service terms let us keep a latitude and longitude, and one call
 * per ZIP per month is effectively free. If the Geocoding API is not enabled
 * on the key, or its budget is spent, zipCentroid returns null and the caller
 * falls back to putting the ZIP in the Text Search query and taking the
 * center from the results.
 *
 * Server only. The key never appears in a log line or an error message.
 */

import { cacheGet, cacheSet, envLimit, fetchWithTimeout, spend } from "./server-cache";

export type LatLng = { lat: number; lng: number };

const EARTH_MILES = 3958.7613;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great circle distance in miles, rounded to 0.1. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const miles = 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(miles * 10) / 10;
}

/** Mean of a set of points, or null when empty. Fine at city scale. */
export function centroid(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

export const isZip = (z: unknown): z is string => typeof z === "string" && /^\d{5}$/.test(z);

export const isLatLng = (lat: unknown, lng: unknown) =>
  typeof lat === "number" &&
  typeof lng === "number" &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const THIRTY_DAYS = 30 * 24 * 3600 * 1000;
const ONE_HOUR = 3600 * 1000;

type GeocodeCache = { ok: true; center: LatLng } | { ok: false; reason: string };

/**
 * Center of a US ZIP, or null when geocoding is unavailable. Never throws.
 * A denial (API not enabled) is remembered for an hour so we do not retry it
 * on every request.
 */
export async function zipCentroid(zip: string, key: string): Promise<LatLng | null> {
  if (!isZip(zip)) return null;
  const hit = await cacheGet<GeocodeCache>("geocode-zip", zip);
  if (hit) return hit.ok ? hit.center : null;
  if (!(await spend("google-geocode", envLimit("GEOCODE_DAILY_LIMIT", 250)))) return null;

  const url = `${GEOCODE_URL}?components=${encodeURIComponent(`postal_code:${zip}|country:US`)}&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) {
      await cacheSet("geocode-zip", zip, { ok: false, reason: `http ${res.status}` }, ONE_HOUR);
      return null;
    }
    const j = (await res.json()) as {
      status?: string;
      results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
    };
    const loc = j.results?.[0]?.geometry?.location;
    if (j.status === "OK" && loc && isLatLng(loc.lat, loc.lng)) {
      const center = { lat: loc.lat as number, lng: loc.lng as number };
      await cacheSet("geocode-zip", zip, { ok: true, center }, THIRTY_DAYS);
      return center;
    }
    // ZERO_RESULTS is a fact about the ZIP; REQUEST_DENIED and friends are about the key.
    await cacheSet("geocode-zip", zip, { ok: false, reason: j.status ?? "unknown" }, j.status === "ZERO_RESULTS" ? THIRTY_DAYS : ONE_HOUR);
    return null;
  } catch {
    return null;
  }
}
