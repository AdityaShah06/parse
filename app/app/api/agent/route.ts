import { NextResponse } from "next/server";
import { runAgent, type AgentContext, type Turn } from "@/lib/agent";
import { CRISIS_ANSWER, MEDICAL_ANSWER, matchFaq } from "@/lib/guide";
import { NoKey } from "@/lib/llm";
import { envLimit, spend } from "@/lib/server-cache";
import { PEOPLE } from "@/lib/kb/people";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Gemini and the CMS API can take tens of seconds; 60 is the ceiling on every Vercel plan.
export const maxDuration = 60;

const CRISIS = /\b(suicid\w*|kill (myself|me)|end my life|self[- ]?harm|hurt (myself|me)|want to die|overdos\w*)\b/i;
// Narrower than the old Ask room: "does my plan cover pregnancy" is an insurance question, "should I go to the ER" is not.
const MEDICAL = /\b(should i (go|see|take)|is (it|this) serious|is this normal|what do i have|do i have (a|an)\b|diagnos\w*|symptom\w*|dosage|how much .* should i take)\b/i;

const peopleCards = (ids: string[]) => [{ type: "people", data: ids.filter((i) => i in PEOPLE).map((i) => ({ name: PEOPLE[i].name, phone: PEOPLE[i].phone, url: PEOPLE[i].url, when: PEOPLE[i].when })) }];

/**
 * POST /api/agent { question, history: [{role, text}], context: AgentContext }
 * -> { ok, text, cards, tools }
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, "agent");
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { question?: unknown; history?: unknown; context?: AgentContext } | null;
  const q = typeof body?.question === "string" ? body.question.trim().slice(0, 800) : "";
  const ctx = body?.context;
  if (!q || !ctx || !ctx.plan || typeof ctx.plan.deductible !== "number") return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  if (CRISIS.test(q)) return NextResponse.json({ ok: true, text: CRISIS_ANSWER.text, cards: peopleCards(CRISIS_ANSWER.people), tools: [] });
  if (MEDICAL.test(q)) return NextResponse.json({ ok: true, text: MEDICAL_ANSWER.text, cards: peopleCards(MEDICAL_ANSWER.people), tools: [] });

  if (!(await spend("agent-turns", envLimit("AGENT_DAILY_LIMIT", 300)))) {
    return NextResponse.json({ ok: true, text: "I've answered a lot of questions today and hit my daily limit. Member services can help in the meantime.", cards: peopleCards(["insurer"]), tools: [] });
  }

  const history: Turn[] = Array.isArray(body?.history)
    ? (body!.history as Turn[]).filter((t) => t && (t.role === "user" || t.role === "model") && typeof t.text === "string").slice(-6)
    : [];
  const safeCtx: AgentContext = {
    planName: String(ctx.planName ?? "Your plan").slice(0, 120),
    issuer: ctx.issuer ? String(ctx.issuer).slice(0, 80) : null,
    planType: ctx.planType ? String(ctx.planType).slice(0, 20) : null,
    hiosId: typeof ctx.hiosId === "string" && /^\d{5}[A-Z]{2}\d{7}$/.test(ctx.hiosId) ? ctx.hiosId : null,
    zip: typeof ctx.zip === "string" && /^\d{5}$/.test(ctx.zip) ? ctx.zip : "65201",
    kind: ctx.kind,
    memberPhone: ctx.memberPhone ? String(ctx.memberPhone).slice(0, 30) : null,
    plan: ctx.plan,
    events: Array.isArray(ctx.events) ? ctx.events.slice(0, 80) : [],
  };

  try {
    const r = await runAgent(safeCtx, history, q);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const faq = matchFaq(q);
    const text = faq ? faq.a : "I couldn't reach my brain just now. Your insurer's member services can answer anything about your plan.";
    return NextResponse.json({ ok: true, text, cards: peopleCards(faq?.people ?? ["insurer"]), tools: [], code: e instanceof NoKey ? "no_key" : "api" });
  }
}
