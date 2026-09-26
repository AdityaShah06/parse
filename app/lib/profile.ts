/**
 * The concierge's state: where the visitor is in the conversation and what
 * they have told us so far. Pure data and a reducer, no money.
 */

import { COPAY_LABELS, emptyCard, type CardInput, type CopayKey } from "./card";
import type { Decoded, PlanInfo } from "./decode";
import { PERSONAS, type HabitId } from "./scenarios";
import { CHEAPEST_PREMIUM } from "./catalog";

export type StepId =
  | "welcome"
  | "zip"
  | "source"
  | "decode"
  | "confirm"
  | "deductible"
  | "coinsurance"
  | "ceiling"
  | "copays"
  | "premium"
  | "habits"
  | "surprise"
  | "done";

export type Source = "employer" | "student" | "marketplace" | "medicaid" | "uninsured";

/** Doors whose plan comes from a benefits summary or a card. */
export const readsPlan = (s: Source | null) => s === "employer" || s === "student";

export type Turn = { id: number; who: "ai" | "you"; text: string };

export type Profile = {
  step: StepId;
  zip: string | null;
  source: Source | null;
  card: CardInput;
  habits: HabitId[];
  surprise: number;
  month: number;
  oon: boolean;
  selectedPlanId: string;
  /** Finished question and answer pairs, oldest first. */
  transcript: Turn[];
  /** Set when a sample person was loaded instead of a real conversation. */
  personaId: string | null;
  /** A decoded plan summary waiting for the visitor to confirm it. */
  decoded: Decoded | null;
  /** Names and phone numbers from the plan summary, once confirmed. */
  planInfo: PlanInfo | null;
};

export const initialProfile = (): Profile => ({
  step: "welcome",
  zip: null,
  source: null,
  card: emptyCard(),
  habits: [],
  surprise: 0,
  month: 6,
  oon: false,
  selectedPlanId: CHEAPEST_PREMIUM.id,
  transcript: [],
  personaId: null,
  decoded: null,
  planInfo: null,
});

/** What the concierge says at each step. */
export const QUESTIONS: Record<StepId, string> = {
  welcome:
    "Hi. I'll show you what your health insurance actually costs you, before a bill ever shows up. Two minutes, no account, nothing saved.",
  zip: "First, where do you live? A ZIP code is enough.",
  source: "How are you covered right now?",
  decode:
    "Do you have your plan's Summary of Benefits? It's a PDF in your insurer's app or website, usually under Documents or Plan details. Hand it to me and I'll read it.",
  confirm:
    "Here's what your plan says. Check each number against the quote, fix anything I got wrong, then we'll run your year.",
  deductible:
    "Grab your insurance card, or your plan's page in the insurer's app. What's your deductible? That's the amount you pay in full before insurance starts sharing the bill.",
  coinsurance:
    "After the deductible, what share do you pay? It's usually written as a percent, like 20%.",
  ceiling:
    "What's your out-of-pocket maximum? That's the ceiling: once you've paid this much in a year, covered care stops costing you.",
  copays:
    "Does your card list any flat copays? Fill in the ones you see and skip the rest.",
  premium: "Do you pay a monthly premium for this plan?",
  habits:
    "Now, what does a normal year look like for you? Tap everything that fits. Watch the right side as you do.",
  surprise:
    "That's the year you can plan for. Insurance is really for the year you can't. Pick something that could go wrong.",
  done: "",
};

export type Action =
  | { type: "start" }
  | { type: "persona"; id: string }
  | { type: "zip"; zip: string }
  | { type: "source"; source: Source; label: string }
  | { type: "typeCard" }
  | { type: "decoded"; decoded: Decoded; label: string }
  | { type: "confirmDecoded"; card: CardInput; info: PlanInfo }
  | { type: "cardNumber"; field: "deductible" | "coinsurancePct" | "outOfPocketMax"; value: number | null }
  | { type: "copays"; copays: Partial<Record<CopayKey, number>> }
  | { type: "premium"; value: number | null; label: string }
  | { type: "toggleHabit"; id: HabitId }
  | { type: "habitsDone"; label: string }
  | { type: "surprise"; index: number }
  | { type: "month"; month: number }
  | { type: "oon"; value: boolean }
  | { type: "surpriseDone"; label: string }
  | { type: "selectPlan"; id: string }
  | { type: "restart" };

const MO_ZIP = /^6(3\d|4\d|5[0-8])\d\d$/;
export const isMissouriZip = (zip: string) => MO_ZIP.test(zip);

function answer(p: Profile, text: string, next: StepId): Profile {
  const id = p.transcript.length;
  return {
    ...p,
    step: next,
    transcript: [
      ...p.transcript,
      { id, who: "ai", text: QUESTIONS[p.step] },
      { id: id + 1, who: "you", text },
    ],
  };
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export function reducer(p: Profile, a: Action): Profile {
  switch (a.type) {
    case "restart":
      return initialProfile();

    case "start":
      return answer(p, "Let's go", "zip");

    case "persona": {
      const persona = PERSONAS.find((x) => x.id === a.id);
      if (!persona) return p;
      return {
        ...initialProfile(),
        step: "surprise",
        zip: "65201",
        source: "marketplace",
        habits: persona.habits,
        personaId: persona.id,
        transcript: [
          { id: 0, who: "ai", text: QUESTIONS.welcome },
          { id: 1, who: "you", text: `Show me ${persona.name}'s year` },
          { id: 2, who: "ai", text: `${persona.name} is ${persona.blurb.charAt(0).toLowerCase()}${persona.blurb.slice(1)} Lives in Columbia, buying a 2026 plan.` },
        ],
      };
    }

    case "zip":
      return { ...answer(p, a.zip, "source"), zip: a.zip };

    case "source":
      return {
        ...answer(p, a.label, readsPlan(a.source) ? "decode" : "habits"),
        source: a.source,
      };

    case "typeCard":
      return answer(p, "I'll type the numbers from my card", "deductible");

    case "decoded":
      return { ...answer(p, a.label, "confirm"), decoded: a.decoded };

    case "confirmDecoded":
      return {
        ...answer(p, "Looks right", "habits"),
        card: a.card,
        planInfo: a.info,
        decoded: null,
      };

    case "cardNumber": {
      const next: Record<typeof a.field, StepId> = {
        deductible: "coinsurance",
        coinsurancePct: "ceiling",
        outOfPocketMax: "copays",
      };
      const text =
        a.value === null
          ? "I don't know"
          : a.field === "coinsurancePct"
            ? `${a.value}%`
            : money(a.value);
      return { ...answer(p, text, next[a.field]), card: { ...p.card, [a.field]: a.value } };
    }

    case "copays": {
      const entries = Object.entries(a.copays);
      const text = entries.length
        ? entries.map(([k, v]) => `${COPAY_LABELS[k as CopayKey]} ${money(v as number)}`).join(", ")
        : "None listed";
      return { ...answer(p, text, "premium"), card: { ...p.card, copays: a.copays } };
    }

    case "premium":
      return { ...answer(p, a.label, "habits"), card: { ...p.card, monthlyPremium: a.value } };

    case "toggleHabit":
      return {
        ...p,
        habits: p.habits.includes(a.id) ? p.habits.filter((h) => h !== a.id) : [...p.habits, a.id],
      };

    case "habitsDone":
      return answer(p, a.label, "surprise");

    case "surprise":
      return { ...p, surprise: a.index };

    case "month":
      return { ...p, month: a.month };

    case "oon":
      return { ...p, oon: a.value };

    case "surpriseDone":
      return answer(p, a.label, "done");

    case "selectPlan":
      return { ...p, selectedPlanId: a.id };
  }
}
