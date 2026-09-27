/**
 * Local hospital rates from a published price transparency file.
 *
 * data/local-prices.json is written by `node scripts/build-local-prices.mjs`
 * from MU Health Care's standard charges file (and optionally Boone Health's).
 * The repo ships an empty shell so this import never fails; until the script
 * runs, every lookup returns null and the app falls back to lib/prices.ts.
 *
 * Every amount returned here is copied from the hospital's own file.
 */

import raw from "../data/local-prices.json";

export type LocalPayer = {
  payer: string;
  plan: string;
  amount: number | null;
  methodology: string;
  setting?: string;
  percentage?: number;
  algorithm?: string;
  estimated?: number;
};

export type LocalCode = {
  description: string;
  setting: string;
  gross: number | null;
  cash: number | null;
  grossRange?: [number, number];
  cashRange?: [number, number];
  payers: LocalPayer[];
};

export type LocalSource = {
  source: string;
  url: string;
  fetchedAt: string;
  hospital: string;
  lastUpdatedOn?: string;
  codes: Record<string, LocalCode>;
};

export type LocalPriceFile = LocalSource & { extra?: LocalSource[] };

export type LocalRate = {
  amount: number;
  basis: "negotiated" | "cash" | "gross";
  payer?: string;
  plan?: string;
  hospital: string;
  source: string;
  /** Set when the amount is the file's percentage of billed charges times its gross charge. */
  derivedFromPercent?: boolean;
};

const LOCAL = raw as unknown as LocalPriceFile;

/** Other names a payer goes by in Missouri price files. Keys are normalized hints. */
const PAYER_ALIASES: Record<string, string[]> = {
  unitedhealthcare: ["unitedhealthcare", "unitedhealth", "united healthcare", "uhc", "united"],
  // Anthem is the Blue Cross plan for most of Missouri, but Blue KC is a separate
  // Blue Cross company, so "Anthem" matches only Anthem rows.
  anthem: ["anthem"],
  bluecross: ["blue cross", "bcbs", "anthem"],
  bcbs: ["blue cross", "bcbs", "anthem"],
  medica: ["medica"],
  cigna: ["cigna"],
  aetna: ["aetna"],
  ambetter: ["ambetter", "home state health", "centene"],
  centene: ["ambetter", "home state health", "centene"],
  humana: ["humana"],
  oscar: ["oscar"],
  essence: ["essence"],
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function hintNeedles(hint: string): string[] {
  const key = squash(hint);
  const direct = PAYER_ALIASES[key];
  if (direct) return direct.map(squash);
  // A hint that is itself an alias, like "UHC" or "United Healthcare".
  for (const [k, list] of Object.entries(PAYER_ALIASES)) {
    if (list.some((a) => squash(a) === key)) return PAYER_ALIASES[k].map(squash);
  }
  // A hint like "UnitedHealthcare of the Midwest" or "Anthem Blue Cross" still matches.
  for (const [k, list] of Object.entries(PAYER_ALIASES)) {
    if (key.includes(k)) return list.map(squash);
  }
  return [key];
}

/** Accepts "99213", "a0427", "343", "DRG 343", "MS-DRG 343", "MS-DRG:343". */
export function normalizeCode(code: string): string {
  const c = code.trim().toUpperCase();
  const drg = c.match(/^(?:MS-?DRG|DRG)[\s:-]*0*(\d{1,3})$/);
  if (drg) return `MS-DRG:${Number(drg[1])}`;
  if (/^\d{3}$/.test(c)) return `MS-DRG:${Number(c)}`;
  return c;
}

function median<T>(items: T[], value: (t: T) => number): T {
  const sorted = [...items].sort((a, b) => value(a) - value(b));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function fromSource(src: LocalSource, key: string, payerHint?: string): LocalRate | null {
  const entry = src.codes?.[key];
  if (!entry) return null;
  const base = { hospital: src.hospital, source: src.source };

  if (payerHint && payerHint.trim()) {
    const needles = hintNeedles(payerHint);
    const matches = entry.payers.filter((p) => {
      const hay = squash(`${p.payer} ${p.plan}`);
      return needles.some((n) => n && hay.includes(n));
    });
    const dollars = matches.filter((p) => typeof p.amount === "number" && p.amount > 0);
    if (dollars.length) {
      const m = median(dollars, (p) => p.amount as number);
      return { ...base, amount: m.amount as number, basis: "negotiated", payer: m.payer, plan: m.plan };
    }
    // Percent of billed charges is a dollar figure once multiplied by the file's own gross charge.
    const pct = matches.filter(
      (p) => typeof p.percentage === "number" && /percent of total billed charges/i.test(p.methodology)
    );
    if (pct.length && entry.gross) {
      const m = median(pct, (p) => p.percentage as number);
      return {
        ...base,
        amount: Math.round(((entry.gross * (m.percentage as number)) / 100) * 100) / 100,
        basis: "negotiated",
        payer: m.payer,
        plan: m.plan,
        derivedFromPercent: true,
      };
    }
  }
  if (typeof entry.cash === "number" && entry.cash > 0) return { ...base, amount: entry.cash, basis: "cash" };
  if (typeof entry.gross === "number" && entry.gross > 0) return { ...base, amount: entry.gross, basis: "gross" };
  return null;
}

/**
 * Look up a code in a price file. With a payer hint, returns that payer's
 * negotiated rate (the median across its plans when several match). Without
 * a hint, or when the payer has no dollar rate, falls back to the hospital's
 * discounted cash price, then its gross charge. Searches the primary hospital
 * first, then any extra hospitals, and only returns a fallback basis when no
 * hospital has a negotiated match.
 */
export function lookupRate(file: LocalPriceFile, code: string, payerHint?: string): LocalRate | null {
  const key = normalizeCode(code);
  const sources = [file, ...(file.extra ?? [])];
  const found = sources.map((s) => fromSource(s, key, payerHint)).filter((r): r is LocalRate => r !== null);
  if (!found.length) return null;
  return found.find((r) => r.basis === "negotiated") ?? found.find((r) => r.basis === "cash") ?? found[0];
}

/** True once the build script has written real data. */
export const HAS_LOCAL_PRICES = Object.keys(LOCAL.codes ?? {}).length > 0;

/** The shipped data file: MU Health Care, plus Boone Health if the script ran with --boone. */
export function localRate(code: string, payerHint?: string): LocalRate | null {
  return lookupRate(LOCAL, code, payerHint);
}

/** Where the local data came from, for a footnote. Null until the script has run. */
export const LOCAL_PRICES_META = HAS_LOCAL_PRICES
  ? { hospital: LOCAL.hospital, source: LOCAL.source, url: LOCAL.url, fetchedAt: LOCAL.fetchedAt, lastUpdatedOn: LOCAL.lastUpdatedOn }
  : null;
