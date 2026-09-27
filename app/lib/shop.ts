/**
 * Shopping live HealthCare.gov plans for a person.
 *
 * Every plan's normal year and bad year are run through the engine at the
 * premium CMS quotes for this household (after the tax credit when an income
 * is given). Then five parts, each 0 to 1 with a stated reason:
 *   cost       normal-year total, relative to the cheapest plan here
 *   protection bad-year total, relative to the best plan here
 *   network    how freely you can pick doctors (plan type, national network)
 *   quality    CMS Quality Rating System stars for this plan (1 to 5)
 *   claims     2024 in-network claim denial rate for this insurer in this
 *              state, from the CMS Transparency in Coverage file
 * Missing parts drop out and the rest renormalize. The AI never scores.
 */

import { runYear, type Plan } from "./engine";
import { yearsFor, convenienceOf } from "./finder";
import type { Answers } from "./app-state";
import { denialFor, DENIAL_MEDIAN, DENIALS_SOURCE } from "./kb/denials";

export type QualityRating = {
  available?: boolean;
  year?: number;
  global_rating?: number;
  clinical_quality_management_rating?: number;
  enrollee_experience_rating?: number;
  plan_efficiency_rating?: number;
} | null;

export type LivePlan = {
  id: string;
  name: string;
  issuer: string | null;
  issuerPhone: string | null;
  metal: string | null;
  type: string | null;
  premium: number | null;
  premiumWithCredit: number | null;
  deductible: number;
  moop: number;
  hsa: boolean;
  hasNationalNetwork: boolean | null;
  referral?: boolean | null;
  qualityRating: QualityRating;
  urls: { brochure: string | null; benefits: string | null; network: string | null; formulary: string | null };
  enginePlan: Plan;
};

export type PartKey = "cost" | "protection" | "network" | "quality" | "claims";

export type ShopPart = { key: PartKey; label: string; value: number | null; weight: number; why: string };

export type ShopRow = {
  p: LivePlan;
  typical: number;
  bad: number;
  premiumYear: number;
  score: number;
  parts: ShopPart[];
  pros: string[];
  cons: string[];
  denialRate: number | null;
  stars: number | null;
};

const LABEL: Record<PartKey, string> = {
  cost: "Normal-year cost",
  protection: "Bad-year protection",
  network: "Freedom to pick doctors",
  quality: "Quality stars",
  claims: "Pays claims",
};

export function weightsFor(a: Answers): Record<PartKey, number> {
  const w: Record<PartKey, number> =
    a.fear === "monthly"
      ? { cost: 0.42, protection: 0.13, network: 0.15, quality: 0.12, claims: 0.18 }
      : { cost: 0.22, protection: 0.33, network: 0.15, quality: 0.12, claims: 0.18 };
  if (a.doctor) {
    w.network += 0.12;
    w.cost -= 0.07;
    w.protection -= 0.05;
  }
  return w;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function shop(plans: LivePlan[], answers: Answers): ShopRow[] {
  if (!plans.length) return [];
  const { normal, bad } = yearsFor(answers);
  const w = weightsFor(answers);

  const base = plans.map((p) => {
    const n = runYear(normal, p.enginePlan);
    const b = runYear(bad, p.enginePlan);
    return { p, typical: n.trueAnnualCost, bad: b.trueAnnualCost, premiumYear: n.annualPremium };
  });
  const minTyp = Math.min(...base.map((r) => r.typical));
  const minBad = Math.min(...base.map((r) => r.bad));

  const rows: ShopRow[] = base.map((r) => {
    const { p } = r;
    const stars = p.qualityRating?.available && (p.qualityRating.global_rating ?? 0) > 0 ? (p.qualityRating.global_rating as number) : null;
    const den = denialFor(p.id);
    const denialRate = den?.denialRatePct ?? null;
    const conv = Math.min(1, convenienceOf(p.type, answers.doctor) + (p.hasNationalNetwork ? 0.1 : 0) - (p.referral ? 0.1 : 0));

    const parts: ShopPart[] = [
      { key: "cost", label: LABEL.cost, value: r.typical > 0 ? minTyp / r.typical : 1, weight: w.cost, why: `${usd(r.typical)} in a normal year, premiums included.` },
      { key: "protection", label: LABEL.protection, value: r.bad > 0 ? minBad / r.bad : 1, weight: w.protection, why: `${usd(r.bad)} in a year with a car crash and a hospital stay.` },
      { key: "network", label: LABEL.network, value: conv, weight: w.network, why: `${p.type ?? "Plan type not listed"}${p.hasNationalNetwork ? ", national network" : ""}${p.referral ? ", referrals required" : ""}.` },
      {
        key: "quality",
        label: LABEL.quality,
        value: stars === null ? null : stars / 5,
        weight: w.quality,
        why: stars === null ? "CMS has not rated this plan yet." : `${stars} of 5 stars from CMS's Quality Rating System.`,
      },
      {
        key: "claims",
        label: LABEL.claims,
        value: denialRate === null ? null : Math.max(0, Math.min(1, 1 - (denialRate - 3) / (36 - 3))),
        weight: w.claims,
        why: denialRate === null ? "No 2024 denial data for this insurer here." : `Denied ${denialRate.toFixed(1)}% of in-network claims in 2024 (national middle ${DENIAL_MEDIAN.toFixed(1)}%).`,
      },
    ];
    const present = parts.filter((x) => x.value !== null);
    const tw = present.reduce((a, x) => a + x.weight, 0) || 1;
    const score = Math.round((present.reduce((a, x) => a + (x.value as number) * x.weight, 0) / tw) * 100);

    const pros: string[] = [];
    const cons: string[] = [];
    if (r.typical === minTyp) pros.push("The cheapest normal year of every plan here.");
    if (r.bad === minBad) pros.push("The smallest bill if your year goes badly.");
    if (stars !== null && stars >= 4) pros.push(`${stars}-star quality rating from CMS.`);
    if (stars !== null && stars <= 2) cons.push(`Only ${stars} star${stars === 1 ? "" : "s"} for quality from CMS.`);
    if (denialRate !== null && denialRate <= DENIAL_MEDIAN - 5) pros.push(`Denies fewer claims than most: ${denialRate.toFixed(1)}% in 2024.`);
    if (denialRate !== null && denialRate >= DENIAL_MEDIAN + 3) cons.push(`Denied ${denialRate.toFixed(1)}% of in-network claims in 2024, above the national middle.`);
    if (p.hsa) pros.push("Works with a health savings account.");
    if (p.hasNationalNetwork) pros.push("A national network, useful if you travel or study out of state.");
    if (answers.doctor && /HMO|EPO/i.test(p.type ?? "")) cons.push("Only network doctors are covered. Check yours before you switch.");
    if (p.deductible >= 6000) cons.push(`A ${usd(p.deductible)} deductible: most care is full price until you reach it.`);
    if (!pros.length) pros.push("A balance of price, protection and network.");

    return { ...r, score, parts, pros, cons, denialRate, stars };
  });

  return rows.sort((a, b) => b.score - a.score || a.typical - b.typical);
}

export const SHOP_SOURCES = [
  "Plans and premiums: CMS Marketplace API (HealthCare.gov's own data).",
  "Quality stars: CMS Quality Rating System, via the same API.",
  `Claim denials: ${DENIALS_SOURCE.name}.`,
  "Your costs: Plainly's engine, running a normal year and a bad year through each plan's rules.",
];
