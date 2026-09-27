/**
 * One description of "the plan you have" that every room reads: the engine
 * Plan plus who issues it, its type, and (when we can find it) the 14-character
 * HIOS plan id that unlocks CMS network and drug-coverage checks.
 *
 * An uploaded Summary of Benefits is matched to the CMS 2026 Missouri data by
 * plan name. When it matches, the benefit rows CMS publishes for that exact
 * plan fill in anything the card doesn't show; the visitor's confirmed numbers
 * always win.
 */

import type { Plan } from "./engine";
import { CATALOG, type CatalogPlan } from "./catalog";

export type MyPlan = {
  name: string;
  issuer: string | null;
  planType: string | null;
  network: string | null;
  /** 14-character HIOS plan id, or null for employer plans and unmatched uploads. */
  hiosId: string | null;
  memberPhone: string | null;
  sbcUrl: string | null;
  metal: string | null;
  hsa: boolean | null;
  plan: Plan;
  /** Where the benefit rows came from, for the footnote. */
  rowsFrom: "your document" | "CMS 2026 plan data" | "your document and CMS 2026 plan data" | "state program rules";
  kind: "employer-or-parent" | "marketplace" | "medicaid" | "uninsured";
  referralRequired?: boolean | null;
  coveragePeriod?: string | null;
  /** Printed exclusions ("Services your plan generally does NOT cover"). */
  excluded?: string[];
  otherCovered?: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Find the CMS catalog entry for a plan name printed on an SBC. */
export function matchCatalog(planName: string | null | undefined, issuer?: string | null): CatalogPlan | null {
  if (!planName) return null;
  const n = norm(planName);
  const exact = CATALOG.find((c) => norm(c.plan.name) === n);
  if (exact) return exact;
  const words = new Set(n.split(" ").filter((w) => w.length > 2));
  let best: { c: CatalogPlan; s: number } | null = null;
  for (const c of CATALOG) {
    if (issuer && c.meta.issuer && !norm(c.meta.issuer).split(" ").some((w) => norm(issuer).includes(w))) continue;
    const cw = norm(c.plan.name).split(" ").filter((w) => w.length > 2);
    const hit = cw.filter((w) => words.has(w)).length;
    const s = hit / Math.max(cw.length, words.size);
    if (!best || s > best.s) best = { c, s };
  }
  return best && best.s >= 0.8 ? best.c : null;
}

export const hiosOf = (variantId: string | null | undefined) => (variantId && /^\d{5}[A-Z]{2}\d{7}/.test(variantId) ? variantId.slice(0, 14) : null);

export function fromCatalog(c: CatalogPlan): MyPlan {
  return {
    name: c.plan.name,
    issuer: c.meta.issuer ?? null,
    planType: c.meta.planType ?? null,
    network: null,
    hiosId: hiosOf(c.id),
    memberPhone: null,
    sbcUrl: c.meta.sbcUrl ?? null,
    metal: c.meta.metal ?? null,
    hsa: c.meta.hsaEligible ?? null,
    plan: c.plan,
    rowsFrom: "CMS 2026 plan data",
    kind: "marketplace",
  };
}
