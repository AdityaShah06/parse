/**
 * A year built from a normal routine plus any number of unexpected events,
 * each in the month the visitor put it. Lists of care only; the engine does
 * every dollar.
 */

import type { CareEvent } from "./engine";
import { SURPRISES, buildYear, type HabitId } from "./scenarios";
import type { Picked } from "./app-state";

export const EVENT_COPY: Record<string, { label: string; line: string; emoji: string }> = {
  flu: { label: "The flu", line: "Urgent care and a swab.", emoji: "🤧" },
  ankle: { label: "Sprained ankle", line: "Stairs. It's always stairs.", emoji: "🦶" },
  wrist: { label: "Broken wrist", line: "ER, X-ray, two follow-ups.", emoji: "🦴" },
  acl: { label: "Torn ACL", line: "Pickup basketball. MRI and surgery.", emoji: "🏀" },
  appendix: { label: "Appendicitis", line: "Ambulance, ER, two nights.", emoji: "🚑" },
  crash: { label: "Car crash", line: "Ambulance, ER, four nights.", emoji: "🚗" },
};

export const EVENT_IDS = ["flu", "ankle", "wrist", "acl", "appendix", "crash"] as const;

export function buildStress(
  habits: HabitId[],
  picked: Picked[],
  oon: boolean,
  preventiveIsFree: boolean
): { events: CareEvent[]; origin: Map<CareEvent, string> } {
  const base = buildYear(habits, SURPRISES[0], 6, oon, { preventiveIsFree }).events;
  const origin = new Map<CareEvent, string>();
  const extra: CareEvent[] = [];
  for (const p of picked) {
    const s = SURPRISES.find((x) => x.id === p.id);
    if (!s) continue;
    for (const e of s.build(p.month, oon)) {
      const fixed = preventiveIsFree || !e.preventive ? e : { ...e, preventive: false };
      origin.set(fixed, p.id);
      extra.push(fixed);
    }
  }
  return { events: [...base, ...extra], origin };
}

/** 0 when nothing is spent, 1 at the out-of-pocket ceiling. Layout and mood only. */
export function stressOf(patientTotal: number, ceiling: number): number {
  if (!Number.isFinite(ceiling)) return Math.min(1, patientTotal / 20000);
  if (ceiling <= 0) return 0;
  return Math.min(1, patientTotal / ceiling);
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
