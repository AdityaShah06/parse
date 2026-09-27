/**
 * The appeal funnel: how many in-network claims an insurer denied in 2024,
 * how many of those people appealed, and how many appeals the insurer then
 * reversed. From the CMS Transparency in Coverage public use file (plan year
 * 2026 release, 2024 claims), built by scripts/build-denials.mjs.
 *
 * Counts, not dollars, so none of this goes through the engine. Rows missing
 * any of the three counts are left out rather than guessed.
 */

import data from "../../data/denials-2024.json";

type Raw = {
  state: string;
  issuerId: string;
  issuerName: string;
  claimsDeniedInNetwork: number | null;
  internalAppealsFiled: number | null;
  internalAppealsOverturned: number | null;
};

export type Funnel = {
  label: string;
  state: string | null;
  issuerId: string | null;
  denied: number;
  appealed: number;
  won: number;
};

const FILE = data as unknown as { source: string; url: string; claimsYear: number; rows: Raw[] };
export const APPEALS_SOURCE = { name: FILE.source, url: FILE.url, year: FILE.claimsYear };

const ok = (r: Raw) =>
  (r.claimsDeniedInNetwork ?? 0) > 0 && (r.internalAppealsFiled ?? 0) > 0 && r.internalAppealsOverturned !== null && r.internalAppealsOverturned >= 0;

const ROWS = FILE.rows.filter(ok);

const toFunnel = (r: Raw): Funnel => ({
  label: r.issuerName,
  state: r.state,
  issuerId: r.issuerId,
  denied: r.claimsDeniedInNetwork!,
  appealed: r.internalAppealsFiled!,
  won: r.internalAppealsOverturned!,
});

function total(rows: Raw[], label: string, state: string | null): Funnel {
  return rows.reduce<Funnel>(
    (a, r) => ({ ...a, denied: a.denied + r.claimsDeniedInNetwork!, appealed: a.appealed + r.internalAppealsFiled!, won: a.won + r.internalAppealsOverturned! }),
    { label, state, issuerId: null, denied: 0, appealed: 0, won: 0 }
  );
}

/** Every HealthCare.gov issuer with complete counts, summed. */
export const NATIONAL: Funnel = total(ROWS, "All HealthCare.gov insurers", null);

/** Insurers in one state with complete counts, largest first. */
export function insurersIn(state: string): Funnel[] {
  return ROWS.filter((r) => r.state === state)
    .map(toFunnel)
    .sort((a, b) => b.denied - a.denied);
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !["insurance", "company", "health", "plan", "plans", "life", "central", "inc"].includes(w));

/**
 * The funnel for this person's insurer: by plan id when there is one, then by
 * name within the state, else null.
 */
export function funnelFor(hiosId: string | null | undefined, issuer: string | null | undefined, state = "MO"): Funnel | null {
  if (hiosId && hiosId.length >= 7) {
    const row = ROWS.find((r) => r.issuerId === hiosId.slice(0, 5) && r.state === hiosId.slice(5, 7));
    if (row) return toFunnel(row);
  }
  if (issuer) {
    const want = words(issuer);
    const hit = insurersIn(state).find((f) => {
      const have = words(f.label);
      return want.some((w) => have.includes(w) || f.label.toLowerCase().includes(w));
    });
    if (hit) return hit;
  }
  return null;
}

export const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
