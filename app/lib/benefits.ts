/**
 * Your benefits, in plain words, with what to do about each one.
 *
 * Everything here is deterministic: the wording is built from the plan's own
 * cost sharing (the same map the engine uses), and any dollar figure for "one
 * visit today" comes from the engine through visitCost. The AI explains the
 * plan elsewhere; it never produces these numbers.
 */

import type { CareEvent, Plan } from "./engine";
import type { CostShare } from "./parse-cost-share";
import { BENEFIT } from "./load-plans";
import type { PriceKey } from "./prices";
import { visitCost, visitDate } from "./care";

export type BenefitKey =
  | "preventive"
  | "primary"
  | "specialist"
  | "mental"
  | "urgent"
  | "er"
  | "ambulance"
  | "labs"
  | "xray"
  | "imaging"
  | "generic"
  | "brand"
  | "specialty"
  | "outpatientSurgery"
  | "inpatient";

/** Keys match lib/places.ts BenefitCategory so a benefit can open Find care. */
export type CareCategory = "primary" | "urgent" | "er" | "mental" | "imaging" | "orthopedics" | "pharmacy" | "lab";

type Def = {
  key: BenefitKey;
  benefit: string;
  label: string;
  /** What it is, in one line, for someone who has never read a plan. */
  what: string;
  category?: CareCategory;
  price?: PriceKey;
  group: "everyday" | "tests" | "drugs" | "big";
};

export const BENEFIT_DEFS: Def[] = [
  { key: "preventive", benefit: BENEFIT.PREVENTIVE, label: "Checkups and screenings", what: "Yearly physical, most vaccines, and screenings.", category: "primary", price: "physical", group: "everyday" },
  { key: "primary", benefit: BENEFIT.PRIMARY_CARE, label: "Doctor visit when sick", what: "A regular doctor for a cold, a rash, a sprain.", category: "primary", price: "sickVisit", group: "everyday" },
  { key: "mental", benefit: BENEFIT.MENTAL_HEALTH, label: "Therapy and counseling", what: "Outpatient mental health visits.", category: "mental", price: "therapy", group: "everyday" },
  { key: "urgent", benefit: BENEFIT.URGENT_CARE, label: "Urgent care", what: "Walk-in care for things that can't wait but aren't emergencies.", category: "urgent", price: "urgentCare", group: "everyday" },
  { key: "specialist", benefit: BENEFIT.SPECIALIST, label: "Specialist visit", what: "Dermatology, orthopedics, allergy and the like.", category: "orthopedics", price: "specialist", group: "everyday" },
  { key: "generic", benefit: BENEFIT.GENERIC_DRUGS, label: "Generic prescriptions", what: "Tier 1 drugs, a 30-day supply.", category: "pharmacy", price: "genericFill", group: "drugs" },
  { key: "brand", benefit: BENEFIT.BRAND_DRUGS, label: "Brand-name prescriptions", what: "Preferred brand drugs, a 30-day supply.", category: "pharmacy", price: "brandFill", group: "drugs" },
  { key: "specialty", benefit: BENEFIT.SPECIALTY_DRUGS, label: "Specialty drugs", what: "High-cost drugs like biologics.", category: "pharmacy", group: "drugs" },
  { key: "labs", benefit: BENEFIT.LAB, label: "Blood work and labs", what: "Lab tests your doctor orders.", category: "lab", price: "labs", group: "tests" },
  { key: "xray", benefit: BENEFIT.XRAY, label: "X-rays", what: "X-rays and basic diagnostic imaging.", category: "imaging", price: "xray", group: "tests" },
  { key: "imaging", benefit: BENEFIT.IMAGING, label: "MRI and CT scans", what: "Advanced imaging.", category: "imaging", price: "mri", group: "tests" },
  { key: "er", benefit: BENEFIT.EMERGENCY_ROOM, label: "Emergency room", what: "The ER, for real emergencies.", category: "er", price: "er", group: "big" },
  { key: "ambulance", benefit: BENEFIT.AMBULANCE, label: "Ambulance", what: "Emergency ground transport.", price: "ambulance", group: "big" },
  { key: "outpatientSurgery", benefit: BENEFIT.OUTPATIENT_SURGERY, label: "Outpatient surgery", what: "Surgery where you go home the same day.", price: "kneeSurgery", group: "big" },
  { key: "inpatient", benefit: BENEFIT.INPATIENT, label: "Hospital stay", what: "Admitted to the hospital overnight or longer.", price: "appendectomy", group: "big" },
];

export type ShareText = {
  /** "$50 a visit", "50% after deductible", "Free". */
  text: string;
  free: boolean;
  /** True when you pay this even before meeting the deductible. */
  beforeDeductible: boolean;
  /** True when the plan's default (deductible, then coinsurance) applies because nothing specific is printed. */
  byDefault: boolean;
  covered: boolean;
};

const pct = (r: number) => `${Math.round(r * 100)}%`;
const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function describeShare(cs: CostShare | undefined, plan: Plan, preventive = false, per = "a visit"): ShareText {
  if (!cs) {
    if (preventive) return { text: "Free in network", free: true, beforeDeductible: true, byDefault: true, covered: true };
    return {
      text: plan.coinsuranceRate === 0 ? "Free after deductible" : `${pct(plan.coinsuranceRate)} after deductible`,
      free: false,
      beforeDeductible: false,
      byDefault: true,
      covered: true,
    };
  }
  if (cs.kind === "notApplicable") {
    if (preventive) return { text: "Free in network", free: true, beforeDeductible: true, byDefault: true, covered: true };
    return { text: `${pct(plan.coinsuranceRate)} after deductible`, free: false, beforeDeductible: false, byDefault: true, covered: true };
  }
  if (cs.kind === "coinsurance") {
    if (cs.rate === 0) return { text: cs.afterDeductible ? "Free after deductible" : "Free", free: !cs.afterDeductible, beforeDeductible: !cs.afterDeductible, byDefault: false, covered: true };
    return {
      text: cs.afterDeductible ? `${pct(cs.rate)} after deductible` : `${pct(cs.rate)} of the bill, no deductible first`,
      free: false,
      beforeDeductible: !cs.afterDeductible,
      byDefault: false,
      covered: true,
    };
  }
  const unit = cs.unit === "day" ? " a day" : cs.unit === "stay" ? " a stay" : ` ${per}`;
  if (cs.amount === 0) return { text: cs.afterDeductible ? "Free after deductible" : "Free", free: !cs.afterDeductible, beforeDeductible: !cs.afterDeductible, byDefault: false, covered: true };
  return {
    text: `${usd0(cs.amount)}${unit}${cs.afterDeductible ? " after deductible" : ""}`,
    free: false,
    beforeDeductible: !cs.afterDeductible,
    byDefault: false,
    covered: true,
  };
}

export type BenefitView = Def & {
  share: ShareText;
  /** What one of these costs you today, from the engine, given the rest of your year. */
  oneToday: { you: number; plan: number } | null;
  tip: string;
};

function tipFor(key: BenefitKey, s: ShareText, plan: Plan, all: Partial<Record<BenefitKey, ShareText>>): string {
  const ded = usd0(plan.deductible);
  switch (key) {
    case "preventive":
      return s.free ? "Book the yearly checkup. It costs you nothing in network and it is the easiest way to find a doctor before you need one." : "Check which screenings are covered before you book.";
    case "primary":
      return s.beforeDeductible ? `A flat price even before your ${ded} deductible. Use it before small things become big ones.` : `Until you hit ${ded}, you pay the full price of each visit. Ask for the cash price if you have not met it.`;
    case "mental":
      return s.beforeDeductible ? "A set price per session from the first visit. Many therapists see people by video, which is usually covered the same way." : `Sessions count toward your ${ded} deductible first. Ask about sliding-scale fees while you work toward it.`;
    case "urgent": {
      const er = all.er;
      return er && !er.beforeDeductible ? "For anything that is not an emergency, urgent care is far cheaper than the ER on this plan." : "The right door for sprains, stitches and fevers after hours.";
    }
    case "specialist":
      return plan.name && /no referral/i.test(plan.name) ? "No referral needed on this plan. Confirm the specialist is in network first." : "Some plans need a referral from your regular doctor first. Ask before you book.";
    case "generic":
      return "Cash prices for generics are sometimes lower than your copay. The pharmacy room compares both, and says what counts toward your deductible.";
    case "brand":
      return "Ask about a generic first. For brand drugs, manufacturer programs can cut the price a lot.";
    case "specialty":
      return "Specialty drugs often need approval from the plan first (prior authorization). Start that early.";
    case "labs":
      return "Independent labs usually cost less than hospital labs for the same test. Ask where the sample is sent.";
    case "xray":
    case "imaging":
      return "Imaging centers usually charge far less than hospitals for the same scan. Price it before you book, and check for prior approval.";
    case "er":
      return "In a real emergency, go. Federal law protects you from surprise out-of-network bills at the ER itself.";
    case "ambulance":
      return "Ground ambulances are not covered by the federal surprise billing law. If one bills you the difference, appeal and ask for a hardship discount.";
    case "outpatientSurgery":
    case "inpatient":
      return `Big bills hit your ${ded} deductible first, then your share, and stop at your ${usd0(plan.outOfPocketMax)} out-of-pocket max.`;
  }
}

/**
 * All benefits for a plan, in display order. `baseEvents` is the person's
 * year so far, so "one today" reflects what they have already paid.
 */
export function benefitsFor(plan: Plan, baseEvents: CareEvent[] = [], preventiveIsFree = true): BenefitView[] {
  const shares: Partial<Record<BenefitKey, ShareText>> = {};
  for (const d of BENEFIT_DEFS) shares[d.key] = describeShare(plan.costSharing[d.benefit], plan, d.key === "preventive" && preventiveIsFree, d.group === "drugs" ? "a fill" : d.group === "tests" ? "a test" : "a visit");
  const date = visitDate();
  return BENEFIT_DEFS.map((d) => {
    const share = shares[d.key]!;
    let oneToday: BenefitView["oneToday"] = null;
    if (d.price) {
      try {
        const v = visitCost(plan, baseEvents, d.price, date, { preventiveIsFree });
        oneToday = { you: v.you, plan: v.plan };
      } catch {
        oneToday = null;
      }
    }
    return { ...d, share, oneToday, tip: tipFor(d.key, share, plan, shares) };
  });
}
