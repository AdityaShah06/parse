/**
 * The 43 Missouri plans, loaded once, each with a stable id for React keys
 * and for mapping an engine result back to its metadata.
 */

import rows from "../data/mo-plans.json";
import { loadPlan, type PlanRow, type PlanMeta } from "./load-plans";
import type { Plan } from "./engine";

export type CatalogPlan = { id: string; plan: Plan; meta: PlanMeta };

export const CATALOG: CatalogPlan[] = (rows as unknown as PlanRow[]).flatMap((row) => {
  const loaded = loadPlan(row);
  return loaded ? [{ id: row.variant_id, ...loaded }] : [];
});

const byPlan = new Map<Plan, CatalogPlan>(CATALOG.map((c) => [c.plan, c]));

/** rankPlans returns the same Plan objects it was given. */
export const lookup = (plan: Plan): CatalogPlan => byPlan.get(plan)!;

/** The plan with the lowest monthly premium: the one most people pick. */
export const CHEAPEST_PREMIUM: CatalogPlan = CATALOG.reduce((a, b) =>
  b.plan.monthlyPremium < a.plan.monthlyPremium ? b : a
);

/** Formatting only. Never arithmetic. */
export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const QUOTE_NOTE =
  "Premiums are 2026 list prices for a 30-year-old non-smoker in Boone County, before any tax credit.";
