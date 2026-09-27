/**
 * The guide's rules, before any AI sees a question.
 *
 * 1. Crisis words go straight to 988 and 911.
 * 2. Symptoms and "should I go" questions get a refusal and a nurse line.
 * 3. Anything the FAQ covers is answered from the FAQ.
 * Only what is left goes to Gemini, and its answer is screened again.
 */

import { FAQ, type Faq } from "./kb/faq";

export type GuideAnswer = {
  text: string;
  people: string[];
  room?: Faq["room"];
  kind: "crisis" | "medical" | "faq" | "ai" | "fallback";
  source?: string;
};

const CRISIS = /\b(suicid\w*|kill (myself|me)|end my life|self[- ]?harm|hurt (myself|me)|want to die|overdos\w*)\b/i;

const MEDICAL =
  /\b(symptom\w*|diagnos\w*|chest pain|can'?t breathe|trouble breathing|bleeding|fever|rash|pain in|hurts?|swollen|dizzy|vomit\w*|infection|pregnan\w*|dose|dosage|how much .* take|should i (go|see|take)|is it serious|is this (normal|serious)|what do i have|do i have)\b/i;

export const CRISIS_ANSWER: GuideAnswer = {
  kind: "crisis",
  text: "I'm glad you said something. You can call or text 988 any time to talk with someone right now, free. If you are in danger, call 911.",
  people: ["crisis", "emergency"],
};

export const MEDICAL_ANSWER: GuideAnswer = {
  kind: "medical",
  text: "I can't give medical advice or tell you where to go for a symptom. If you think it is an emergency, call 911 or go to the nearest ER. For anything else, your plan's nurse line can help you decide, any time of day. I can tell you what each option costs on your plan in Find care.",
  people: ["emergency", "nurse"],
  room: "care",
};

export const FALLBACK_ANSWER: GuideAnswer = {
  kind: "fallback",
  text: "I don't have a checked answer for that one yet. Your insurer's member services can answer anything about your specific plan, and the number is on the back of your card.",
  people: ["insurer"],
};

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** Best FAQ entry for a question, or null. Longer key matches weigh more. */
export function matchFaq(q: string): Faq | null {
  const s = norm(q);
  let best: Faq | null = null;
  let score = 0;
  for (const f of FAQ) {
    if (norm(f.q) === s) return f;
    const hits = f.keys.filter((k) => s.includes(k)).reduce((n, k) => n + k.split(" ").length, 0);
    if (hits > score) {
      score = hits;
      best = f;
    }
  }
  return score > 0 ? best : null;
}

/** The screen every question passes first. Null means "ask the model". */
export function screen(q: string): GuideAnswer | null {
  if (CRISIS.test(q)) return CRISIS_ANSWER;
  const faq = matchFaq(q);
  if (MEDICAL.test(q) && !faq) return MEDICAL_ANSWER;
  if (MEDICAL.test(q) && faq && /\b(should i|do i have|symptom|diagnos|dose)/i.test(q)) return MEDICAL_ANSWER;
  if (faq) return { kind: "faq", text: faq.a, people: faq.people, room: faq.room, source: faq.source };
  return null;
}

/**
 * Model answers may not carry dollar figures: money comes from the engine
 * only. Sentences with a dollar amount are dropped.
 */
export function scrubModelText(text: string): string {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !/\$\s?\d/.test(s));
  return kept.join(" ").replace(/\u2014/g, ", ").trim();
}
