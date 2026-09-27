/**
 * Ask Parse: a Gemini agent with real tools.
 *
 * The model decides which tool to call; the tools are the app's own
 * deterministic systems (the cost engine, the benefits reader, Google Places
 * plus the CMS network check, the pharmacy pricer, the people directory).
 * Every tool returns money pre-formatted, the model may only repeat numbers
 * that a tool or the plan facts produced, and any sentence with a number that
 * didn't come from a tool is dropped. The interface renders each tool result
 * as a card from the tool's own data, not from the model's words.
 *
 * Server only.
 */

import { runYear, type CareEvent, type Plan } from "./engine";
import { generateRaw, type GeminiContent, type GeminiPart } from "./llm";
import { PRICES, applyPayer, type PriceKey } from "./prices";
import { benefitsFor, type CareCategory } from "./benefits";
import { eventCost, visitCost, visitDate } from "./care";
import { BENEFIT } from "./load-plans";
import { PEOPLE } from "./kb/people";
import { FAQ } from "./kb/faq";
import { searchPlaces } from "./places";
import { checkPlaces } from "./network";
import { fillOptions } from "./pharmacy";
import { drugsCovered } from "./marketplace";

export type AgentContext = {
  planName: string;
  issuer: string | null;
  planType: string | null;
  hiosId: string | null;
  zip: string;
  kind: "employer-or-parent" | "marketplace" | "medicaid" | "uninsured";
  memberPhone: string | null;
  plan: Plan;
  events: CareEvent[];
};

export type Card =
  | { type: "whatif"; data: { added: { label: string; date: string; you: number; plan: number }[]; before: number; after: number; ceiling: number; deductible: number; hitCeiling: boolean } }
  | { type: "providers"; data: { category: string; you: number; places: { name: string; address: string; rating: number | null; ratingCount: number | null; openNow: boolean | null; miles: number | null; network: string; phone: string | null; mapsUri: string | null; summary: string | null }[] } }
  | { type: "rx"; data: { drug: string; planYou: number | null; formulary: string | null; options: { title: string; price: number | null; counts: string; url: string | null }[] } }
  | { type: "plan"; data: { deductible: number; ceiling: number; coinsurance: number; spent: number; benefits: { label: string; text: string }[] } }
  | { type: "people"; data: { name: string; phone: string | null; url: string | null; when: string }[] };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const SERVICE_KEYS = Object.keys(PRICES) as PriceKey[];
const CATEGORIES: CareCategory[] = ["primary", "urgent", "er", "mental", "imaging", "orthopedics", "pharmacy", "lab"];
const CATEGORY_PRICE: Record<CareCategory, PriceKey> = {
  primary: "sickVisit",
  urgent: "urgentCare",
  er: "er",
  mental: "therapy",
  imaging: "mri",
  orthopedics: "specialist",
  pharmacy: "genericFill",
  lab: "labs",
};

// ---------------------------------------------------------------------------
// Tool declarations (what Gemini sees)

const TOOLS = [
  {
    name: "plan_summary",
    description: "The person's plan: deductible, out-of-pocket max, coinsurance, what they've spent so far this year, and what they pay for each benefit. Call this for any question about what the plan covers.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "what_if",
    description: `Run care through the person's real plan and year with the cost engine. Use for any 'what would X cost me' question. Services: ${SERVICE_KEYS.map((k) => `${k} (${PRICES[k].label})`).join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        events: {
          type: "array",
          description: "The care to add to their year.",
          items: {
            type: "object",
            properties: {
              service: { type: "string", enum: SERVICE_KEYS },
              month: { type: "integer", description: "1 to 12. Default to the current month if not said." },
              count: { type: "integer", description: "How many times, default 1, max 12." },
            },
            required: ["service"],
          },
        },
      },
      required: ["events"],
    },
  },
  {
    name: "find_care",
    description: "Find real places near the person for a kind of care, with Google ratings and review summaries, whether each is in their plan's network (from the federal directory, when the plan has a federal plan id), and what one visit costs them. Never use this to decide where someone should go for a symptom.",
    parameters: {
      type: "object",
      properties: { category: { type: "string", enum: CATEGORIES }, zip: { type: "string", description: "5-digit ZIP, default the person's." } },
      required: ["category"],
    },
  },
  {
    name: "drug_prices",
    description: "Compare ways to fill a prescription: through the plan (engine), Cost Plus Drugs, discount programs, manufacturer programs, and whether it's on the plan's formulary.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Drug and strength, e.g. 'sertraline 50 mg'." }, days: { type: "integer", description: "30, 60 or 90." } },
      required: ["query"],
    },
  },
  {
    name: "who_to_call",
    description: "Real people and phone numbers for a problem.",
    parameters: {
      type: "object",
      properties: { topics: { type: "array", items: { type: "string", enum: Object.keys(PEOPLE) } } },
      required: ["topics"],
    },
  },
];

const SYSTEM = (ctx: AgentContext) =>
  [
    "You are Parse, a deadpan, warm guide to US health insurance for a college student. You talk like a calm actuary with a dry sense of humor. Short sentences. No em dashes.",
    "You never give medical advice, never diagnose, never say where to go for a symptom. For emergencies, say call 911.",
    "Money rule: never state a dollar amount or percentage unless a tool returned it or it is in the plan facts below. Always call a tool for cost questions. Copy numbers exactly as the tool formatted them.",
    "After tools run, answer in two to four sentences. The app shows each tool's result as a card, so summarize, don't list everything.",
    "If a tool fails, say what you couldn't check and who can answer.",
    "Network status: call a place in network only if its network field says \"in network\". Anything else is unconfirmed, and you say to call before going. Don't recommend an unconfirmed place over an in-network one.",
    `Plan facts: ${ctx.planName}${ctx.issuer ? ` from ${ctx.issuer}` : ""}${ctx.planType ? `, ${ctx.planType}` : ""}. Deductible ${usd(ctx.plan.deductible)}, out-of-pocket max ${usd(ctx.plan.outOfPocketMax)}, ${Math.round(ctx.plan.coinsuranceRate * 100)}% coinsurance after the deductible. ZIP ${ctx.zip}. ${ctx.hiosId ? "Network checks are available." : "Network status can't be checked for this plan; tell them to call member services."}`,
    `Who regulates this plan (pass these as who_to_call topics, and say the full names, never the topic keys): ${
      ctx.kind === "marketplace"
        ? "an individual Marketplace plan, so topics insurer and moDci (the Missouri Department of Commerce and Insurance). Not ebsa."
        : ctx.kind === "medicaid"
          ? "MO HealthNet, so topic moHealthNet."
          : ctx.kind === "employer-or-parent"
            ? "a plan through someone's job. Fully insured plans go to moDci (the Missouri Department of Commerce and Insurance), self-funded ones to ebsa (the U.S. Department of Labor); HR knows which, so pass insurer, moDci and ebsa."
            : "none, they are uninsured, so topics billing and assistance."
    }`,
    `Checked answers you can use: ${FAQ.slice(0, 12)
      .map((f) => `Q: ${f.q} A: ${f.a}`)
      .join(" | ")}`,
  ].join("\n");

// ---------------------------------------------------------------------------
// Tool implementations

type ToolOut = { forModel: Record<string, unknown>; card?: Card };

function planSummary(ctx: AgentContext): ToolOut {
  const year = runYear(ctx.events, ctx.plan);
  const bens = benefitsFor(ctx.plan, ctx.events, ctx.kind !== "uninsured");
  const spent = year.patientTotal;
  return {
    forModel: {
      deductible: usd(ctx.plan.deductible),
      outOfPocketMax: usd(ctx.plan.outOfPocketMax),
      coinsuranceAfterDeductible: `${Math.round(ctx.plan.coinsuranceRate * 100)}%`,
      spentSoFarThisYear: usd(spent),
      benefits: bens.map((b) => ({ benefit: b.label, youPay: b.share.text, oneVisitToday: b.oneToday ? usd(b.oneToday.you) : null })),
    },
    card: { type: "plan", data: { deductible: ctx.plan.deductible, ceiling: ctx.plan.outOfPocketMax, coinsurance: ctx.plan.coinsuranceRate, spent, benefits: bens.map((b) => ({ label: b.label, text: b.share.text })) } },
  };
}

function whatIf(ctx: AgentContext, args: Record<string, unknown>): ToolOut {
  const now = new Date().getMonth() + 1;
  const raw = Array.isArray(args.events) ? args.events : [];
  const added: CareEvent[] = [];
  for (const r of raw.slice(0, 8)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const key = String(o.service ?? "") as PriceKey;
    if (!(key in PRICES)) continue;
    const month = Math.min(12, Math.max(1, Number(o.month) || now));
    const count = Math.min(12, Math.max(1, Number(o.count) || 1));
    for (let i = 0; i < count; i++) {
      const m = Math.min(12, month + (count > 1 ? i : 0));
      const p = PRICES[key];
      added.push({ date: `2026-${String(m).padStart(2, "0")}-15`, label: p.label, serviceType: p.serviceType, allowedAmount: p.typical, preventive: "preventive" in p && ctx.kind !== "uninsured" ? p.preventive : undefined });
    }
  }
  if (!added.length) return { forModel: { error: "No recognized services." } };
  const before = runYear(ctx.events, ctx.plan);
  const after = runYear([...ctx.events, ...added], ctx.plan);
  const rows = after.timeline.filter((r) => added.includes(r.event));
  const last = after.timeline[after.timeline.length - 1];
  const hit = after.timeline.some((r) => r.hitOutOfPocketMax);
  return {
    forModel: {
      added: rows.map((r) => ({ what: r.event.label, when: r.event.date, youPay: usd(r.patientPays), planPays: usd(r.planPays), priceBilled: usd(r.event.allowedAmount) })),
      yourYearBefore: usd(before.patientTotal),
      yourYearAfter: usd(after.patientTotal),
      extraForYou: usd(after.patientTotal - before.patientTotal),
      deductibleMetAfter: last?.after.deductibleMet ?? false,
      hitOutOfPocketMax: hit,
      priceSource: "MU Health Care negotiated rates and 2026 Medicare physician rates, applied through this plan's rules",
    },
    card: {
      type: "whatif",
      data: {
        added: rows.map((r) => ({ label: r.event.label, date: r.event.date, you: r.patientPays, plan: r.planPays })),
        before: before.patientTotal,
        after: after.patientTotal,
        ceiling: ctx.plan.outOfPocketMax,
        deductible: ctx.plan.deductible,
        hitCeiling: hit,
      },
    },
  };
}

async function findCare(ctx: AgentContext, args: Record<string, unknown>): Promise<ToolOut> {
  const category = CATEGORIES.includes(args.category as CareCategory) ? (args.category as CareCategory) : "primary";
  const zip = typeof args.zip === "string" && /^\d{5}$/.test(args.zip) ? args.zip : ctx.zip;
  const cost = visitCost(ctx.plan, ctx.events, CATEGORY_PRICE[category], visitDate(), { preventiveIsFree: ctx.kind !== "uninsured" });
  let places;
  try {
    places = (await searchPlaces({ category, zip, detail: "full" })).places;
  } catch (e) {
    return { forModel: { error: `Place search unavailable (${(e as Error).name}).`, oneVisitCostsYou: usd(cost.you) } };
  }
  let net: Record<string, string> = {};
  if (ctx.hiosId && places.length) {
    try {
      const res = await checkPlaces(ctx.hiosId, zip, places.slice(0, 8).map((p) => ({ id: p.id, name: p.name, address: p.address })));
      net = Object.fromEntries(res.map((r) => [r.id, r.coverage]));
    } catch {
      net = {};
    }
  }
  const label = (c?: string) => (c === "Covered" ? "in network" : c === "NotCovered" ? "not in network" : ctx.hiosId ? "not confirmed" : "call to confirm");
  const ranked = [...places]
    .sort((a, b) => {
      const s = (p: typeof a) => (net[p.id] === "Covered" ? 20 : net[p.id] === "NotCovered" ? -20 : 0) + (p.rating ?? 0) * Math.log10((p.ratingCount ?? 0) + 10) - (p.distanceMiles ?? 5) * 0.3;
      return s(b) - s(a);
    })
    .slice(0, 4);
  return {
    forModel: {
      oneVisitCostsYou: usd(cost.you),
      places: ranked.map((p) => ({ name: p.name, rating: p.rating, reviews: p.ratingCount, miles: p.distanceMiles?.toFixed(1) ?? null, network: label(net[p.id]), reviewSummary: p.reviewSummary?.text ?? null })),
    },
    card: {
      type: "providers",
      data: {
        category,
        you: cost.you,
        places: ranked.map((p) => ({
          name: p.name,
          address: p.address,
          rating: p.rating,
          ratingCount: p.ratingCount,
          openNow: p.openNow,
          miles: p.distanceMiles,
          network: label(net[p.id]),
          phone: p.phone,
          mapsUri: p.mapsUri,
          summary: p.reviewSummary?.text ?? null,
        })),
      },
    },
  };
}

async function drugPrices(ctx: AgentContext, args: Record<string, unknown>): Promise<ToolOut> {
  const query = String(args.query ?? "").slice(0, 80);
  const days = [30, 60, 90].includes(Number(args.days)) ? Number(args.days) : 30;
  const r = await fillOptions({ query, qty: days, daysSupply: days });
  if (!r.drug) return { forModel: { error: "Couldn't identify that drug. Ask for the generic name and strength." } };
  const ins = r.options.find((o) => o.kind === "insurance");
  let planYou: number | null = null;
  if (ins?.allowedAmountEstimate) {
    planYou = eventCost(ctx.plan, ctx.events, { date: visitDate(), label: r.drug.name, serviceType: r.drug.generic ? BENEFIT.GENERIC_DRUGS : BENEFIT.BRAND_DRUGS, allowedAmount: ins.allowedAmountEstimate }).you;
  }
  let formulary: string | null = null;
  if (ctx.hiosId) {
    try {
      formulary = (await drugsCovered([r.drug.rxcui], [ctx.hiosId]))[0]?.coverage ?? null;
    } catch {
      formulary = null;
    }
  }
  const opts = r.options.filter((o) => o.kind !== "insurance" && o.kind !== "nadac-benchmark").sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9)).slice(0, 4);
  return {
    forModel: {
      drug: r.drug.name,
      throughYourPlan: planYou === null ? null : usd(planYou),
      onFormulary: formulary,
      options: opts.map((o) => ({ where: o.title, price: o.price === null ? "varies" : usd(o.price), countsTowardDeductible: o.countsTowardDeductible })),
    },
    card: { type: "rx", data: { drug: r.drug.name, planYou, formulary, options: opts.map((o) => ({ title: o.title, price: o.price, counts: o.countsTowardDeductible, url: o.url })) } },
  };
}

function whoToCall(ctx: AgentContext, args: Record<string, unknown>): ToolOut {
  const topics = (Array.isArray(args.topics) ? args.topics : []).filter((t): t is string => typeof t === "string" && t in PEOPLE).slice(0, 3);
  const people = (topics.length ? topics : ["insurer"]).map((t) => PEOPLE[t]);
  const withPhone = people.map((p) => (p === PEOPLE.insurer && ctx.memberPhone ? { ...p, phone: ctx.memberPhone } : p));
  return {
    forModel: { people: withPhone.map((p) => ({ name: p.name, phone: p.phone, when: p.when })) },
    card: { type: "people", data: withPhone.map((p) => ({ name: p.name, phone: p.phone, url: p.url, when: p.when })) },
  };
}

async function runTool(ctx: AgentContext, name: string, args: Record<string, unknown>): Promise<ToolOut> {
  try {
    if (name === "plan_summary") return planSummary(ctx);
    if (name === "what_if") return whatIf(ctx, args);
    if (name === "find_care") return await findCare(ctx, args);
    if (name === "drug_prices") return await drugPrices(ctx, args);
    if (name === "who_to_call") return whoToCall(ctx, args);
    return { forModel: { error: `Unknown tool ${name}` } };
  } catch (e) {
    return { forModel: { error: `The ${name} tool failed: ${(e as Error).message.slice(0, 120)}` } };
  }
}

// ---------------------------------------------------------------------------
// The number guard

function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));
}

export function guard(text: string, allowedSource: string): string {
  const allowed = new Set(numbersIn(allowedSource));
  const sentences = text.replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  // Small counting words ("2 visits", "3 stars") are fine; money and percentages must be sourced.
  const ok = (s: string) =>
    (s.match(/\$\s?\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?\s?%/g) ?? []).every((m) => numbersIn(m).every((n) => allowed.has(n)));
  return sentences.filter(ok).join(" ").trim();
}

// ---------------------------------------------------------------------------
// The loop

export type Turn = { role: "user" | "model"; text: string };
export type AgentReply = { text: string; cards: Card[]; tools: string[] };

export async function runAgent(ctx: AgentContext, history: Turn[], question: string): Promise<AgentReply> {
  applyPayer(ctx.kind === "medicaid" || ctx.kind === "uninsured" ? null : ctx.issuer, ctx.kind === "marketplace");

  const contents: GeminiContent[] = [
    ...history.slice(-6).map((t) => ({ role: t.role, parts: [{ text: t.text.slice(0, 1200) }] })),
    { role: "user", parts: [{ text: question.slice(0, 800) }] },
  ];
  const cards: Card[] = [];
  const tools: string[] = [];
  let sourceText = SYSTEM(ctx);

  for (let step = 0; step < 5; step++) {
    const res = await generateRaw({
      systemInstruction: { parts: [{ text: SYSTEM(ctx) }] },
      contents,
      tools: [{ functionDeclarations: TOOLS }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 900 },
    });
    const content = res.candidates?.[0]?.content;
    const parts: GeminiPart[] = content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join(" ");
      return { text: guard(text, sourceText) || "I checked what I could; the cards below have the numbers.", cards, tools };
    }
    // Keep the model's turn exactly as sent (thought signatures included).
    contents.push({ role: "model", parts });
    const responses: GeminiPart[] = [];
    for (const c of calls) {
      const name = c.functionCall!.name;
      const out = await runTool(ctx, name, c.functionCall!.args ?? {});
      tools.push(name);
      if (out.card) cards.push(out.card);
      sourceText += " " + JSON.stringify(out.forModel);
      responses.push({ functionResponse: { name, response: out.forModel, ...(c.functionCall!.id ? { id: c.functionCall!.id } : {}) } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { text: "That took more steps than I allow myself. Here's what I found.", cards, tools };
}
