/**
 * Is this place in my plan's network? Match each place (usually from Google)
 * to a provider in the CMS directory near the ZIP, then ask CMS whether that
 * NPI is covered by the plan. Server only.
 */

import { bestMatch, formatAddress, providersCovered, providersSearch, type Coverage } from "./marketplace";

export type PlaceIn = { id: string; name: string; address?: string; zip?: string; kind?: "Individual" | "Facility" };
export type NetworkResult = {
  id: string;
  coverage: Coverage | "NoMatch";
  npi?: string;
  matchedName?: string;
  matchedAddress?: string;
  confidence: number;
  accepting?: string | null;
};

export const NETWORK_SOURCE = "CMS Marketplace provider directory (built from each insurer's own machine-readable directory)";

/** Search words for a place name: drop generic words that would match every clinic. */
export function nameQuery(name: string) {
  const words = name
    .replace(/[^\w\s&'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(the|of|and|llc|inc|pc|md|do|dr|np|pa|aprn|dds|od|phd|lpc|lcsw|facs|clinic|center|centre|health|medical|care)$/i.test(w));
  return (words.slice(0, 3).join(" ") || name).slice(0, 60);
}

/** A second, looser search: the most distinctive single word (a surname or a practice name). */
function fallbackQuery(name: string) {
  const words = nameQuery(name).split(" ").filter((w) => w.length >= 4 && !/^(family|primary|urgent|associates|group|partners|practice|medicine|services)$/i.test(w));
  return words.sort((a, b) => b.length - a.length)[0] ?? null;
}

export async function checkPlaces(planId: string, zip: string, places: PlaceIn[]): Promise<NetworkResult[]> {
  const matches = await Promise.all(
    places.slice(0, 12).map(async (p) => {
      const where = p.zip && /^\d{5}$/.test(p.zip) ? p.zip : zip;
      const search = async (q: string | null) => {
        if (!q || q.length < 3) return null;
        const found = (await providersSearch({ zip: where, q, type: p.kind ?? "Individual,Facility" }).catch(() => [])).filter((f) => f.distance === null || f.distance <= 30);
        // 0.5, not the default 0.4: a wrong "in network" is worse than "not in the directory".
        return bestMatch({ name: p.name, address: p.address ?? null }, found.map((f) => ({ ...f, address: formatAddress(f.address) })), 0.5);
      };
      const best = (await search(nameQuery(p.name))) ?? (await search(fallbackQuery(p.name)));
      return { place: p, match: best };
    })
  );
  const npis = [...new Set(matches.map((m) => m.match?.candidate.npi).filter((x): x is string => !!x))];
  const coverage = npis.length ? await providersCovered(npis, [planId]) : [];
  const byNpi = new Map(coverage.map((c) => [c.npi, c]));
  return matches.map(({ place, match }) => {
    if (!match) return { id: place.id, coverage: "NoMatch" as const, confidence: 0 };
    const c = byNpi.get(match.candidate.npi);
    return {
      id: place.id,
      npi: match.candidate.npi,
      matchedName: match.candidate.name,
      matchedAddress: match.candidate.address ?? undefined,
      confidence: Math.round(match.score * 100) / 100,
      coverage: (c?.coverage ?? "DataNotProvided") as Coverage,
      accepting: c?.accepting ?? match.candidate.accepting ?? null,
    };
  });
}
