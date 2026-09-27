/**
 * Find care: places near you and what a visit there costs on your plan.
 *
 * The provider list below is the offline set the Find care room ships with.
 * /api/places serves the same shape, so live data (NPI Registry, Google
 * Places) can replace it without touching the interface. Hospitals use their
 * real names and addresses and carry no rating. Clinics are illustrative.
 *
 * Prices are never here. A visit's cost is the engine's timeline entry for
 * that visit, run inside the rest of your year.
 */

import { runYear, type CareEvent, type Plan } from "./engine";
import { PRICES, type PriceKey } from "./prices";

export type CareKind = "er" | "urgent" | "primary" | "mental" | "imaging" | "specialist" | "pharmacy";

export type Provider = {
  id: string;
  name: string;
  kind: CareKind;
  address: string;
  /** Position on the Columbia map, in a 1000 by 700 box. */
  x: number;
  y: number;
  hours: string;
  network: "in" | "out" | "call";
  rating?: number;
  reviews?: number;
  /** What reviewers bring up most, in plain words. */
  summary?: string;
  highlights?: string[];
  phone?: string;
  open24?: boolean;
};

export const KIND_LABEL: Record<CareKind, string> = {
  er: "Emergency room",
  urgent: "Urgent care",
  primary: "Primary care",
  mental: "Mental health",
  imaging: "Imaging",
  specialist: "Orthopedics",
  pharmacy: "Pharmacy",
};

/** Which priced visit a provider of each kind stands for. */
export const KIND_VISIT: Record<CareKind, PriceKey> = {
  er: "er",
  urgent: "urgentCare",
  primary: "sickVisit",
  mental: "therapy",
  imaging: "mri",
  specialist: "specialist",
  pharmacy: "genericFill",
};

export const HOME = { x: 470, y: 352, label: "You" };

export const PROVIDERS: Provider[] = [
  {
    id: "uh",
    name: "University Hospital",
    kind: "er",
    address: "1 Hospital Dr, Columbia",
    x: 402,
    y: 468,
    hours: "Emergency room open 24 hours",
    network: "call",
    open24: true,
    highlights: ["Level I trauma center", "Emergencies get in-network cost sharing by federal law"],
  },
  {
    id: "boone",
    name: "Boone Hospital Center",
    kind: "er",
    address: "1600 E Broadway, Columbia",
    x: 618,
    y: 330,
    hours: "Emergency room open 24 hours",
    network: "call",
    open24: true,
    highlights: ["Emergencies get in-network cost sharing by federal law"],
  },
  {
    id: "hinkson",
    name: "Hinkson Family Medicine",
    kind: "primary",
    address: "Clark Ln, Columbia",
    x: 640,
    y: 228,
    hours: "Weekdays 7:30 to 5:30",
    network: "in",
    rating: 4.7,
    reviews: 312,
    summary:
      "Reviewers say appointments start on time and the doctors explain things without rushing. Several mention the front desk quoting costs before the visit. A few say same-day slots go fast.",
    highlights: ["Same-day sick visits", "Accepts new patients"],
  },
  {
    id: "stadium-uc",
    name: "Stadium Walk-In Clinic",
    kind: "urgent",
    address: "W Stadium Blvd, Columbia",
    x: 262,
    y: 474,
    hours: "Every day 8 to 8",
    network: "in",
    rating: 4.4,
    reviews: 528,
    summary:
      "Most reviews mention X-rays on site and waits under 45 minutes on weekdays. Weekend evenings are busier. People like that stitches and sprains are handled in one stop.",
    highlights: ["X-ray on site", "Open weekends"],
  },
  {
    id: "rockquarry-uc",
    name: "Rock Quarry Urgent Care",
    kind: "urgent",
    address: "Rock Quarry Rd, Columbia",
    x: 548,
    y: 586,
    hours: "Every day 9 to 9",
    network: "out",
    rating: 4.1,
    reviews: 206,
    summary:
      "Reviewers like the short waits. Several mention surprise bills after visits, which fits a clinic outside most networks. Call your plan before you go.",
    highlights: ["Short waits", "Out of network for many plans"],
  },
  {
    id: "flatbranch",
    name: "Flat Branch Counseling",
    kind: "mental",
    address: "S 5th St, Columbia",
    x: 444,
    y: 318,
    hours: "Weekdays 8 to 7, video visits",
    network: "in",
    rating: 4.8,
    reviews: 97,
    summary:
      "People describe therapists who listen and a quick intake. Several reviews mention evening and video appointments that fit a class schedule.",
    highlights: ["Evening appointments", "Video sessions"],
  },
  {
    id: "grindstone",
    name: "Grindstone Imaging Center",
    kind: "imaging",
    address: "Grindstone Pkwy, Columbia",
    x: 668,
    y: 520,
    hours: "Weekdays 7 to 7, Saturday mornings",
    network: "in",
    rating: 4.6,
    reviews: 143,
    summary:
      "Reviewers mention clear cash prices posted up front and MRI appointments within a few days. Staff call ahead to confirm what the plan will cover.",
    highlights: ["Cash prices posted", "MRI and CT"],
  },
  {
    id: "maplewood",
    name: "Maplewood Orthopedics",
    kind: "specialist",
    address: "Maplewood Dr, Columbia",
    x: 540,
    y: 452,
    hours: "Weekdays 8 to 5",
    network: "in",
    rating: 4.6,
    reviews: 188,
    summary:
      "Sports injuries come up in most reviews. People say the doctors walk through scans in plain words. Referrals may be needed on some plans.",
    highlights: ["Sports injuries", "Referral may be needed"],
  },
  {
    id: "parkade",
    name: "Parkade Primary Care",
    kind: "primary",
    address: "Business Loop 70, Columbia",
    x: 372,
    y: 236,
    hours: "Weekdays 8 to 4:30",
    network: "out",
    rating: 4.2,
    reviews: 154,
    summary:
      "Reviewers like the doctors but mention billing mix-ups with some insurers. Worth calling to confirm your plan first.",
    highlights: ["Out of network for many plans"],
  },
  {
    id: "ashpharm",
    name: "Ash Street Pharmacy",
    kind: "pharmacy",
    address: "Ash St, Columbia",
    x: 404,
    y: 344,
    hours: "Every day 9 to 9",
    network: "in",
    rating: 4.5,
    reviews: 221,
    summary:
      "Reviewers say pharmacists check cash prices against the insurance price without being asked. Refills are usually ready the same day.",
    highlights: ["Checks cash vs insurance", "Same-day refills"],
  },
];

/** Straight-line distance on the map, in miles. Display only. */
export const milesFromHome = (p: Provider) =>
  Math.round((Math.hypot(p.x - HOME.x, p.y - HOME.y) / 95) * 10) / 10;

/** Today's date, kept inside the 2026 plan year the engine models. */
export function visitDate(now = new Date()): string {
  const y = now.getFullYear();
  if (y < 2026) return "2026-01-15";
  if (y > 2026) return "2026-12-15";
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `2026-${mm}-${dd}`;
}

/**
 * What one more visit costs you, given everything else in your year. The
 * figure is the engine's own timeline entry for that visit, not a difference
 * computed here.
 */
export function visitCost(
  plan: Plan,
  baseEvents: CareEvent[],
  key: PriceKey,
  date: string,
  opts: { preventiveIsFree?: boolean; balanceBilled?: number } = {}
) {
  const p = PRICES[key];
  const visit: CareEvent = {
    date,
    label: p.label,
    serviceType: p.serviceType,
    allowedAmount: p.typical,
    preventive: "preventive" in p && opts.preventiveIsFree !== false ? p.preventive : undefined,
    balanceBilled: opts.balanceBilled,
  };
  return { ...eventCost(plan, baseEvents, visit), allowed: p.typical, label: p.label };
}

/** The engine's own result for one event, placed inside the rest of the year. */
export function eventCost(plan: Plan, baseEvents: CareEvent[], event: CareEvent) {
  const year = runYear([...baseEvents, event], plan);
  const row = year.timeline.find((r) => r.event === event)!;
  return { you: row.patientPays, plan: row.planPays, balanceBilled: row.balanceBilled };
}

/** The three front doors to care, priced the same way. */
export const SETTINGS: { key: PriceKey; title: string; icon: string; when: string; wait: string }[] = [
  {
    key: "telehealth",
    title: "Video visit",
    icon: "video",
    when: "From your phone. Many plans list a telehealth service on the member app.",
    wait: "Minutes",
  },
  {
    key: "urgentCare",
    title: "Urgent care",
    icon: "clock",
    when: "Walk in. Most are open evenings and weekends, many with X-ray on site.",
    wait: "Under an hour",
  },
  {
    key: "er",
    title: "Emergency room",
    icon: "shield",
    when: "Open 24 hours. If you think it is an emergency, go, or call 911.",
    wait: "Hours, unless it is serious",
  },
];
