/**
 * Preset people and the ladder of unexpected care.
 *
 * This file only builds lists of CareEvents. It never computes what anyone
 * pays; that happens in engine.ts.
 */

import type { CareEvent } from "./engine";
import { PRICES, AMBULANCE_BALANCE_BILL, type PriceKey } from "./prices";

type Planned = { key: PriceKey; month: number; day?: number };

function event(key: PriceKey, month: number, day = 10, extra: Partial<CareEvent> = {}): CareEvent {
  const p = PRICES[key];
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return {
    date: `2026-${mm}-${dd}`,
    label: p.label,
    serviceType: p.serviceType,
    allowedAmount: p.typical,
    preventive: "preventive" in p ? p.preventive : undefined,
    ...extra,
  };
}

const monthly = (key: PriceKey, day = 3): Planned[] =>
  Array.from({ length: 12 }, (_, i) => ({ key, month: i + 1, day }));

const twiceMonthly = (key: PriceKey): Planned[] =>
  Array.from({ length: 12 }, (_, i) => [
    { key, month: i + 1, day: 6 },
    { key, month: i + 1, day: 20 },
  ]).flat();

/**
 * Things a normal year can contain. Each habit is a list of planned visits.
 * The concierge offers these as chips; a persona is just a set of habits.
 */
export type HabitId =
  | "physical"
  | "sick"
  | "labs"
  | "therapy"
  | "generic"
  | "brand"
  | "specialist";

export const HABITS: { id: HabitId; label: string; planned: Planned[] }[] = [
  { id: "physical", label: "A yearly physical", planned: [{ key: "physical", month: 8, day: 14 }] },
  {
    id: "sick",
    label: "A couple of sick visits",
    planned: [
      { key: "sickVisit", month: 2, day: 9 },
      { key: "sickVisit", month: 11, day: 4 },
    ],
  },
  { id: "labs", label: "Blood work", planned: [{ key: "labs", month: 2, day: 9 }] },
  { id: "therapy", label: "Therapy twice a month", planned: twiceMonthly("therapy") },
  { id: "generic", label: "A daily generic prescription", planned: monthly("genericFill") },
  { id: "brand", label: "A daily brand-name prescription", planned: monthly("brandFill") },
  {
    id: "specialist",
    label: "A specialist twice a year",
    planned: [
      { key: "specialist", month: 3, day: 12 },
      { key: "specialist", month: 9, day: 12 },
    ],
  },
];

export type Persona = {
  id: string;
  name: string;
  blurb: string;
  habits: HabitId[];
};

export const PERSONAS: Persona[] = [
  {
    id: "maya",
    name: "Maya",
    blurb: "19, rarely sick. A physical and maybe one bad cold.",
    habits: ["physical", "sick", "labs"],
  },
  {
    id: "jordan",
    name: "Jordan",
    blurb: "20, therapy twice a month and a daily generic.",
    habits: ["physical", "therapy", "generic"],
  },
  {
    id: "sam",
    name: "Sam",
    blurb: "21, asthma. A specialist twice a year and a brand inhaler.",
    habits: ["physical", "specialist", "sick", "brand"],
  },
];

export type Surprise = {
  id: string;
  label: string;
  /** Events for the surprise, relative to the day it starts. */
  build: (month: number, ambulanceOutOfNetwork: boolean) => CareEvent[];
};

const ambulance = (month: number, oon: boolean): CareEvent =>
  event("ambulance", month, 14, oon ? { balanceBilled: AMBULANCE_BALANCE_BILL.amount } : {});

/**
 * Each notch is a concrete thing that happens to a person, not a dollar
 * amount. Order runs from mild to severe.
 */
export const SURPRISES: Surprise[] = [
  { id: "none", label: "Nothing unexpected", build: () => [] },
  {
    id: "flu",
    label: "Bad flu",
    build: (m) => [event("urgentCare", m, 14), event("labs", m, 14)],
  },
  {
    id: "ankle",
    label: "Sprained ankle",
    build: (m) => [
      event("urgentCare", m, 14),
      event("xray", m, 14),
      event("specialist", m, 21),
    ],
  },
  {
    id: "wrist",
    label: "Broken wrist",
    build: (m) => [
      event("er", m, 14),
      event("xray", m, 14),
      event("specialist", m, 18),
      event("specialist", m, 28),
    ],
  },
  {
    id: "acl",
    label: "Torn ACL",
    build: (m) => [
      event("specialist", m, 14),
      event("mri", m, 16),
      event("kneeSurgery", m, 26),
      event("specialist", m, 28),
    ],
  },
  {
    id: "appendix",
    label: "Appendicitis",
    build: (m, oon) => [
      ambulance(m, oon),
      event("er", m, 14),
      event("ctScan", m, 14),
      event("appendectomy", m, 14, { days: 2 }),
    ],
  },
  {
    id: "crash",
    label: "Car crash",
    build: (m, oon) => [
      ambulance(m, oon),
      event("er", m, 14),
      event("ctScan", m, 14),
      event("traumaStay", m, 14, { days: 4 }),
    ],
  },
];

export function buildYear(
  habits: HabitId[],
  surprise: Surprise,
  surpriseMonth: number,
  ambulanceOutOfNetwork: boolean,
  opts: { preventiveIsFree?: boolean } = {}
): { events: CareEvent[]; unexpected: Set<CareEvent> } {
  // Preventive care is free only on a plan (ACA section 2713). With no
  // insurance, a physical costs its full price like anything else.
  const free = opts.preventiveIsFree ?? true;
  const fix = (e: CareEvent): CareEvent => (free || !e.preventive ? e : { ...e, preventive: false });

  const planned = HABITS.filter((h) => habits.includes(h.id)).flatMap((h) =>
    h.planned.map((p) => fix(event(p.key, p.month, p.day)))
  );
  const extra = surprise.build(surpriseMonth, ambulanceOutOfNetwork).map(fix);
  // runYear sorts a copy of the array but keeps the same objects, so the
  // interface can recognise these in the timeline by identity.
  return { events: [...planned, ...extra], unexpected: new Set(extra) };
}

/** True when the surprise includes an ambulance, so the toggle is relevant. */
export const surpriseHasAmbulance = (s: Surprise) =>
  s.build(6, false).some((e) => e.label === PRICES.ambulance.label);
