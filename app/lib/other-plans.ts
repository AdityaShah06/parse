/**
 * Adapters for the doors that are not a card or a marketplace plan. Each one
 * returns the same engine `Plan`, so every room works the same way after it.
 */

import type { Plan } from "./engine";
import { planFromCard } from "./load-plans";

/** Service type for anything bought for cash, outside insurance entirely. */
export const CASH = "Paid cash, outside insurance";

/**
 * Add the cash rule to any plan: a cash purchase is billed in full to you and
 * never touches the deductible or the ceiling. The engine already prices a
 * `notApplicable` benefit exactly that way.
 */
export const withCash = (plan: Plan): Plan => ({
  ...plan,
  costSharing: { ...plan.costSharing, [CASH]: { kind: "notApplicable" } },
});

/**
 * Sample MO HealthNet (Missouri Medicaid) plan. Medicaid cost sharing is small
 * or zero for most adults, so this models $0 for covered care. It is labeled as
 * a sample on screen until checked against MO HealthNet's published copays.
 */
export const medicaidPlan = (): Plan =>
  planFromCard({ name: "MO HealthNet", deductible: 0, coinsuranceRate: 0, outOfPocketMax: 0, monthlyPremium: 0 });

/**
 * No insurance: you pay the full price of everything, and there is no ceiling.
 * Infinity is deliberate: nothing ever caps it. The interface checks for a
 * non-finite ceiling and draws the bar without walls.
 */
export const uninsuredPlan = (): Plan =>
  planFromCard({
    name: "No insurance",
    deductible: Number.POSITIVE_INFINITY,
    coinsuranceRate: 1,
    outOfPocketMax: Number.POSITIVE_INFINITY,
    monthlyPremium: 0,
  });
