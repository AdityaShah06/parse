"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { CareEvent } from "@/lib/engine";
import type { MyPlan } from "@/lib/my-plan";
import type { Card } from "@/lib/agent";
import type { CareCategory } from "@/lib/benefits";
import { usd } from "@/lib/catalog";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import { useTheme } from "./theme";
import { speak } from "./voice";
import { Icon } from "../ui";

type Msg = { role: "user" | "model"; text: string; cards?: Card[]; tools?: string[] };

const EASE = [0.23, 1, 0.32, 1] as const;

const TOOL_LABEL: Record<string, string> = {
  plan_summary: "Read your plan",
  what_if: "Ran it through your year",
  find_care: "Searched Google Maps and the federal network directory",
  drug_prices: "Priced it at pharmacies",
  who_to_call: "Found who to call",
};

const WORKING = ["Reading your plan.", "Running the numbers.", "Checking what's real.", "Almost there."];

/**
 * Room: Ask. Not a chatbot: an agent whose tools are the app itself. Every
 * number in an answer came out of a tool (the engine, Google, CMS, the
 * pharmacy pricer), and each tool's result shows up as a card.
 */
export default function Agent({ my, events, zip, goCare }: { my: MyPlan; events: CareEvent[]; zip: string; goCare: (c: CareCategory) => void }) {
  const [theme] = useTheme();
  const night = theme === "night";
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [workStep, setWorkStep] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  const suggestions = [
    "What if I tear my ACL in March?",
    my.hiosId ? "Find a therapist who takes my plan" : "Find a therapist near me",
    "How much is sertraline 50 mg for me?",
    "What do I pay for urgent care?",
    "My claim got denied. Who do I call?",
  ];

  useEffect(() => {
    if (!busy) return;
    setWorkStep(0);
    const t = setInterval(() => setWorkStep((s) => Math.min(s + 1, WORKING.length - 1)), 1400);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          history,
          context: { planName: my.name, issuer: my.issuer, planType: my.planType, hiosId: my.hiosId, zip, kind: my.kind, memberPhone: my.memberPhone, plan: my.plan, events },
        }),
      });
      const j = await res.json();
      const text = j.ok ? j.text : "Something went wrong on my end. Try again in a moment.";
      setMsgs((m) => [...m, { role: "model", text, cards: j.cards ?? [], tools: j.tools ?? [] }]);
      speak(text);
    } catch {
      setMsgs((m) => [...m, { role: "model", text: "I couldn't reach the server. Is it still running?" }]);
    }
    setBusy(false);
  }

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={busy ? "thinking" : "calm"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic lines={["Ask me anything about your plan.", "I answer in receipts, not vibes."]} size="lg" />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="min-h-[360px] max-h-[62vh] overflow-y-auto p-5 sm:p-7 space-y-6">
          {msgs.length === 0 && (
            <div className="text-dim text-[15px] max-w-xl">
              I can run anything through your year, find places that take {my.name}, price a prescription five ways, and tell you who to call. I won&rsquo;t give medical advice.
            </div>
          )}
          <AnimatePresence initial={false}>
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                  <div className="max-w-[80%] rounded-[20px] rounded-br-md bg-ink text-paper px-4 py-2.5 text-[15px]">{m.text}</div>
                </motion.div>
              ) : (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="space-y-3">
                  <div className="flex gap-3">
                    <span className="mt-1 size-6 shrink-0 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, var(--mint), var(--moss) 75%)" }} />
                    <p className="text-[15.5px] leading-relaxed max-w-2xl">{m.text}</p>
                  </div>
                  {m.tools && m.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pl-9">
                      {[...new Set(m.tools)].map((t) => (
                        <span key={t} className="rounded-full border border-line text-faint text-[11.5px] px-2.5 py-0.5">
                          {TOOL_LABEL[t] ?? t}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.cards && m.cards.length > 0 && (
                    <div className="grid gap-3 pl-9 lg:grid-cols-2">
                      {m.cards.map((c, k) => (
                        <CardView key={k} c={c} goCare={goCare} />
                      ))}
                    </div>
                  )}
                </motion.div>
              )
            )}
          </AnimatePresence>
          {busy && (
            <div className="flex items-center gap-3 text-dim text-[14px]">
              <motion.span className="size-6 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, var(--mint), var(--moss) 75%)" }} animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1, repeat: Infinity }} />
              <AnimatePresence mode="wait">
                <motion.span key={workStep} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                  {WORKING[workStep]}
                </motion.span>
              </AnimatePresence>
            </div>
          )}
          <div ref={end} />
        </div>

        <div className="border-t border-line p-4 space-y-3">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {suggestions.map((s) => (
              <button key={s} type="button" disabled={busy} onClick={() => ask(s)} className="shrink-0 rounded-full border border-line h-9 px-3.5 text-[13px] text-dim hover:text-ink hover:bg-surface disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What would a broken wrist cost me in May?" className="flex-1 h-12 rounded-full border border-line bg-surface px-5 text-[15px]" aria-label="Your question" />
            <button type="submit" disabled={busy || !draft.trim()} className="h-12 w-12 rounded-full bg-ink text-paper grid place-items-center disabled:opacity-40" aria-label="Ask">
              →
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.45, ease: EASE }} className="card-quiet p-4">
      <div className="eyebrow mb-3">{title}</div>
      {children}
    </motion.div>
  );
}

function netTone(n: string) {
  return n === "in network" ? "bg-sage text-moss" : n === "not in network" ? "bg-coral/15 text-coral" : "border border-line text-faint";
}

function CardView({ c, goCare }: { c: Card; goCare: (c: CareCategory) => void }) {
  if (c.type === "whatif") {
    const d = c.data;
    const pct = (v: number) => `${Math.min(100, (v / Math.max(1, d.ceiling)) * 100)}%`;
    return (
      <CardShell title="Run through your year">
        <div className="space-y-1.5 text-[13.5px]">
          {d.added.map((a, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="text-dim">
                {a.label} <span className="text-faint">{a.date.slice(5)}</span>
              </span>
              <span className="font-mono">
                {usd(a.you)} <span className="text-faint">you</span>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 h-2 rounded-full bg-line relative overflow-hidden">
          <motion.div className="absolute inset-y-0 left-0 bg-gold/70" initial={{ width: 0 }} animate={{ width: pct(d.before) }} transition={{ duration: 0.6 }} />
          <motion.div className="absolute inset-y-0 bg-coral" style={{ left: pct(d.before) }} initial={{ width: 0 }} animate={{ width: `calc(${pct(d.after)} - ${pct(d.before)})` }} transition={{ duration: 0.8, delay: 0.3 }} />
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-faint">
          <span>
            Your year: {usd(d.before)} → <span className="text-ink font-mono">{usd(d.after)}</span>
          </span>
          <span>ceiling {usd(d.ceiling)}</span>
        </div>
        {d.hitCeiling && <div className="mt-2 text-[12.5px] text-moss">You hit your out-of-pocket max. The plan pays the rest of the year.</div>}
      </CardShell>
    );
  }
  if (c.type === "providers") {
    const d = c.data;
    return (
      <CardShell title={`Near you · one visit costs you ${usd(d.you)}`}>
        <div className="space-y-3">
          {d.places.map((p) => (
            <div key={p.name + p.address} className="text-[13.5px]">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                <span className={`shrink-0 rounded-full text-[11px] px-2 py-0.5 ${netTone(p.network)}`}>{p.network}</span>
              </div>
              <div className="text-[12px] text-faint">
                {p.rating !== null ? `★ ${p.rating.toFixed(1)} (${p.ratingCount ?? 0})` : "no rating"}
                {p.miles !== null ? ` · ${p.miles.toFixed(1)} mi` : ""}
                {p.openNow !== null ? ` · ${p.openNow ? "open now" : "closed now"}` : ""}
                {p.phone && (
                  <>
                    {" · "}
                    <a href={`tel:${p.phone.replace(/\D/g, "")}`} className="underline">
                      {p.phone}
                    </a>
                  </>
                )}
              </div>
              {p.summary && <p className="text-[12.5px] text-dim mt-1 line-clamp-2">{p.summary}</p>}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => goCare(d.category as CareCategory)} className="mt-4 rounded-full bg-ink text-paper h-9 px-4 text-[13px] inline-flex items-center gap-2">
          <Icon name="pin" className="size-3.5" /> See them on the map
        </button>
        <div className="text-[10.5px] text-faint mt-2">Google Maps. Review summaries: Summarized with Gemini.</div>
      </CardShell>
    );
  }
  if (c.type === "rx") {
    const d = c.data;
    return (
      <CardShell title={d.drug}>
        {d.planYou !== null && (
          <div className="flex justify-between text-[13.5px] pb-2 mb-2 border-b border-line">
            <span>Through your plan</span>
            <span className="font-mono">{usd(d.planYou)}</span>
          </div>
        )}
        {d.formulary && <div className="text-[12px] mb-2 text-dim">Formulary: {d.formulary === "Covered" ? "covered" : d.formulary === "NotCovered" ? "not covered" : d.formulary === "GenericCovered" ? "generic covered" : "not reported"}</div>}
        <div className="space-y-1.5 text-[13.5px]">
          {d.options.map((o) => (
            <div key={o.title} className="flex justify-between gap-3">
              <span className="text-dim truncate">{o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="hover:underline">{o.title}</a> : o.title}</span>
              <span className="font-mono shrink-0">{o.price === null ? "varies" : usd(o.price)}</span>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-faint mt-3">Cash purchases usually don&rsquo;t count toward your deductible.</div>
      </CardShell>
    );
  }
  if (c.type === "plan") {
    const d = c.data;
    return (
      <CardShell title="Your plan">
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            ["Deductible", usd(d.deductible)],
            ["Ceiling", usd(d.ceiling)],
            ["Spent so far", usd(d.spent)],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="font-serif text-[1.4rem] leading-none">{v}</div>
              <div className="text-[11px] text-faint mt-1">{k}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 text-[12.5px]">
          {d.benefits.slice(0, 7).map((b) => (
            <div key={b.label} className="flex justify-between gap-3">
              <span className="text-dim">{b.label}</span>
              <span className="font-mono">{b.text}</span>
            </div>
          ))}
        </div>
      </CardShell>
    );
  }
  return (
    <CardShell title="Real people">
      <div className="space-y-2 text-[13.5px]">
        {c.data.map((p) => (
          <div key={p.name} className="flex justify-between gap-3">
            <span>{p.name}</span>
            {p.phone ? (
              <a href={`tel:${p.phone.replace(/\D/g, "")}`} className="font-mono underline shrink-0">
                {p.phone}
              </a>
            ) : p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer" className="underline shrink-0">
                Website
              </a>
            ) : (
              <span className="text-faint shrink-0">On your card</span>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  );
}
