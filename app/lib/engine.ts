/**
 * Cost engine: in-network medical cost sharing, sequential over a plan year.
 *
 * SCOPE. This models one person, in-network medical benefits, on a plan with a
 * single combined deductible and a single out-of-pocket maximum.
 *
 * Deliberately NOT modeled:
 *   - family vs individual deductibles (embedded or aggregate)
 *   - separate pharmacy accumulators
 *   - service-specific deductibles
 *   - prior authorization
 *   - separate out-of-network deductible / OOP max
 *   - mid-year plan changes
 *
 * Say this out loud in the demo. Narrowing the claim is what makes it credible.
 */

import type { CostShare } from "./parse-cost-share";

export type Plan = {
  name: string;
  deductible: number;
  /** 0.2 means the patient pays 20% after the deductible is met. */
  coinsuranceRate: number;
  outOfPocketMax: number;
  monthlyPremium: number;
  /**
   * Per-benefit cost sharing, keyed by the PUF's BenefitName, parsed from
   * CopayInnTier1 / CoinsInnTier1. A benefit missing from this map falls back
   * to the plan's coinsuranceRate after the deductible.
   */
  costSharing: Record<string, CostShare>;
  /**
   * PUF InpatientCopaymentMaximumDays: the most days a per-day inpatient
   * copay can be charged for. Undefined means uncapped.
   */
  inpatientCopayMaxDays?: number;
};

export type CareEvent = {
  /** ISO date. Order matters: the accumulator is sequential. */
  date: string;
  label: string;
  serviceType: string;
  /** The negotiated rate, not the billed charge. */
  allowedAmount: number;
  /** USPSTF-recommended preventive care: $0 to the patient under ACA 2713. */
  preventive?: boolean;
  /**
   * Out-of-network balance bill: the amount above the allowed amount that a
   * provider with no contract can charge you directly. This is the ground
   * ambulance case. It never counts toward the out-of-pocket maximum.
   */
  balanceBilled?: number;
  /**
   * PUF IsExclFromInnMOOP = 'Yes': cost sharing for this benefit does not count
   * toward the in-network out-of-pocket maximum, which also means the maximum
   * does not protect you from it. 382 Missouri benefit rows carry this flag.
   */
  excludedFromMoop?: boolean;
  /**
   * Length of stay in days, for inpatient benefits priced with a per-day
   * copay. Ignored for per-visit and per-stay pricing. Defaults to 1.
   */
  days?: number;
};

export type Accumulator = {
  deductibleMet: number;
  outOfPocketSpent: number;
};

export type EventResult = {
  event: CareEvent;
  /** Portion paid because the deductible was not yet met. */
  toDeductible: number;
  /** Portion paid as coinsurance or copay. */
  costShare: number;
  /** Balance billed amount, outside the OOP max. */
  balanceBilled: number;
  /** Everything the patient owes for this event. */
  patientPays: number;
  planPays: number;
  /** Accumulator state after this event. */
  after: Accumulator;
  /** True if the OOP max clamped what the patient would otherwise owe. */
  hitOutOfPocketMax: boolean;
  /** True when this event's cost sits outside the out-of-pocket maximum. */
  outsideCeiling: boolean;
};

export type YearResult = {
  plan: Plan;
  timeline: EventResult[];
  patientTotal: number;
  planTotal: number;
  annualPremium: number;
  /** premium + everything the patient paid out of pocket */
  trueAnnualCost: number;
};

export const emptyAccumulator = (): Accumulator => ({
  deductibleMet: 0,
  outOfPocketSpent: 0,
});

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolve a copay to a dollar figure for this event.
 *
 * Per-day copays multiply by the length of stay. Per-stay copays are charged
 * once per admission, so they behave like a per-visit copay here.
 */
function copayFor(
  cs: Extract<CostShare, { kind: "copay" }>,
  event: CareEvent,
  plan: Plan
): number {
  if (cs.unit !== "day") return cs.amount;

  const days = Math.max(1, event.days ?? 1);
  // A non-positive cap means uncapped, not zero days. The PUF leaves the
  // column blank when no cap applies, and a blank casts to 0 on the way in.
  const cap = plan.inpatientCopayMaxDays;
  const capped = cap !== undefined && cap > 0 ? Math.min(days, cap) : days;

  return cs.amount * capped;
}

/**
 * Apply one care event to the accumulator.
 *
 * Order of operations:
 *   1. Preventive care is $0 and touches nothing.
 *   2. Copay services skip the deductible but count toward the OOP max.
 *   3. Everything else: deductible first, then coinsurance on the remainder.
 *   4. Whatever the patient owes is clamped by remaining OOP room.
 *   5. Balance billing is added on top, outside the OOP max entirely.
 *   6. A benefit flagged excludedFromMoop is neither capped by the ceiling nor
 *      counted toward it.
 */
export function applyEvent(
  state: Accumulator,
  event: CareEvent,
  plan: Plan
): EventResult {
  const balanceBilled = event.balanceBilled ?? 0;

  if (event.preventive) {
    return {
      event,
      toDeductible: 0,
      costShare: 0,
      balanceBilled,
      patientPays: balanceBilled,
      planPays: event.allowedAmount,
      after: { ...state },
      hitOutOfPocketMax: false,
      outsideCeiling: false,
    };
  }

  const oopRoom = Math.max(0, plan.outOfPocketMax - state.outOfPocketSpent);
  const remainingDeductible = Math.max(0, plan.deductible - state.deductibleMet);

  // Benefits absent from the map fall back to the plan's headline coinsurance,
  // which in the PUF is always expressed as applying after the deductible.
  const cs: CostShare = plan.costSharing[event.serviceType] ?? {
    kind: "coinsurance",
    rate: plan.coinsuranceRate,
    afterDeductible: true,
  };

  let toDeductible = 0;
  let costShare = 0;

  if (cs.kind === "notApplicable") {
    // Not covered. The whole allowed amount is the patient's and, per the PUF's
    // IsEHB / IsCovered flags, non-covered care does not touch the accumulator.
    return {
      event,
      toDeductible: 0,
      costShare: round(event.allowedAmount),
      balanceBilled,
      patientPays: round(event.allowedAmount + balanceBilled),
      planPays: 0,
      after: { ...state },
      hitOutOfPocketMax: false,
      outsideCeiling: true,
    };
  }

  if (cs.afterDeductible) {
    // Full allowed amount applies to the deductible first, then cost sharing
    // on whatever remains.
    toDeductible = Math.min(event.allowedAmount, remainingDeductible);
    const remainder = event.allowedAmount - toDeductible;

    costShare =
      cs.kind === "copay"
        ? remainder > 0
          ? Math.min(copayFor(cs, event, plan), remainder)
          : 0
        : remainder * cs.rate;
  } else {
    // Deductible waived for this benefit. Cost sharing applies from the first
    // dollar. ASSUMPTION: what the patient pays here counts toward the
    // out-of-pocket maximum but not toward the deductible. That is the common
    // arrangement; the PUF does not state it per benefit, so label it as a
    // modeling choice in the Confidence Meter rather than as verified.
    costShare =
      cs.kind === "copay"
        ? Math.min(copayFor(cs, event, plan), event.allowedAmount)
        : event.allowedAmount * cs.rate;
  }

  const uncapped = toDeductible + costShare;

  // A benefit flagged as excluded from the MOOP is not capped by it, and does
  // not accumulate toward it either. That cuts both ways: the ceiling neither
  // limits this charge nor moves closer because of it.
  const outsideCeiling = event.excludedFromMoop === true;
  let capped = uncapped;
  let hitOutOfPocketMax = false;

  if (!outsideCeiling) {
    capped = Math.min(uncapped, oopRoom);
    hitOutOfPocketMax = capped < uncapped;

    // If the OOP max clamped the total, shave the cost share first: money that
    // went toward the deductible stays credited to the deductible.
    if (hitOutOfPocketMax) {
      toDeductible = Math.min(toDeductible, capped);
      costShare = capped - toDeductible;
    }
  }

  return {
    event,
    toDeductible: round(toDeductible),
    costShare: round(costShare),
    balanceBilled: round(balanceBilled),
    patientPays: round(capped + balanceBilled),
    planPays: round(event.allowedAmount - capped),
    after: {
      deductibleMet: round(state.deductibleMet + toDeductible),
      outOfPocketSpent: round(
        state.outOfPocketSpent + (outsideCeiling ? 0 : capped)
      ),
    },
    hitOutOfPocketMax,
    outsideCeiling,
  };
}

/**
 * Run a year of care against a plan, in date order.
 *
 * This is the part HealthCare.gov's estimator does not do. It takes a
 * low/medium/high bucket; this takes your actual events, so the order and
 * timing of care changes the answer.
 */
export function runYear(events: CareEvent[], plan: Plan): YearResult {
  const ordered = [...events].sort((a, b) => a.date.localeCompare(b.date));

  let state = emptyAccumulator();
  const timeline: EventResult[] = [];

  for (const event of ordered) {
    const result = applyEvent(state, event, plan);
    timeline.push(result);
    state = result.after;
  }

  const patientTotal = round(
    timeline.reduce((sum, r) => sum + r.patientPays, 0)
  );
  const planTotal = round(timeline.reduce((sum, r) => sum + r.planPays, 0));
  const annualPremium = round(plan.monthlyPremium * 12);

  return {
    plan,
    timeline,
    patientTotal,
    planTotal,
    annualPremium,
    trueAnnualCost: round(patientTotal + annualPremium),
  };
}

/**
 * Rank every plan by what this year of care would actually have cost.
 *
 * The reveal: the cheapest premium usually is not the cheapest year.
 */
export function rankPlans(events: CareEvent[], plans: Plan[]): YearResult[] {
  return plans
    .map((plan) => runYear(events, plan))
    .sort((a, b) => a.trueAnnualCost - b.trueAnnualCost);
}

/**
 * The typical year and the bad year, side by side.
 *
 * HealthCare.gov shows a point estimate. Insurance exists for the variance,
 * so showing only the expected case hides the thing you are buying.
 */
export function comparedScenarios(
  typicalYear: CareEvent[],
  badYear: CareEvent[],
  plans: Plan[]
) {
  return plans.map((plan) => ({
    plan,
    typical: runYear(typicalYear, plan),
    bad: runYear(badYear, plan),
  }));
}
