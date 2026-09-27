"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { CareEvent, Plan, YearResult } from "@/lib/engine";
import { usd } from "@/lib/catalog";
import { PRICES, PRICE_METHOD, type PriceKey } from "@/lib/prices";
import { HABITS, surpriseHasAmbulance, SURPRISES } from "@/lib/scenarios";
import { visitCost, visitDate } from "@/lib/care";
import { EVENT_COPY, EVENT_IDS, MONTHS, stressOf } from "@/lib/year";
import type { Action, Picked } from "@/lib/app-state";
import Money from "../Money";
import BlossomTree from "./BlossomTree";
import Sphere, { type Mood } from "./Sphere";
import Kinetic from "./Kinetic";
import { setTheme, useTheme } from "./theme";

/**
 * Room 3: break your year on purpose. Pile things on and watch the receipt
 * print, the tree let go of its blossoms, the sky go from morning to night.
 * Every printed dollar is an engine field.
 */
export default function Stress({
  plan,
  year,
  origin,
  picked,
  habits,
  oon,
  dispatch,
  planName,
  uninsured,
}: {
  plan: Plan;
  year: YearResult;
  origin: Map<CareEvent, string>;
  picked: Picked[];
  habits: string[];
  oon: boolean;
  dispatch: Dispatch<Action>;
  planName: string;
  uninsured: boolean;
}) {
  const [theme] = useTheme();
  const night = theme === "night";
  const stress = stressOf(year.patientTotal, plan.outOfPocketMax);
  const ceiling = Number.isFinite(plan.outOfPocketMax);
  const last = year.timeline[year.timeline.length - 1];
  const maxed = ceiling && !!last && (year.timeline.some((r) => r.hitOutOfPocketMax) || last.after.outOfPocketSpent >= plan.outOfPocketMax);
  const deductibleMet = !!last && last.after.deductibleMet >= plan.deductible && Number.isFinite(plan.deductible);
  const metAt = year.timeline.find((r) => r.after.deductibleMet >= plan.deductible);

  const mood: Mood = maxed ? "shocked" : stress > 0.5 ? "sad" : stress > 0.15 ? "worried" : picked.length ? "calm" : "happy";

  // The first time the year crosses into real pain, the whole app goes to night.
  const wentDark = useRef(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wentDark.current && stress >= 0.7) {
      wentDark.current = true;
      const r = sceneRef.current?.getBoundingClientRect();
      setTimeout(() => setTheme("night", r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined), 900);
    }
  }, [stress]);

  const lines = maxed
    ? ["You hit your out-of-pocket max.", "Everything covered after this is on them. I'd celebrate, but I'm an actuary."]
    : deductibleMet && metAt
      ? [`You met your deductible in ${MONTHS[Number(metAt.event.date.slice(5, 7)) - 1]}.`, "Congratulations, I think. From here you split every bill."]
      : picked.length
        ? ["Still under the deductible.", "So far, you're paying for all of it. The plan is watching."]
        : ["A normal year. A checkup, a couple of colds.", "Boring. I love it. Now let's ruin it."];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={mood} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic lines={lines} size="md" stair={false} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] items-start">
        {/* The scene. */}
        <div ref={sceneRef} className="card relative overflow-hidden h-[520px] p-0">
          <Sky stress={stress} />
          <div className="absolute inset-x-0 bottom-0 h-[64%] sm:h-[78%]">
            <BlossomTree bloom={1 - stress} night={night || stress > 0.6} />
          </div>
          <div className="absolute left-6 top-6 right-6 flex flex-wrap items-start justify-between gap-4" style={{ color: stress > 0.55 ? "#f5f1e8" : "var(--ink)" }}>
            <div>
              <div className="text-[13px] opacity-75">You pay this year</div>
              <div className="font-serif text-6xl sm:text-7xl leading-none mt-1 tracking-[-0.03em]" style={{ color: stress > 0.55 ? "#ffb4a2" : "var(--coral)" }}>
                <Money value={year.patientTotal} />
              </div>
              <div className="text-[13px] opacity-75 mt-2">
                Plan pays <span className="font-mono">{usd(year.planTotal)}</span>
                {year.annualPremium > 0 && <> · premiums <span className="font-mono">{usd(year.annualPremium)}</span></>}
              </div>
            </div>
            <Meter plan={plan} spent={last?.after.outOfPocketSpent ?? 0} light={stress > 0.55} />
          </div>
          <AnimatePresence>
            {maxed && (
              <motion.div
                initial={{ opacity: 0, scale: 1.6, rotate: -18 }}
                animate={{ opacity: 1, scale: 1, rotate: -9 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
                className="absolute right-8 bottom-10 rounded-xl border-[3px] border-[#ffb4a2] text-[#ffb4a2] px-4 py-2 font-mono text-[13px] uppercase tracking-[0.14em] leading-tight"
              >
                Ceiling reached
                <span className="block text-[11px] normal-case tracking-normal opacity-80">the plan pays the rest</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Receipt year={year} origin={origin} planName={planName} maxed={maxed} />
      </div>

      {/* Pile it on. */}
      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
          <p className="text-[17px]">
            <span className="font-medium">Add something unfortunate.</span> <span className="text-dim">Tap as many as you like. Drag them on the timeline below.</span>
          </p>
          {picked.length > 0 && (
            <button type="button" onClick={() => dispatch({ type: "clear-events" })} className="text-[13.5px] text-dim hover:text-ink">
              Heal everything
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {EVENT_IDS.map((id, i) => {
            const on = picked.some((p) => p.id === id);
            return (
              <motion.button
                key={id}
                type="button"
                onClick={() => dispatch({ type: "toggle-event", id })}
                aria-pressed={on}
                whileTap={{ scale: 0.96 }}
                whileHover={{ y: -2 }}
                className={`relative text-left rounded-[18px] border p-3.5 min-h-[92px] transition-colors ${on ? "border-coral/60 bg-coral/10" : "border-line bg-surface/60 hover:border-line-strong"}`}
              >
                <div className="text-[15px] font-medium">{EVENT_COPY[id].label}</div>
                <div className="text-[12.5px] text-dim mt-1 leading-snug">{EVENT_COPY[id].line}</div>
                <span className={`absolute right-3 top-3 size-2 rounded-full ${on ? "bg-coral" : "bg-line-strong"}`} />
                <span className="sr-only">{i}</span>
              </motion.button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-faint mr-1">Your normal year:</span>
          {HABITS.map((h) => {
            const on = habits.includes(h.id);
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => dispatch({ type: "toggle-habit", id: h.id })}
                aria-pressed={on}
                className={`rounded-full px-3 py-1.5 border transition-colors ${on ? "border-moss/50 bg-sage text-ink" : "border-line text-dim hover:text-ink"}`}
              >
                {h.label}
              </button>
            );
          })}
          {picked.some((p) => surpriseHasAmbulance(SURPRISES.find((s) => s.id === p.id)!)) && (
            <label className="ml-auto flex items-center gap-2 text-dim cursor-pointer">
              <input type="checkbox" checked={oon} onChange={(e) => dispatch({ type: "oon", value: e.target.checked })} className="accent-[var(--coral)]" />
              The ambulance was out of network
            </label>
          )}
        </div>
      </div>

      <Timeline plan={plan} year={year} origin={origin} picked={picked} dispatch={dispatch} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Menu plan={plan} events={year.timeline.map((r) => r.event)} uninsured={uninsured} />
        <Facts />
      </div>
    </section>
  );
}

/** Morning to night, crossfaded like one landscape photographed four times. */
function Sky({ stress }: { stress: number }) {
  const layers = [
    { from: 0, to: 0.3, bg: "linear-gradient(180deg, #fbf3df 0%, #eaf2e6 55%, #f5f1e8 100%)" },
    { from: 0.2, to: 0.55, bg: "linear-gradient(180deg, #cfe3ea 0%, #f2e8d2 60%, #f5ecdc 100%)" },
    { from: 0.45, to: 0.8, bg: "linear-gradient(180deg, #43406a 0%, #c9738a 45%, #f3b58f 80%, #f6d4b2 100%)" },
    { from: 0.7, to: 1.01, bg: "linear-gradient(180deg, #04100b 0%, #0b1f19 55%, #16302a 100%)" },
  ];
  const op = (l: (typeof layers)[number]) => {
    if (stress < l.from) return 0;
    const mid = (l.from + l.to) / 2;
    if (stress <= mid) return Math.min(1, (stress - l.from) / Math.max(0.05, mid - l.from) + (l.from === 0 ? 1 : 0));
    return l.to >= 1 ? 1 : Math.max(0, 1 - (stress - mid) / Math.max(0.05, l.to - mid));
  };
  return (
    <div className="absolute inset-0">
      {layers.map((l, i) => (
        <motion.div key={i} className="absolute inset-0" style={{ background: l.bg }} animate={{ opacity: i === 0 ? 1 : op(l) }} transition={{ duration: 1.2, ease: [0.23, 1, 0.32, 1] }} />
      ))}
      {/* Stars come out last. */}
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: Math.max(0, (stress - 0.72) * 3.5) }}
        transition={{ duration: 1.2 }}
        style={{ backgroundImage: "radial-gradient(1px 1px at 20% 18%, #fff, transparent), radial-gradient(1px 1px at 70% 12%, #fff, transparent), radial-gradient(1.5px 1.5px at 42% 30%, #fff, transparent), radial-gradient(1px 1px at 85% 34%, #fff, transparent), radial-gradient(1px 1px at 12% 40%, #fff, transparent), radial-gradient(1px 1px at 58% 8%, #fff, transparent)" }}
      />
      {/* A sun that sets. */}
      <motion.div
        className="absolute size-20 rounded-full blur-[1px]"
        style={{ right: "14%", background: "radial-gradient(circle, #fff6d8, #f6d48f 60%, transparent 70%)" }}
        animate={{ top: `${14 + stress * 90}%`, opacity: stress > 0.85 ? 0 : 1 }}
        transition={{ type: "spring", duration: 1.2, bounce: 0 }}
      />
    </div>
  );
}

function Meter({ plan, spent, light }: { plan: Plan; spent: number; light: boolean }) {
  if (!Number.isFinite(plan.outOfPocketMax)) {
    return <div className={`rounded-2xl px-4 py-3 text-[13px] max-w-[220px] ${light ? "bg-black/30" : "bg-surface/70"}`}>No insurance means no ceiling. Nothing stops this number.</div>;
  }
  const d = Math.min(1, plan.deductible / plan.outOfPocketMax);
  const s = Math.min(1, spent / plan.outOfPocketMax);
  return (
    <div className={`rounded-2xl px-4 py-3 w-[240px] backdrop-blur-md ${light ? "bg-black/25" : "bg-surface/70"}`}>
      <div className="flex justify-between text-[11.5px] opacity-80">
        <span>Toward your ceiling</span>
        <span className="font-mono">{usd(plan.outOfPocketMax)}</span>
      </div>
      <div className="relative h-2 mt-2 rounded-full bg-current/15 overflow-hidden" style={{ backgroundColor: light ? "rgb(255 255 255 / 0.18)" : "var(--line)" }}>
        <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: "var(--coral)" }} animate={{ width: `${s * 100}%` }} transition={{ type: "spring", duration: 0.8, bounce: 0 }} />
        <div className="absolute inset-y-0 w-[2px] bg-current opacity-60" style={{ left: `${d * 100}%` }} />
      </div>
      <div className="text-[11px] opacity-70 mt-1.5">Deductible <span className="font-mono">{usd(plan.deductible)}</span> at the tick</div>
    </div>
  );
}

/** The itemized year, printing as things happen. */
function Receipt({ year, origin, planName, maxed }: { year: YearResult; origin: Map<CareEvent, string>; planName: string; maxed: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const count = year.timeline.length;
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [count]);

  return (
    <div className="relative">
      <div className="mx-4 h-3 rounded-t-xl bg-ink/80" />
      <div className="receipt relative -mt-1 px-5 pt-5 pb-8 font-mono text-[12px] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.45)]">
        <div className="text-center">
          <div className="text-[13px] tracking-[0.3em]">PLAINLY</div>
          <div className="text-[10.5px] opacity-60 mt-1 truncate">{planName}</div>
          <div className="text-[10.5px] opacity-60">YEAR 2026 · ITEMIZED</div>
        </div>
        <div className="border-t border-dashed border-black/25 my-3" />
        <div className="grid grid-cols-[44px_1fr_64px_64px] gap-x-2 text-[10px] opacity-55 pb-1">
          <span>DATE</span>
          <span>ITEM</span>
          <span className="text-right">YOU</span>
          <span className="text-right">PLAN</span>
        </div>
        <div ref={scroller} className="max-h-[300px] overflow-y-auto no-scrollbar">
          <AnimatePresence initial={false}>
            {year.timeline.map((r) => {
              const unexpected = origin.has(r.event);
              const m = Number(r.event.date.slice(5, 7));
              const d = Number(r.event.date.slice(8, 10));
              return (
                <motion.div
                  key={`${r.event.date}-${r.event.label}-${origin.get(r.event) ?? "base"}`}
                  layout="position"
                  initial={{ opacity: 0, height: 0, filter: "blur(3px)" }}
                  animate={{ opacity: 1, height: "auto", filter: "blur(0px)" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
                  className={`grid grid-cols-[44px_1fr_64px_64px] gap-x-2 py-[3px] ${unexpected ? "font-bold" : ""}`}
                >
                  <span className="opacity-60">{MONTHS[m - 1]} {d}</span>
                  <span className="truncate">{r.event.label.toUpperCase()}</span>
                  <span className="text-right">{usd(r.patientPays)}</span>
                  <span className="text-right opacity-60">{usd(r.planPays)}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        <div className="border-t border-dashed border-black/25 my-3" />
        <div className="flex justify-between text-[13px] font-bold">
          <span>YOU PAY</span>
          <span>{usd(year.patientTotal)}</span>
        </div>
        <div className="flex justify-between opacity-70 mt-1">
          <span>PLAN PAYS</span>
          <span>{usd(year.planTotal)}</span>
        </div>
        {year.annualPremium > 0 && (
          <div className="flex justify-between opacity-70 mt-1">
            <span>PREMIUMS</span>
            <span>{usd(year.annualPremium)}</span>
          </div>
        )}
        <div className="text-center text-[10px] opacity-50 mt-4">{maxed ? "*** CEILING REACHED. THANK YOU FOR YOUR BUSINESS ***" : "*** KEEP THIS FOR YOUR RECORDS. NOBODY DOES ***"}</div>
      </div>
    </div>
  );
}

/**
 * The year on a timeline. The line is how much you have paid by each month
 * (layout only); the labeled pills are the unexpected events, draggable to a
 * different month, and the whole year re-runs as you drag.
 */
function Timeline({ plan, year, origin, picked, dispatch }: { plan: Plan; year: YearResult; origin: Map<CareEvent, string>; picked: Picked[]; dispatch: Dispatch<Action> }) {
  const W = 1000;
  const H = 220;
  const pad = { l: 16, r: 16, t: 18, b: 30 };
  const byMonth = useMemo(() => {
    const out = Array(12).fill(0);
    let run = 0;
    const perMonth = Array(12).fill(0);
    for (const r of year.timeline) perMonth[Number(r.event.date.slice(5, 7)) - 1] += r.patientPays;
    for (let m = 0; m < 12; m++) {
      run += perMonth[m];
      out[m] = run;
    }
    return out;
  }, [year]);
  const ceiling = Number.isFinite(plan.outOfPocketMax) ? plan.outOfPocketMax : 0;
  const top = Math.max(ceiling, byMonth[11], 1) * 1.08;
  const x = (m: number) => pad.l + ((m + 0.5) / 12) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const pts = [`${pad.l},${y(0)}`, ...byMonth.map((v, m) => `${x(m)},${y(v)}`)];
  const path = `M ${pts.join(" L ")}`;
  const area = `${path} L ${x(11)},${y(0)} Z`;

  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const monthAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const f = (clientX - r.left) / r.width;
    return Math.max(1, Math.min(12, Math.floor(f * 12) + 1));
  };

  return (
    <div className="card p-5 sm:p-6">
      <p className="text-[17px] mb-1">
        <span className="font-medium">When it happens matters.</span> <span className="text-dim">Your deductible resets every January. Drag an event to another month and watch.</span>
      </p>
      <div ref={box} className="relative mt-4 select-none touch-none">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px] sm:h-[230px]" preserveAspectRatio="none">
          {MONTHS.map((_, m) => (
            <line key={m} x1={x(m) - (W - pad.l - pad.r) / 24} x2={x(m) - (W - pad.l - pad.r) / 24} y1={pad.t} y2={H - pad.b} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
          ))}
          {ceiling > 0 && (
            <>
              <line x1={pad.l} x2={W - pad.r} y1={y(ceiling)} y2={y(ceiling)} stroke="var(--coral)" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
              <line x1={pad.l} x2={W - pad.r} y1={y(plan.deductible)} y2={y(plan.deductible)} stroke="var(--moss)" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />
            </>
          )}
          <motion.path d={area} animate={{ d: area }} transition={{ type: "spring", duration: 0.7, bounce: 0 }} fill="var(--coral)" opacity={0.12} />
          <motion.path d={path} animate={{ d: path }} transition={{ type: "spring", duration: 0.7, bounce: 0 }} fill="none" stroke="var(--coral)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {ceiling > 0 && (
          <>
            <div className="absolute right-2 text-[11px] text-coral bg-surface/80 rounded px-1.5" style={{ top: `calc(${(y(ceiling) / H) * 100}% - 18px)` }}>
              Ceiling <span className="font-mono">{usd(plan.outOfPocketMax)}</span>
            </div>
            <div className="absolute right-2 text-[11px] text-moss bg-surface/80 rounded px-1.5" style={{ top: `calc(${(y(plan.deductible) / H) * 100}% - 18px)` }}>
              Deductible <span className="font-mono">{usd(plan.deductible)}</span>
            </div>
          </>
        )}
        <div className="grid grid-cols-12 text-center text-[11px] text-faint -mt-5">
          {MONTHS.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
        {/* Draggable events. */}
        <div className="relative h-12 mt-3">
          {picked.map((p, i) => (
            <motion.button
              key={p.id}
              type="button"
              layout
              transition={{ type: "spring", duration: 0.4, bounce: 0 }}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setDragging(p.id);
              }}
              onPointerMove={(e) => {
                if (dragging !== p.id) return;
                const m = monthAt(e.clientX);
                if (m !== p.month) dispatch({ type: "move-event", id: p.id, month: m });
              }}
              onPointerUp={() => setDragging(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") dispatch({ type: "move-event", id: p.id, month: Math.max(1, p.month - 1) });
                if (e.key === "ArrowRight") dispatch({ type: "move-event", id: p.id, month: Math.min(12, p.month + 1) });
              }}
              aria-label={`${EVENT_COPY[p.id].label}, in ${MONTHS[p.month - 1]}. Use arrow keys to move.`}
              className={`absolute -translate-x-1/2 whitespace-nowrap rounded-full px-3 h-8 text-[12.5px] border cursor-grab active:cursor-grabbing ${dragging === p.id ? "bg-coral text-paper border-coral scale-105" : "bg-surface border-coral/50 text-ink"}`}
              style={{ left: `${((p.month - 0.5) / 12) * 100}%`, top: (i % 2) * 18 }}
            >
              {EVENT_COPY[p.id].label}
            </motion.button>
          ))}
          {picked.length === 0 && <div className="text-[13px] text-faint pt-2">Add something unfortunate above to put it on the timeline.</div>}
        </div>
      </div>
      <span className="sr-only">{origin.size}</span>
    </div>
  );
}

/** Everything a clinic can bill you for, and your share of it today. */
function Menu({ plan, events, uninsured }: { plan: Plan; events: CareEvent[]; uninsured: boolean }) {
  const date = useMemo(() => visitDate(), []);
  const keys = Object.keys(PRICES) as PriceKey[];
  const rows = useMemo(
    () => keys.map((k) => ({ k, p: PRICES[k], c: visitCost(plan, events, k, date, { preventiveIsFree: !uninsured }) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, events, date, uninsured]
  );
  return (
    <div className="card p-5 sm:p-6">
      <p className="text-[17px]">
        <span className="font-medium">The menu.</span> <span className="text-dim">What things cost, and what you&rsquo;d pay for one today.</span>
      </p>
      <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-x-5 text-[12px] text-faint pb-2 border-b border-line">
        <span>Care</span>
        <span className="text-right">Typical price</span>
        <span className="text-right w-20">You pay</span>
      </div>
      <ul className="max-h-[360px] overflow-y-auto no-scrollbar pb-6 [mask-image:linear-gradient(to_bottom,black_85%,transparent)]">
        {rows.map(({ k, p, c }) => (
          <li key={k} className="grid grid-cols-[1fr_auto_auto] gap-x-5 py-2 border-b border-line/60 text-[14px]">
            <span className="min-w-0 truncate">{p.label}</span>
            <span className="font-mono text-dim text-right">{usd(p.typical)}</span>
            <span className={`font-mono text-right w-20 ${c.you === 0 ? "text-moss" : "text-coral"}`}>{usd(c.you)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-faint mt-3">{PRICE_METHOD}</p>
    </div>
  );
}

const FACTS: { front: string; back: string }[] = [
  { front: "Your deductible resets on January 1.", back: "A December surgery and a January checkup live in different years. Timing a planned procedure can save you the whole deductible." },
  { front: "Your checkup is free.", back: "Preventive care from an in-network doctor costs nothing on most plans. Bring up a new problem mid-visit, though, and it can turn into a billed visit." },
  { front: "There is a ceiling.", back: "Once you've paid your out-of-pocket max in a year, covered in-network care is free. Premiums don't count toward it." },
  { front: "Cash doesn't count.", back: "Paying cash or with a coupon at the pharmacy usually doesn't move your deductible. Cheaper today can be pricier over a year." },
  { front: "You can stay on a parent's plan until 26.", back: "Married, not a student, not a dependent: doesn't matter. Losing it opens a 60-day window to buy your own." },
  { front: "The ER can't surprise-bill you.", back: "Federal law caps emergency cost sharing at in-network levels, even at an out-of-network ER. The ground ambulance is the exception." },
];

function Facts() {
  const [flipped, setFlipped] = useState<number | null>(null);
  return (
    <div className="card p-5 sm:p-6">
      <p className="text-[17px]">
        <span className="font-medium">Things nobody tells you.</span> <span className="text-dim">Tap one.</span>
      </p>
      <div className="mt-4 grid sm:grid-cols-2 gap-2.5">
        {FACTS.map((f, i) => {
          const on = flipped === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setFlipped(on ? null : i)}
              aria-expanded={on}
              className="relative h-[124px] text-left [perspective:900px]"
            >
              <motion.div
                className="absolute inset-0 [transform-style:preserve-3d]"
                animate={{ rotateY: on ? 180 : 0 }}
                transition={{ type: "spring", duration: 0.6, bounce: 0 }}
              >
                <div className="absolute inset-0 rounded-[18px] border border-line bg-surface p-4 [backface-visibility:hidden] flex items-end">
                  <span className="font-serif text-[21px] leading-tight">{f.front}</span>
                </div>
                <div className="absolute inset-0 rounded-[18px] bg-moss text-paper p-4 [backface-visibility:hidden] [transform:rotateY(180deg)] text-[13px] leading-snug overflow-hidden">
                  {f.back}
                </div>
              </motion.div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
