/**
 * Picking a plan for a person, not a spreadsheet. Every plan's typical year
 * and bad year come from the engine; this file only weighs them against the
 * things people actually care about (keeping a doctor, avoiding a huge bill)
 * and explains the pick in words.
 */

import { runYear, type CareEvent } from "./engine";
import { CATALOG, type CatalogPlan } from "./catalog";
import { SURPRISES, buildYear } from "./scenarios";
import { HABITS_FOR_USE, type Answers } from "./app-state";

export type Pick = {
  c: CatalogPlan;
  typical: number; // engine trueAnnualCost, normal year
  worst: number; // engine trueAnnualCost, normal year plus a car crash
  premiumYear: number; // engine annualPremium
  convenience: number; // 0 to 1
  score: number;
  reasons: string[];
};

export const NETWORK_LINE: Record<string, string> = {
  PPO: "See any doctor. Out of network costs more, but it's covered.",
  EPO: "Network doctors only, no referrals needed.",
  HMO: "Network doctors only, and you need a referral for specialists.",
  POS: "Network first, referrals for specialists, some out-of-network coverage.",
};

export function convenienceOf(planType: string | null, keepDoctor: boolean): number {
  const t = (planType ?? "").toUpperCase();
  if (t === "PPO") return 1;
  if (t === "POS") return 0.75;
  if (t === "EPO") return keepDoctor ? 0.45 : 0.7;
  if (t === "HMO") return keepDoctor ? 0.3 : 0.55;
  return 0.5;
}

export function yearsFor(answers: Answers): { normal: CareEvent[]; bad: CareEvent[] } {
  const habits = HABITS_FOR_USE[answers.use];
  const normal = buildYear(habits, SURPRISES[0], 6, false).events;
  const crash = SURPRISES.find((s) => s.id === "crash")!;
  const bad = buildYear(habits, crash, 6, false).events;
  return { normal, bad };
}

export function recommend(answers: Answers, catalog: CatalogPlan[] = CATALOG): Pick[] {
  const { normal, bad } = yearsFor(answers);
  const rows = catalog.map((c) => {
    const n = runYear(normal, c.plan);
    const b = runYear(bad, c.plan);
    return { c, typical: n.trueAnnualCost, worst: b.trueAnnualCost, premiumYear: n.annualPremium, convenience: convenienceOf(c.meta.planType, answers.doctor) };
  });

  const span = (k: "typical" | "worst") => {
    const v = rows.map((r) => r[k]);
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return (x: number) => (hi === lo ? 1 : 1 - (x - lo) / (hi - lo));
  };
  const typ = span("typical");
  const wst = span("worst");
  const w =
    answers.fear === "monthly"
      ? { typical: 0.5, worst: 0.2, conv: 0.3 }
      : { typical: 0.25, worst: 0.45, conv: 0.3 };
  if (answers.doctor) {
    w.conv += 0.15;
    w.typical -= 0.1;
    w.worst -= 0.05;
  }

  const scored = rows.map((r) => ({ ...r, score: w.typical * typ(r.typical) + w.worst * wst(r.worst) + w.conv * r.convenience, reasons: [] as string[] }));
  scored.sort((a, b) => b.score - a.score);

  const cheapestTypical = Math.min(...scored.map((s) => s.typical));
  const cheapestWorst = Math.min(...scored.map((s) => s.worst));
  for (const s of scored) {
    const t = (s.c.meta.planType ?? "").toUpperCase();
    if (s.typical === cheapestTypical) s.reasons.push("The cheapest normal year of all 43 plans.");
    if (s.worst === cheapestWorst) s.reasons.push("The smallest bill if your year goes badly.");
    if (answers.doctor && t === "PPO") s.reasons.push("Lets you keep a doctor who isn't in its network.");
    if (!answers.doctor && (t === "EPO" || t === "HMO")) s.reasons.push("A tighter network, which is fine if you don't have a doctor to keep.");
    if (s.c.meta.hsaEligible) s.reasons.push("Works with a health savings account: tax-free money for care.");
    if (s.reasons.length === 0) s.reasons.push("A balance of monthly price, bad-year protection and network.");
  }
  return scored;
}
