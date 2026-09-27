/**
 * Where the visitor is and what they have told us. Pure data, no money.
 */

import type { CardInput } from "./card";
import type { Decoded, PlanInfo } from "./decode";
import type { HabitId } from "./scenarios";
import { CHEAPEST_PREMIUM } from "./catalog";
import type { CareCategory } from "./benefits";
import type { LivePlan } from "./shop";

export type Door = "fixed" | "switch" | "medicaid" | "uninsured";
export type Stage = "intro" | "doors" | "decode" | "card" | "finder" | "app";
export type Room = "plan" | "year" | "plans" | "rx" | "care" | "ambulance" | "denied" | "ask";
export type Picked = { id: string; month: number };

export type Answers = {
  who: "me" | "partner" | "kids";
  use: "rare" | "some" | "lots";
  doctor: boolean;
  fear: "monthly" | "surprise";
};

export type AppState = {
  stage: Stage;
  door: Door | null;
  zip: string;
  decoded: Decoded | null;
  card: CardInput | null;
  info: PlanInfo | null;
  habits: HabitId[];
  picked: Picked[];
  oon: boolean;
  planId: string;
  answers: Answers | null;
  room: Room;
  /** Which benefit Find care should open on. */
  careCat: CareCategory | null;
  /** A live HealthCare.gov plan the visitor picked in Better plan. */
  live: LivePlan | null;
};

export const initialState = (): AppState => ({
  stage: "intro",
  door: null,
  zip: "65201",
  decoded: null,
  card: null,
  info: null,
  habits: ["physical", "sick"],
  picked: [],
  oon: false,
  planId: CHEAPEST_PREMIUM.id,
  answers: null,
  room: "plan",
  careCat: null,
  live: null,
});

export const HABITS_FOR_USE: Record<Answers["use"], HabitId[]> = {
  rare: ["physical", "sick"],
  some: ["physical", "sick", "labs", "specialist"],
  lots: ["physical", "therapy", "generic", "specialist"],
};

/** Default month each unexpected event lands in, spread through the year. */
export const DEFAULT_MONTH: Record<string, number> = {
  flu: 2,
  ankle: 4,
  wrist: 5,
  acl: 6,
  appendix: 9,
  crash: 11,
};

export type Action =
  | { type: "intro-done" }
  | { type: "door"; door: Door }
  | { type: "decoded"; decoded: Decoded }
  | { type: "confirm-card"; card: CardInput; info: PlanInfo }
  | { type: "answers"; answers: Answers; planId: string }
  | { type: "choose-plan"; planId: string }
  | { type: "room"; room: Room }
  | { type: "find-care"; category: CareCategory }
  | { type: "choose-live"; plan: LivePlan; answers: Answers }
  | { type: "toggle-event"; id: string }
  | { type: "move-event"; id: string; month: number }
  | { type: "clear-events" }
  | { type: "toggle-habit"; id: HabitId }
  | { type: "oon"; value: boolean }
  | { type: "demo" }
  | { type: "restart" };

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "intro-done":
      return { ...s, stage: "doors" };
    case "door":
      if (a.door === "fixed") return { ...s, door: a.door, stage: "decode" };
      if (a.door === "switch") return { ...s, door: a.door, stage: "finder" };
      return { ...s, door: a.door, stage: "app", room: "plan" };
    case "decoded":
      return { ...s, decoded: a.decoded, stage: "card" };
    case "confirm-card":
      return { ...s, card: a.card, info: a.info, stage: "app", room: "plan" };
    case "answers":
      return { ...s, answers: a.answers, habits: HABITS_FOR_USE[a.answers.use], planId: a.planId };
    case "choose-plan":
      return { ...s, planId: a.planId, stage: "app", room: "plan" };
    case "room":
      return { ...s, room: a.room, stage: "app" };
    case "choose-live":
      return { ...s, door: "switch", live: a.plan, answers: a.answers, habits: HABITS_FOR_USE[a.answers.use], zip: s.zip, stage: "app", room: "plan" };
    case "find-care":
      return { ...s, room: "care", careCat: a.category, stage: "app" };
    case "toggle-event":
      return s.picked.some((p) => p.id === a.id)
        ? { ...s, picked: s.picked.filter((p) => p.id !== a.id) }
        : { ...s, picked: [...s.picked, { id: a.id, month: DEFAULT_MONTH[a.id] ?? 6 }] };
    case "move-event":
      return { ...s, picked: s.picked.map((p) => (p.id === a.id ? { ...p, month: a.month } : p)) };
    case "clear-events":
      return { ...s, picked: [] };
    case "toggle-habit":
      return { ...s, habits: s.habits.includes(a.id) ? s.habits.filter((h) => h !== a.id) : [...s.habits, a.id] };
    case "oon":
      return { ...s, oon: a.value };
    case "demo":
      // The whole demo in one keystroke: the example plan, decoded and confirmed.
      return { ...s, stage: "decode", door: "fixed" };
    case "restart":
      return initialState();
  }
}
