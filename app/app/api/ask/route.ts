import { NextResponse } from "next/server";
import { ApiError, NoKey, extractJson } from "@/lib/llm";
import { FAQ } from "@/lib/kb/faq";
import { PEOPLE } from "@/lib/kb/people";
import { FALLBACK_ANSWER, screen, scrubModelText } from "@/lib/guide";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Gemini and the CMS API can take tens of seconds; 60 is the ceiling on every Vercel plan.
export const maxDuration = 60;

const PEOPLE_IDS = Object.keys(PEOPLE);

const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Two to five plain sentences. No dollar amounts." },
    people: { type: "array", items: { type: "string", enum: PEOPLE_IDS }, description: "Who the reader should call, most useful first." },
    medical: { type: "boolean", description: "True if the question asks for medical advice, a diagnosis, or where to go for a symptom." },
  },
  required: ["answer", "people", "medical"],
};

const SYSTEM = `You are the guide inside a health insurance app for college students and young adults in Missouri.
Rules you never break:
- Never give medical advice, never diagnose, never say where to go for a symptom. If asked, set medical to true.
- Never write a dollar amount. Costs come from the app's calculator, not from you.
- Only state facts you are sure of about US health insurance. If unsure, say who can answer.
- Plain words, short sentences, no jargon without a one-line definition. No em dashes.
- Always pick at least one person to call from the list.

Checked answers you can build on:
${FAQ.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n")}

People you can route to (ids): ${PEOPLE_IDS.map((id) => `${id} = ${PEOPLE[id].name}`).join("; ")}.`;

/** POST { q, selfFunded? }. Screened locally first; Gemini only for what is left. */
export async function POST(req: Request) {
  const limited = await rateLimit(req, "agent");
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { q?: unknown; selfFunded?: unknown } | null;
  const q = typeof body?.q === "string" ? body.q.slice(0, 600).trim() : "";
  if (!q) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const local = screen(q);
  if (local) return NextResponse.json({ ok: true, answer: local });

  try {
    const raw = (await extractJson({
      system: SYSTEM,
      schema: SCHEMA,
      maxTokens: 600,
      parts: [{ text: `${q}\n\n(Their plan is ${body?.selfFunded === true ? "self-funded by an employer" : body?.selfFunded === false ? "fully insured" : "of unknown funding type"}.)` }],
    })) as { answer?: unknown; people?: unknown; medical?: unknown };

    if (raw.medical === true) return NextResponse.json({ ok: true, answer: screen("should i go symptom") });
    const text = typeof raw.answer === "string" ? scrubModelText(raw.answer) : "";
    const people = Array.isArray(raw.people) ? raw.people.filter((p): p is string => typeof p === "string" && p in PEOPLE).slice(0, 3) : [];
    if (!text) return NextResponse.json({ ok: true, answer: FALLBACK_ANSWER });
    return NextResponse.json({ ok: true, answer: { kind: "ai", text, people: people.length ? people : ["insurer"] } });
  } catch (e) {
    if (e instanceof NoKey) return NextResponse.json({ ok: true, answer: FALLBACK_ANSWER, code: "no_key" });
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ ok: true, answer: FALLBACK_ANSWER, code: "api", status });
  }
}
