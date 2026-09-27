/**
 * Insurer scoring and plan ranking.
 *
 * Deterministic and transparent: every factor is normalized against a fixed,
 * published anchor (not against the other insurers in our short list), so an
 * insurer's score does not change when another insurer is added. The anchors
 * are piecewise linear through three points: best, typical, worst. The
 * published average always lands at 0.5, so a score of 50 means "about
 * average on the factors we have data for".
 *
 * Missing factors are dropped and the remaining weights renormalized. The
 * output reports `coverage`, the share of the total weight that had data, so
 * the interface can say how much evidence backs a grade.
 *
 * Dollar figures for plans come from lib/engine.ts via the caller. This file
 * never computes a cost.
 */

import {
  BENCHMARKS,
  findInsurer,
  type Insurer,
  type InsurerFactors,
  type Sourced,
} from "./kb/insurers";

/* ------------------------------------------------------------------ */
/* Factors, anchors and default weights                                */
/* ------------------------------------------------------------------ */

export type FactorKey =
  | "denialRate"
  | "complaintIndexMO"
  | "qrsOverall"
  | "ncqa"
  | "priorAuthDenial"
  | "mlrRebateMO"
  | "networkBreadth";

export type Weights = Record<FactorKey, number>;

/**
 * Default weights (sum 100).
 *
 * - Claim denials 30: the most direct measure of "will they pay".
 * - Complaints 20: what Missouri members actually report to the regulator.
 * - Quality 20: CMS QRS stars 12 (marketplace) plus NCQA 8 (commercial).
 * - Prior authorization denials 15: friction before care happens.
 * - Network breadth 10: how many local doctors you can see.
 * - MLR rebate (value) 5: a weak signal that premiums ran ahead of care.
 */
export const DEFAULT_WEIGHTS: Weights = {
  denialRate: 30,
  complaintIndexMO: 20,
  qrsOverall: 12,
  ncqa: 8,
  priorAuthDenial: 15,
  networkBreadth: 10,
  mlrRebateMO: 5,
};

type Anchor = {
  better: "lower" | "higher";
  /** Value that scores 1 (lower is better) or 0 (higher is better). */
  lo: number;
  /** Published typical value; scores 0.5. */
  mid: number;
  /** Value that scores 0 (lower is better) or 1 (higher is better). */
  hi: number;
  why: string;
};

/** Normalization anchors. Each one says where its numbers come from. */
export const ANCHORS: Record<Exclude<FactorKey, "mlrRebateMO">, Anchor> = {
  denialRate: {
    better: "lower",
    lo: 3,
    mid: 19,
    hi: 36,
    why: "KFF 2024 marketplace issuers: range 3% to 36%, average 19%.",
  },
  complaintIndexMO: {
    better: "lower",
    lo: 0,
    mid: 100,
    hi: 300,
    why: "Missouri DCI index: 100 is average by construction; 300 (three times the expected complaints) scores zero.",
  },
  qrsOverall: {
    better: "higher",
    lo: 1,
    mid: 3,
    hi: 5,
    why: "CMS QRS stars run 1 to 5; 3 is the midpoint.",
  },
  ncqa: {
    better: "higher",
    lo: 0,
    mid: 3,
    hi: 5,
    why: "NCQA ratings run 0 to 5 in half steps; 3 treated as typical.",
  },
  priorAuthDenial: {
    better: "lower",
    lo: 0,
    mid: 18,
    hi: 36,
    why: "KFF 2025 marketplace average 18% (standard requests); 0% and double the average as the ends. Ends are our choice, not published.",
  },
  networkBreadth: {
    better: "higher",
    lo: 0,
    mid: 40,
    hi: 100,
    why: "KFF 2021: marketplace enrollees could see 40% of local physicians on average; 100% is every doctor.",
  },
};

/**
 * MLR rebate is scored as a flag, not by size, because the dollar amount
 * scales with how many people an issuer covers. Owing any rebate means the
 * issuer spent under 80% of individual-market premiums on care: 0.25. A
 * confirmed $0 rebate means it met the floor: 0.5 (neutral, not a reward).
 */
export const MLR_OWED_SCORE = 0.25;
export const MLR_NONE_SCORE = 0.5;

export const FACTOR_LABELS: Record<FactorKey, string> = {
  denialRate: "In-network claims denied",
  complaintIndexMO: "Missouri complaint index",
  qrsOverall: "CMS quality stars",
  ncqa: "NCQA rating",
  priorAuthDenial: "Prior authorization denials",
  mlrRebateMO: "Premium rebate owed (Missouri)",
  networkBreadth: "Doctors in network",
};

const ORDER: FactorKey[] = [
  "denialRate",
  "complaintIndexMO",
  "qrsOverall",
  "ncqa",
  "priorAuthDenial",
  "networkBreadth",
  "mlrRebateMO",
];

/** Piecewise linear through (lo, mid, hi), clamped to 0..1, 1 = best. */
export function normalize(value: number, a: Anchor): number {
  let up: number; // 0 at lo, 0.5 at mid, 1 at hi
  if (value <= a.mid) up = a.mid === a.lo ? 0.5 : (0.5 * (value - a.lo)) / (a.mid - a.lo);
  else up = a.hi === a.mid ? 0.5 : 0.5 + (0.5 * (value - a.mid)) / (a.hi - a.mid);
  up = Math.min(1, Math.max(0, up));
  return a.better === "higher" ? up : 1 - up;
}

export function normalizeFactor(key: FactorKey, value: number): number {
  if (key === "mlrRebateMO") return value > 0 ? MLR_OWED_SCORE : MLR_NONE_SCORE;
  return normalize(value, ANCHORS[key]);
}

/* ------------------------------------------------------------------ */
/* Display strings                                                     */
/* ------------------------------------------------------------------ */

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

export function formatDollars(n: number): string {
  if (n >= 1_000_000) return `$${trimNum(Math.round(n / 100_000) / 10)} million`;
  if (n >= 1_000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${trimNum(n)}`;
}

function display(key: FactorKey, v: number): string {
  switch (key) {
    case "denialRate":
    case "priorAuthDenial":
    case "networkBreadth":
      return `${trimNum(v)}%`;
    case "complaintIndexMO":
      return `${trimNum(v)} (100 is average)`;
    case "qrsOverall":
    case "ncqa":
      return `${trimNum(v)} of 5`;
    case "mlrRebateMO":
      return v > 0 ? formatDollars(v) : "None owed";
  }
}

const scopeWord = (s: Sourced<number | null>) =>
  s.scope === "parent-national" ? " (parent company, nationwide)" : "";

/** Plain-English pro or con for a factor, or null when it is near average. */
function sentence(
  key: FactorKey,
  s: Sourced<number | null>,
  norm: number,
): { kind: "pro" | "con"; text: string } | null {
  const v = s.value as number;
  const good = norm >= 0.6;
  const bad = norm <= 0.4;
  if (key === "mlrRebateMO") {
    if (v <= 0) return null;
    return {
      kind: "con",
      text: `Spent less than 80% of Missouri premiums on care in ${s.year}, so it owed members ${formatDollars(v)} back`,
    };
  }
  if (!good && !bad) return null;
  const tail = scopeWord(s);
  switch (key) {
    case "denialRate": {
      const avg = BENCHMARKS.denialNationalAvg.value as number;
      return good
        ? { kind: "pro", text: `Denies fewer claims than most: ${trimNum(v)}% vs ${avg}% national average${tail}` }
        : { kind: "con", text: `Denies more claims than most: ${trimNum(v)}% vs ${avg}% national average${tail}` };
    }
    case "complaintIndexMO": {
      const ratio = v / 100;
      return good
        ? {
            kind: "pro",
            text: `Fewer complaints to Missouri regulators than its size predicts: index ${trimNum(v)}, where 100 is average`,
          }
        : {
            kind: "con",
            text: `More complaints to Missouri regulators than its size predicts: index ${trimNum(v)}, about ${trimNum(Math.round(ratio * 10) / 10)} times average`,
          };
    }
    case "qrsOverall":
      return good
        ? { kind: "pro", text: `CMS rates its marketplace quality ${trimNum(v)} of 5 stars for ${s.year}` }
        : { kind: "con", text: `CMS rates its marketplace quality only ${trimNum(v)} of 5 stars for ${s.year}` };
    case "ncqa":
      return good
        ? { kind: "pro", text: `NCQA rates its commercial plans ${trimNum(v)} of 5` }
        : { kind: "con", text: `NCQA rates its commercial plans only ${trimNum(v)} of 5` };
    case "priorAuthDenial": {
      const avg = BENCHMARKS.priorAuthMarketplaceAvg.value as number;
      return good
        ? { kind: "pro", text: `Turns down fewer prior authorization requests: ${trimNum(v)}% vs ${avg}% marketplace average${tail}` }
        : { kind: "con", text: `Turns down more prior authorization requests: ${trimNum(v)}% vs ${avg}% marketplace average${tail}` };
    }
    case "networkBreadth": {
      const avg = BENCHMARKS.networkMarketplaceAvg.value as number;
      return good
        ? { kind: "pro", text: `Wider doctor networks: ${trimNum(v)}% of local doctors vs ${avg}% marketplace average${tail}` }
        : { kind: "con", text: `Narrower doctor networks: ${trimNum(v)}% of local doctors vs ${avg}% marketplace average${tail}` };
    }
  }
}

/* ------------------------------------------------------------------ */
/* scoreInsurer                                                        */
/* ------------------------------------------------------------------ */

export type FactorResult = {
  key: FactorKey;
  label: string;
  value: number | null;
  display: string;
  better: "lower" | "higher";
  /** 0..1, 1 = best. 0 when missing (and then it carries no weight). */
  normalized: number;
  /** Weight as given (before renormalization). */
  weight: number;
  /** Share of the final score this factor carried, 0..1. */
  effectiveWeight: number;
  source: Sourced<number | null>;
  missing: boolean;
};

export type Grade = "A" | "B" | "C" | "D" | "F";

export type InsurerScore = {
  insurerId: string;
  name: string;
  /** 0..100, or null when no weighted factor had data. */
  score: number | null;
  grade: Grade | null;
  factors: FactorResult[];
  pros: string[];
  cons: string[];
  /** Share of the total weight backed by data, 0..1. */
  coverage: number;
  /** Plain words for the interface, e.g. "Based on 4 of 7 measures (80% of the weight)". */
  coverageNote: string;
};

export function gradeFor(score: number): Grade {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

export function scoreInsurer(insurer: Insurer, weights: Partial<Weights> = {}): InsurerScore {
  const w: Weights = { ...DEFAULT_WEIGHTS, ...weights };
  const totalWeight = ORDER.reduce((sum, k) => sum + Math.max(0, w[k]), 0);

  const rows: FactorResult[] = ORDER.map((key) => {
    const source = insurer.factors[key as keyof InsurerFactors] as Sourced<number | null>;
    const value = typeof source.value === "number" && Number.isFinite(source.value) ? source.value : null;
    const missing = value === null;
    const better = key === "mlrRebateMO" ? "lower" : ANCHORS[key].better;
    return {
      key,
      label: FACTOR_LABELS[key],
      value,
      display: missing ? "No data" : display(key, value),
      better,
      normalized: missing ? 0 : normalizeFactor(key, value),
      weight: Math.max(0, w[key]),
      effectiveWeight: 0,
      source,
      missing,
    };
  });

  const present = rows.filter((r) => !r.missing && r.weight > 0);
  const presentWeight = present.reduce((s, r) => s + r.weight, 0);
  for (const r of present) r.effectiveWeight = r.weight / presentWeight;

  const score =
    presentWeight > 0
      ? Math.round(present.reduce((s, r) => s + r.normalized * r.effectiveWeight, 0) * 1000) / 10
      : null;
  const coverage = totalWeight > 0 ? presentWeight / totalWeight : 0;

  const pros: string[] = [];
  const cons: string[] = [];
  // Heaviest factors first so the lead pro or con is the one that moved the score most.
  for (const r of [...present].sort((a, b) => b.weight - a.weight)) {
    const s = sentence(r.key, r.source, r.normalized);
    if (!s) continue;
    (s.kind === "pro" ? pros : cons).push(s.text);
  }

  const withData = rows.filter((r) => !r.missing).length;
  return {
    insurerId: insurer.id,
    name: insurer.name,
    score,
    grade: score === null ? null : gradeFor(score),
    factors: rows,
    pros,
    cons,
    coverage,
    coverageNote:
      score === null
        ? "Not enough published data to grade this insurer"
        : `Based on ${withData} of ${rows.length} measures (${Math.round(coverage * 100)}% of the weight)`,
  };
}

/* ------------------------------------------------------------------ */
/* rankPlans                                                           */
/* ------------------------------------------------------------------ */

export type PlanInput = {
  id: string;
  name: string;
  issuerName: string;
  /** Annual premiums plus expected out-of-pocket in a typical year, from lib/engine.ts. */
  annualCostTypical: number;
  /** Annual premiums plus out-of-pocket in a bad year, from lib/engine.ts. */
  annualCostBad: number;
  /** 0..1 from the caller (network fit, referrals, etc.); null if unknown. */
  convenience: number | null;
};

export type Emphasis = "cost" | "balanced" | "quality";

export type RankPrefs = {
  /** Preset blend of cost vs insurer quality. Default "balanced". */
  emphasis?: Emphasis;
  /** Override the preset blend. Any subset; values are relative. */
  blend?: Partial<{ cost: number; convenience: number; insurer: number }>;
  /** Weight on the bad-year cost, 0..1. Default 0.3. */
  riskAversion?: number;
  /** Override the insurer factor weights. */
  insurerWeights?: Partial<Weights>;
};

/** Blend presets. Cost stays the largest single part in every preset. */
export const BLEND_PRESETS: Record<Emphasis, { cost: number; convenience: number; insurer: number }> = {
  cost: { cost: 70, convenience: 15, insurer: 15 },
  balanced: { cost: 55, convenience: 15, insurer: 30 },
  quality: { cost: 40, convenience: 15, insurer: 45 },
};

export type PlanPart = {
  /** 0..1, 1 = best. */
  normalized: number | null;
  /** Weight as configured. */
  weight: number;
  /** Share of this plan's total it carried, 0..1. */
  effectiveWeight: number;
};

export type RankedPlan = {
  id: string;
  name: string;
  rank: number;
  /** 0..100. */
  total: number;
  /** The cost figure used: typical and bad year blended by riskAversion. */
  blendedCost: number;
  breakdown: {
    cost: PlanPart & { typical: number; bad: number };
    convenience: PlanPart;
    insurer: PlanPart & {
      insurerId: string | null;
      score: number | null;
      grade: Grade | null;
      coverage: number;
    };
  };
  insurer: InsurerScore | null;
  notes: string[];
};

/**
 * Rank plans by a blend of cost, convenience and insurer score.
 *
 * - Cost is scored relative to the cheapest plan in the list: cheapest / this
 *   plan's blended cost. A plan twice as expensive scores 0.5.
 * - The insurer part's weight is multiplied by that insurer's data coverage,
 *   so a thinly documented insurer moves the ranking less. With no match or no
 *   data it drops out and the rest renormalizes.
 * - Ties break on lower blended cost, then name.
 */
export function rankPlans(plans: PlanInput[], prefs: RankPrefs = {}): RankedPlan[] {
  const preset = BLEND_PRESETS[prefs.emphasis ?? "balanced"];
  const blend = { ...preset, ...(prefs.blend ?? {}) };
  const risk = Math.min(1, Math.max(0, prefs.riskAversion ?? 0.3));

  const costs = plans.map((p) => (1 - risk) * p.annualCostTypical + risk * p.annualCostBad);
  const minCost = Math.min(...costs.filter((c) => Number.isFinite(c) && c >= 0));

  const scored = plans.map((p, i) => {
    const notes: string[] = [];
    const cost = costs[i];
    const costNorm = !Number.isFinite(cost) || cost <= 0 ? 1 : Math.min(1, Math.max(0, minCost / cost));

    let conv: number | null = null;
    if (typeof p.convenience === "number" && Number.isFinite(p.convenience)) {
      conv = Math.min(1, Math.max(0, p.convenience));
    } else {
      notes.push("No convenience data, so it was left out of this plan's total");
    }

    const ins = findInsurer(p.issuerName);
    const insScore = ins ? scoreInsurer(ins, prefs.insurerWeights) : null;
    if (!ins) notes.push(`No scorecard for "${p.issuerName}", so the insurer was left out of this plan's total`);
    else if (insScore && insScore.score === null) notes.push(`No published quality data for ${ins.name}`);
    else if (insScore && insScore.coverage < 0.5)
      notes.push(`${ins.name}'s grade rests on limited data (${Math.round(insScore.coverage * 100)}% of the weight)`);

    const insNorm = insScore && insScore.score !== null ? insScore.score / 100 : null;
    const wCost = Math.max(0, blend.cost);
    const wConv = conv === null ? 0 : Math.max(0, blend.convenience);
    const wIns = insNorm === null || !insScore ? 0 : Math.max(0, blend.insurer) * insScore.coverage;
    const sum = wCost + wConv + wIns;

    const total =
      sum > 0
        ? Math.round(((costNorm * wCost + (conv ?? 0) * wConv + (insNorm ?? 0) * wIns) / sum) * 1000) / 10
        : 0;

    const ranked: RankedPlan = {
      id: p.id,
      name: p.name,
      rank: 0,
      total,
      blendedCost: Math.round(cost * 100) / 100,
      breakdown: {
        cost: {
          normalized: costNorm,
          weight: blend.cost,
          effectiveWeight: sum > 0 ? wCost / sum : 0,
          typical: p.annualCostTypical,
          bad: p.annualCostBad,
        },
        convenience: { normalized: conv, weight: blend.convenience, effectiveWeight: sum > 0 ? wConv / sum : 0 },
        insurer: {
          normalized: insNorm,
          weight: blend.insurer,
          effectiveWeight: sum > 0 ? wIns / sum : 0,
          insurerId: ins?.id ?? null,
          score: insScore?.score ?? null,
          grade: insScore?.grade ?? null,
          coverage: insScore?.coverage ?? 0,
        },
      },
      insurer: insScore,
      notes,
    };
    return ranked;
  });

  scored.sort((a, b) => b.total - a.total || a.blendedCost - b.blendedCost || a.name.localeCompare(b.name));
  scored.forEach((r, i) => (r.rank = i + 1));
  return scored;
}
