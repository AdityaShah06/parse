import { NextResponse } from "next/server";
import { ApiError, NoKey, extractJson } from "@/lib/llm";
import { cached } from "@/lib/server-cache";

export const runtime = "nodejs";

/**
 * POST /api/plan-explain { facts }
 * Gemini reads the plan facts the app already computed and explains them in
 * plain words. It may quote a number only if that exact number is in the
 * facts; any sentence with a number that isn't there is thrown away. So the
 * AI adds judgment and language, never figures.
 */

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One short sentence, the plan in a nutshell, deadpan and plain. Under 14 words." },
    summary: { type: "string", description: "Two or three sentences: what kind of plan this is and how it behaves in a normal year and a bad year." },
    bestFor: { type: "string", description: "One sentence: who this plan works well for." },
    watchOut: { type: "string", description: "One sentence: the single biggest thing to be careful about." },
    moves: {
      type: "array",
      description: "Three to five concrete things this person should do to get the most out of this plan, most valuable first.",
      items: {
        type: "object",
        properties: { benefit: { type: "string", description: "The benefit key it relates to, from the facts, or 'general'." }, text: { type: "string", description: "One sentence, an action." } },
        required: ["benefit", "text"],
      },
    },
  },
  required: ["headline", "summary", "bestFor", "watchOut", "moves"],
};

const SYSTEM = [
  "You explain one US health insurance plan to a college student who has never read one.",
  "Use only the facts given. Do not invent benefits, prices, networks or rules.",
  "If you use a number, copy it exactly as it appears in the facts, in digits (write 20%, never twenty percent). Never compute a new number.",
  "No medical advice. No em dashes. Short sentences. Friendly, a little dry, never cute.",
].join(" ");

function numbersIn(s: string): string[] {
  return (s.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((n) => n.replace(/[$,]/g, ""));
}

function clean(text: unknown, allowed: Set<string>): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\u2014/g, ", ").trim();
  if (!t) return null;
  // Keep only sentences whose numbers all appear in the facts.
  const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => numbersIn(s).every((n) => allowed.has(n)));
  return sentences.length ? sentences.join(" ").slice(0, 600) : null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { facts?: unknown } | null;
  const facts = body?.facts;
  if (!facts || typeof facts !== "object") return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  const factsText = JSON.stringify(facts).slice(0, 8000);
  const allowed = new Set(numbersIn(factsText));

  try {
    const out = await cached("plan-explain", SYSTEM + factsText,7 * 24 * 3600 * 1000, async () => {
      const raw = (await extractJson({ system: SYSTEM, schema: SCHEMA, maxTokens: 900, parts: [{ text: `Facts about this plan (JSON):\n${factsText}` }] })) as Record<string, unknown>;
      const moves = Array.isArray(raw.moves)
        ? raw.moves
            .map((m) => {
              const o = (m ?? {}) as Record<string, unknown>;
              const text = clean(o.text, allowed);
              return text ? { benefit: typeof o.benefit === "string" ? o.benefit.slice(0, 30) : "general", text } : null;
            })
            .filter(Boolean)
            .slice(0, 5)
        : [];
      return {
        headline: clean(raw.headline, allowed),
        summary: clean(raw.summary, allowed),
        bestFor: clean(raw.bestFor, allowed),
        watchOut: clean(raw.watchOut, allowed),
        moves,
      };
    });
    return NextResponse.json({ ok: true, explain: out, model: "gemini" });
  } catch (e) {
    if (e instanceof NoKey) return NextResponse.json({ ok: false, code: "no_key" }, { status: 503 });
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ ok: false, code: "api", status }, { status: 502 });
  }
}
