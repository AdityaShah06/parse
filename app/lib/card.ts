/**
 * Card mode: a Plan built from what is printed on an insurance card, for the
 * people on employer or parent plans, which no public dataset covers.
 *
 * When the visitor does not know a number, we use a typical employer-plan
 * value and say so on screen, with the source. This file never computes what
 * anyone pays; it only assembles the Plan the engine runs.
 */

import type { Plan } from "./engine";
import type { CostShare } from "./parse-cost-share";
import { planFromCard } from "./load-plans";
import { BENEFIT } from "./load-plans";

export type CopayKey = "primary" | "specialist" | "urgent" | "er" | "generic";

export type CardInput = {
  deductible: number | null;
  /** Percent as typed, e.g. 20 for 20%. */
  coinsurancePct: number | null;
  outOfPocketMax: number | null;
  monthlyPremium: number | null;
  copays: Partial<Record<CopayKey, number>>;
  /** Copays the plan's summary says apply only after the deductible. */
  copaysAfterDeductible?: Partial<Record<CopayKey, boolean>>;
};

export const emptyCard = (): CardInput => ({
  deductible: null,
  coinsurancePct: null,
  outOfPocketMax: null,
  monthlyPremium: null,
  copays: {},
});

const KFF = "KFF Employer Health Benefits Survey 2025";

/**
 * Typical employer-plan values for single coverage.
 *
 * Deductible, coinsurance and copays are KFF 2025 averages. KFF does not
 * publish an average out-of-pocket maximum: it reports that 12% of covered
 * workers have a limit of $2,000 or less and 21% have one above $6,000. The
 * $4,000 here is our middle guess inside that range, and the screen says so.
 */
export const TYPICAL = {
  deductible: { value: 1886, source: `${KFF}, average single deductible` },
  coinsurancePct: { value: 20, source: `${KFF}, average coinsurance for a hospital stay` },
  outOfPocketMax: {
    value: 4000,
    source: `Our middle guess. Per ${KFF}, two thirds of workers have a limit between $2,000 and $6,000`,
  },
  primary: { value: 27, source: `${KFF}, average primary care copay` },
  specialist: { value: 45, source: `${KFF}, average specialist copay` },
} as const;

export const COPAY_LABELS: Record<CopayKey, string> = {
  primary: "Doctor visit",
  specialist: "Specialist",
  urgent: "Urgent care",
  er: "Emergency room",
  generic: "Generic prescription",
};

const COPAY_BENEFIT: Record<CopayKey, string> = {
  primary: BENEFIT.PRIMARY_CARE,
  specialist: BENEFIT.SPECIALIST,
  urgent: BENEFIT.URGENT_CARE,
  er: BENEFIT.EMERGENCY_ROOM,
  generic: BENEFIT.GENERIC_DRUGS,
};

export type CardPlan = {
  plan: Plan;
  /** Human-readable notes for every value we filled in for the visitor. */
  estimated: { field: string; value: string; source: string }[];
};

/**
 * Build the engine Plan from the card. Copays printed on a card almost always
 * apply before the deductible, so they are modeled as deductible-waived copays.
 * A service with no copay falls back to deductible then coinsurance, which is
 * the engine's default for a benefit missing from the map.
 */
export function cardPlan(card: CardInput): CardPlan {
  const estimated: CardPlan["estimated"] = [];

  const deductible = card.deductible ?? TYPICAL.deductible.value;
  if (card.deductible === null) {
    estimated.push({ field: "Deductible", value: `$${deductible.toLocaleString()}`, source: TYPICAL.deductible.source });
  }

  const pct = card.coinsurancePct ?? TYPICAL.coinsurancePct.value;
  if (card.coinsurancePct === null) {
    estimated.push({ field: "Coinsurance", value: `${pct}%`, source: TYPICAL.coinsurancePct.source });
  }

  const oop = card.outOfPocketMax ?? TYPICAL.outOfPocketMax.value;
  if (card.outOfPocketMax === null) {
    estimated.push({ field: "Out-of-pocket max", value: `$${oop.toLocaleString()}`, source: TYPICAL.outOfPocketMax.source });
  }

  const plan = planFromCard({
    name: "Your plan",
    deductible,
    coinsuranceRate: pct / 100,
    outOfPocketMax: oop,
    monthlyPremium: card.monthlyPremium ?? 0,
  });

  const costSharing: Record<string, CostShare> = {};
  for (const [key, amount] of Object.entries(card.copays) as [CopayKey, number][]) {
    if (typeof amount === "number" && Number.isFinite(amount)) {
      costSharing[COPAY_BENEFIT[key]] = {
        kind: "copay",
        amount,
        afterDeductible: card.copaysAfterDeductible?.[key] === true,
        unit: "visit",
      };
    }
  }

  return { plan: { ...plan, costSharing }, estimated };
}
