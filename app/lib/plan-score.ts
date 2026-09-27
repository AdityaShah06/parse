/**
 * A plan score you can check by hand.
 *
 * Four parts, each 0 to 1, each with the reason it got that number:
 *  - Protection: how low the out-of-pocket ceiling is against the 2026 legal
 *    maximum ($10,600 for one person, the highest any ACA plan may set).
 *  - Everyday care: how many everyday services have a set price before the
 *    deductible, plus free preventive care.
 *  - Insurer track record: lib/ranking.ts scoreInsurer (claim denials,
 *    complaints, quality stars, prior authorization), sourced per figure.
 *  - Freedom: how freely you can pick doctors, from the plan type.
 *
 * Missing parts carry no weight; the rest are renormalized and the result says
 * so. The AI can explain this score but never changes it.
 */

import type { Plan } from "./engine";
import type { BenefitView } from "./benefits";
import { findInsurer } from "./kb/insurers";
import { gradeFor, scoreInsurer, type Grade, type InsurerScore } from "./ranking";

/** 2026 ACA maximum out-of-pocket limit for self-only coverage. */
export const ACA_MOOP_2026 = 10600;
export const ACA_MOOP_SOURCE = "CMS, 2026 maximum annual limitation on cost sharing ($10,600 self-only)";
/** A strong out-of-pocket ceiling for comparison (gold and platinum plans commonly sit near here). */
const STRONG_MOOP = 3000;

export type PartKey = "protection" | "everyday" | "insurer" | "freedom";

export type ScorePart = {
  key: PartKey;
  label: string;
  value: number | null;
  weight: number;
  why: string;
};

export type PlanScore = {
  score: number;
  grade: Grade;
  parts: ScorePart[];
  pros: string[];
  cons: string[];
  insurer: InsurerScore | null;
  note: string;
};

const WEIGHTS: Record<PartKey, number> = { protection: 0.3, everyday: 0.3, insurer: 0.25, freedom: 0.15 };

const FREEDOM: Record<string, { v: number; why: string }> = {
  PPO: { v: 1, why: "PPO: see any doctor, out-of-network care is partly covered." },
  POS: { v: 0.75, why: "POS: out-of-network care is partly covered, usually with a referral." },
  EPO: { v: 0.5, why: "EPO: in-network doctors only, except emergencies." },
  HMO: { v: 0.35, why: "HMO: in-network doctors only, and specialists usually need a referral." },
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function scorePlan(plan: Plan, benefits: BenefitView[], meta: { planType?: string | null; issuer?: string | null; referralRequired?: boolean | null }): PlanScore {
  const parts: ScorePart[] = [];
  const pros: string[] = [];
  const cons: string[] = [];

  // Protection
  const moop = plan.outOfPocketMax;
  const protection = Math.max(0, Math.min(1, (ACA_MOOP_2026 - moop) / (ACA_MOOP_2026 - STRONG_MOOP)));
  parts.push({
    key: "protection",
    label: "Protection in a bad year",
    value: protection,
    weight: WEIGHTS.protection,
    why: `Out-of-pocket max ${usd(moop)}, against the legal ceiling of ${usd(ACA_MOOP_2026)}.`,
  });
  if (moop <= 5000) pros.push(`Your worst year tops out at ${usd(moop)}. That is strong protection.`);
  else if (moop >= 9000) cons.push(`A bad year can cost up to ${usd(moop)} before the plan pays everything.`);

  // Everyday care
  const everyday = benefits.filter((b) => ["primary", "mental", "urgent", "generic", "specialist"].includes(b.key));
  const early = everyday.filter((b) => b.share.beforeDeductible);
  const prevFree = benefits.find((b) => b.key === "preventive")?.share.free ?? false;
  const everydayScore = Math.min(1, (early.length / Math.max(1, everyday.length)) * 0.85 + (prevFree ? 0.15 : 0));
  parts.push({
    key: "everyday",
    label: "Everyday care",
    value: everydayScore,
    weight: WEIGHTS.everyday,
    why: `${early.length} of ${everyday.length} everyday services have a set price before the deductible${prevFree ? ", and checkups are free" : ""}.`,
  });
  if (early.length >= 3) {
    const list = early.map((b) => b.label.toLowerCase()).slice(0, 3).join(", ");
    pros.push(`${list[0].toUpperCase()}${list.slice(1)} have set prices from day one.`);
  }
  if (early.length <= 1) cons.push(`Most everyday care counts toward the ${usd(plan.deductible)} deductible first, so you pay full price early in the year.`);
  if (plan.deductible >= 5000) cons.push(`The deductible is ${usd(plan.deductible)}. Until you spend that, most bills are yours.`);
  else if (plan.deductible <= 1500) pros.push(`A low deductible of ${usd(plan.deductible)}.`);

  // Insurer track record
  const ins = findInsurer(meta.issuer ?? null);
  const insScore = ins ? scoreInsurer(ins) : null;
  if (insScore && insScore.score !== null) {
    parts.push({
      key: "insurer",
      label: "Insurer track record",
      value: insScore.score / 100,
      weight: WEIGHTS.insurer,
      why: `${insScore.name}: ${insScore.coverageNote}.`,
    });
    pros.push(...insScore.pros.slice(0, 2));
    cons.push(...insScore.cons.slice(0, 2));
  } else {
    parts.push({ key: "insurer", label: "Insurer track record", value: null, weight: WEIGHTS.insurer, why: meta.issuer ? `No public track record found for ${meta.issuer} yet.` : "Insurer not identified." });
  }

  // Freedom
  const type = (meta.planType ?? "").toUpperCase().match(/PPO|POS|EPO|HMO/)?.[0];
  if (type) {
    const f = FREEDOM[type];
    const v = Math.max(0, f.v - (meta.referralRequired ? 0.1 : 0));
    parts.push({ key: "freedom", label: "Freedom to pick doctors", value: v, weight: WEIGHTS.freedom, why: f.why + (meta.referralRequired ? " Referrals required." : "") });
    if (type === "PPO") pros.push("You can see doctors outside the network, at a higher price.");
    if (type === "HMO" || type === "EPO") cons.push("Only in-network doctors are covered outside emergencies. Check yours before you book.");
  } else {
    parts.push({ key: "freedom", label: "Freedom to pick doctors", value: null, weight: WEIGHTS.freedom, why: "Plan type not printed." });
  }

  const scored = parts.filter((p) => p.value !== null);
  const totalW = scored.reduce((a, p) => a + p.weight, 0);
  const score = Math.round((scored.reduce((a, p) => a + (p.value as number) * p.weight, 0) / (totalW || 1)) * 100);
  const missing = parts.filter((p) => p.value === null).map((p) => p.label.toLowerCase());
  return {
    score,
    grade: gradeFor(score),
    parts,
    pros: [...new Set(pros)].slice(0, 5),
    cons: [...new Set(cons)].slice(0, 5),
    insurer: insScore,
    note: missing.length ? `Scored on ${scored.length} of 4 parts; missing ${missing.join(" and ")}.` : "Scored on all 4 parts.",
  };
}
