/**
 * In-network claim denial rates for every HealthCare.gov issuer, 2024 claims,
 * computed by scripts/build-denials.mjs from the CMS Transparency in Coverage
 * public use file (plan year 2026 release). Keyed by state and the 5-digit
 * HIOS issuer id, which is the first five characters of every plan id.
 */

import data from "../../data/denials-2024.slim.json";

export type DenialRow = {
  state: string;
  issuerId: string;
  issuerName: string;
  denialRatePct: number | null;
  overturnRatePct: number | null;
  claimsReceivedInNetwork: number | null;
};

const ROWS = (data as { rows: DenialRow[] }).rows;
export const DENIALS_SOURCE = { name: `${(data as { source: string }).source}`, url: (data as { url: string }).url, year: (data as { claimsYear: number }).claimsYear };

/** National middle of the 2024 figures, for comparison lines. */
export const DENIAL_MEDIAN = (() => {
  const xs = ROWS.map((r) => r.denialRatePct).filter((x): x is number => typeof x === "number" && x > 0).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : 19;
})();

/** Denial row for a plan id (e.g. "95426MO0410013") or an issuer id plus state. */
export function denialFor(planOrIssuerId: string | null | undefined, state?: string | null): DenialRow | null {
  if (!planOrIssuerId) return null;
  const issuer = planOrIssuerId.slice(0, 5);
  const st = state ?? (planOrIssuerId.length >= 7 ? planOrIssuerId.slice(5, 7) : null);
  const row = ROWS.find((r) => r.issuerId === issuer && (!st || r.state === st));
  // Tiny issuers can report too few claims for a meaningful rate.
  if (!row || row.denialRatePct === null || (row.claimsReceivedInNetwork ?? 0) < 1000) return null;
  return row;
}
