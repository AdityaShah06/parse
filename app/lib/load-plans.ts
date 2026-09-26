/**
 * Maps mo-plans.json (the output of extract.sql) onto engine Plan objects.
 *
 * The SQL deliberately emits cost sharing as raw strings so the grammar has a
 * single owner: parse-cost-share.ts. Nothing here interprets cost sharing
 * itself, it only reshapes the row.
 */

import { pickCostShare, type CostShare } from "./parse-cost-share";
import type { Plan } from "./engine";

/** One row of mo-plans.json, as extract.sql writes it. */
export type PlanRow = {
  plan_id: string;
  variant_id: string;
  plan_name: string | null;
  issuer: string | null;
  metal: string | null;
  plan_type: string | null;
  csr_variant: string | null;
  deductible: number | null;
  out_of_pocket_max: number | null;
  default_coinsurance: number | null;
  inpatient_copay_max_days: number | null;
  free_pcp_visits: number | null;
  hsa_eligible: string | boolean | null;
  sbc_url: string | null;
  monthly_premium: number | null;
  /** Premium in Rating Area 2 (Adair County, Kirksville). */
  monthly_premium_area2: number | null;
  cost_sharing: BenefitRow[] | null;
};

export type BenefitRow = {
  benefit: string;
  copay_raw: string | null;
  coins_raw: string | null;
  is_covered: string | null;
  excluded_from_moop: boolean | null;
  exclusions: string | null;
  limit_qty: number | null;
  limit_unit: string | null;
};

/** Everything the engine does not need but the interface does. */
export type PlanMeta = {
  issuer: string | null;
  metal: string | null;
  planType: string | null;
  hsaEligible: boolean;
  sbcUrl: string | null;
  freePcpVisits: number | null;
  premiumArea2: number | null;
  /** Benefits whose cost sharing sits outside the out-of-pocket maximum. */
  outsideCeiling: string[];
  /** Benefit name to its visit or quantity cap, e.g. "20 Visits per Year". */
  limits: Record<string, string>;
  /** Benefit name to the plan's own exclusion text, verbatim. */
  exclusions: Record<string, string>;
};

export type LoadedPlan = { plan: Plan; meta: PlanMeta };

const num = (v: number | null | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const truthy = (v: string | boolean | null | undefined): boolean =>
  v === true || (typeof v === "string" && /^(yes|true)$/i.test(v));

/**
 * IsCovered is usually "Covered", sometimes blank. Treat anything that is
 * present and not "Covered" as not covered, and a blank as unknown, which
 * falls through to whatever the cost-sharing strings say.
 */
function isNotCovered(raw: string | null): boolean {
  return raw !== null && raw.trim() !== "" && !/^covered$/i.test(raw.trim());
}

export function loadPlan(row: PlanRow): LoadedPlan | null {
  const deductible = num(row.deductible);
  const outOfPocketMax = num(row.out_of_pocket_max);
  const monthlyPremium = num(row.monthly_premium);

  // A plan missing any of these cannot be priced, so drop it rather than
  // substituting a zero that would quietly win every ranking.
  if (
    deductible === undefined ||
    outOfPocketMax === undefined ||
    monthlyPremium === undefined
  ) {
    return null;
  }

  const costSharing: Record<string, CostShare> = {};
  const outsideCeiling: string[] = [];
  const limits: Record<string, string> = {};
  const exclusions: Record<string, string> = {};

  for (const b of row.cost_sharing ?? []) {
    costSharing[b.benefit] = isNotCovered(b.is_covered)
      ? { kind: "notApplicable" }
      : pickCostShare(b.copay_raw, b.coins_raw);

    if (b.excluded_from_moop) outsideCeiling.push(b.benefit);
    if (b.limit_qty && b.limit_unit) {
      limits[b.benefit] = `${b.limit_qty} ${b.limit_unit}`;
    }
    if (b.exclusions && b.exclusions.trim()) {
      exclusions[b.benefit] = b.exclusions.trim();
    }
  }

  const plan: Plan = {
    name: row.plan_name ?? row.plan_id,
    deductible,
    outOfPocketMax,
    coinsuranceRate: num(row.default_coinsurance) ?? 0,
    monthlyPremium,
    costSharing,
    inpatientCopayMaxDays: num(row.inpatient_copay_max_days),
  };

  return {
    plan,
    meta: {
      issuer: row.issuer,
      metal: row.metal,
      planType: row.plan_type,
      hsaEligible: truthy(row.hsa_eligible),
      sbcUrl: row.sbc_url,
      freePcpVisits: num(row.free_pcp_visits) ?? null,
      premiumArea2: num(row.monthly_premium_area2) ?? null,
      outsideCeiling,
      limits,
      exclusions,
    },
  };
}

export function loadPlans(rows: PlanRow[]): LoadedPlan[] {
  const out: LoadedPlan[] = [];
  for (const row of rows) {
    const loaded = loadPlan(row);
    if (loaded) out.push(loaded);
  }
  return out;
}

/**
 * Build a Plan from the four numbers on an insurance card.
 *
 * This is the path for the ~165 million people on employer coverage, for whom
 * no public dataset exists. With no per-benefit rules, every service falls
 * back to the plan's coinsurance after the deductible, which is the right
 * default and should be labelled as an estimate in the interface.
 */
export function planFromCard(input: {
  name?: string;
  deductible: number;
  coinsuranceRate: number;
  outOfPocketMax: number;
  monthlyPremium?: number;
}): Plan {
  return {
    name: input.name ?? "Your plan",
    deductible: input.deductible,
    coinsuranceRate: input.coinsuranceRate,
    outOfPocketMax: input.outOfPocketMax,
    monthlyPremium: input.monthlyPremium ?? 0,
    costSharing: {},
  };
}

/** Benefit names as they appear in the CMS files. Typos here are silent. */
export const BENEFIT = {
  PRIMARY_CARE: "Primary Care Visit to Treat an Injury or Illness",
  SPECIALIST: "Specialist Visit",
  PREVENTIVE: "Preventive Care/Screening/Immunization",
  URGENT_CARE: "Urgent Care Centers or Facilities",
  EMERGENCY_ROOM: "Emergency Room Services",
  AMBULANCE: "Emergency Transportation/Ambulance",
  IMAGING: "Imaging (CT/PET Scans, MRIs)",
  XRAY: "X-rays and Diagnostic Imaging",
  LAB: "Laboratory Outpatient and Professional Services",
  GENERIC_DRUGS: "Generic Drugs",
  BRAND_DRUGS: "Preferred Brand Drugs",
  SPECIALTY_DRUGS: "Specialty Drugs",
  INPATIENT: "Inpatient Physician and Surgical Services",
  OUTPATIENT_SURGERY: "Outpatient Surgery Physician/Surgical Services",
  MENTAL_HEALTH: "Mental/Behavioral Health Outpatient Services",
} as const;
