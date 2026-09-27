"use client";

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CareEvent, Plan } from "@/lib/engine";
import { usd } from "@/lib/catalog";
import { AMBULANCE_BALANCE_BILL } from "@/lib/prices";
import { visitCost, visitDate } from "@/lib/care";
import { STATES, STATUS_LABEL, stateById, stateFromZip, stateLawApplies, type AmbulanceStatus } from "@/lib/kb/ambulance";
import { PEOPLE } from "@/lib/kb/people";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import Handoff from "./Handoff";
import { onVoice, prefetch } from "./voice";
import { useTheme } from "./theme";

/**
 * Room: one ambulance ride, four endings. The ride and the injury never
 * change; who sent the truck, which state you're in, and who pays your plan's
 * claims decide whether you get your normal share or a surprise bill on top.
 *
 * "Play all four" walks the dial through every ending, narrated, and the
 * strip under it keeps all four bills side by side. Spin picks
 * one at random; tapping a segment or a tile picks it by hand.
 */

type Scenario = {
  id: number;
  short: string;
  title: string;
  story: string;
  /** Out of network with nothing stopping the balance bill. */
  billed: boolean;
  why: string;
  /** What the guide says (and speaks, with the voice on) for this ending. */
  lines: [string, string];
};

const SCENARIOS: Scenario[] = [
  {
    id: 1,
    short: "In network",
    title: "The county ambulance, in your network",
    story: "Boone County's ambulance has a contract with your plan.",
    billed: false,
    why: "In network, so the price was agreed in advance.",
    lines: ["One. The ambulance is in your network.", "You pay your plan's normal share for the ride, and nothing on top."],
  },
  {
    id: 2,
    short: "Illinois law",
    title: "A private company, but you're in Illinois",
    story: "Road trip. The company that shows up has no contract with your plan.",
    billed: false,
    why: "Illinois bans ambulance surprise bills on plans the state regulates.",
    lines: ["Two. Out of network, but you're in Illinois.", "Illinois bans ambulance surprise bills, so you still pay only your normal share."],
  },
  {
    id: 3,
    short: "Self-funded plan",
    title: "Same ride, but your parent's plan is self-funded",
    story: "Same state, same company. The plan comes from a parent's employer that pays claims itself.",
    billed: true,
    why: "Self-funded job plans answer to federal law only, and federal law skipped ground ambulances.",
    lines: ["Three. Same ride, same state, but your parent's job plan is self-funded.", "State law can't reach those plans, and federal law skipped ground ambulances. Here comes the surprise bill."],
  },
  {
    id: 4,
    short: "Missouri",
    title: "A private company, in Missouri",
    story: "Home in Columbia. The company that shows up has no contract with your plan.",
    billed: true,
    why: "Missouri has no ambulance surprise billing law, so they can bill you the difference.",
    lines: ["Four. Out of network, at home in Missouri.", "Missouri has no ambulance law at all, so the company can bill you the difference."],
  },
];

const SEG = 360 / SCENARIOS.length;
const ease = [0.23, 1, 0.32, 1] as const;

export default function AmbulanceGame({ plan, baseEvents, zip, selfFunded }: { plan: Plan; baseEvents: CareEvent[]; zip: string; selfFunded: boolean | null }) {
  const [theme] = useTheme();
  const night = theme === "night";
  const reduce = useReducedMotion();

  const date = useMemo(() => visitDate(), []);
  const inNet = useMemo(() => visitCost(plan, baseEvents, "ambulance", date), [plan, baseEvents, date]);
  const outNet = useMemo(() => visitCost(plan, baseEvents, "ambulance", date, { balanceBilled: AMBULANCE_BALANCE_BILL.amount }), [plan, baseEvents, date]);
  const costFor = (s: Scenario) => (s.billed ? outNet : inNet);

  const [pick, setPick] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"spin" | "tour" | null>(null);
  const rotation = useMotionValue(0);
  const tour = useRef<{ i: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = pick === null ? null : SCENARIOS[pick];

  /** Turn the dial so segment i sits under the pointer. */
  const turnTo = (i: number, extraTurns: number, duration: number) => {
    const now = rotation.get();
    const want = -i * SEG;
    const delta = (((want - now) % 360) + 360) % 360;
    const target = now + delta + extraTurns * 360;
    if (reduce) {
      rotation.set(target);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      animate(rotation, target, { duration, ease: extraTurns ? [0.12, 0.7, 0.18, 1] : ease, onComplete: resolve });
    });
  };

  const land = (i: number) => {
    setPick(i);
    setSeen((s) => new Set(s).add(i));
  };

  const stopTour = () => {
    tour.current = null;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setBusy(null);
  };

  const choose = async (i: number) => {
    if (busy === "spin") return;
    stopTour();
    await turnTo(i, 0, 0.45);
    land(i);
  };

  const spin = async () => {
    if (busy) return;
    stopTour();
    setBusy("spin");
    setPick(null);
    const i = Math.floor(Math.random() * SCENARIOS.length);
    await turnTo(i, 3, 2.2);
    land(i);
    setBusy(null);
  };

  const playAll = async () => {
    if (busy === "tour") return stopTour();
    if (busy) return;
    setBusy("tour");
    setSeen(new Set());
    tour.current = { i: 0 };
    await turnTo(0, 0, 0.45);
    if (tour.current) land(0);
  };

  // During the tour, move on when the guide finishes the scenario's lines
  // (spoken when the voice is on, read at a steady pace when it's off).
  const onLinesDone = () => {
    const t = tour.current;
    if (!t || busy !== "tour") return;
    holdTimer.current = setTimeout(async () => {
      if (tour.current !== t) return;
      const next = t.i + 1;
      if (next >= SCENARIOS.length) return stopTour();
      t.i = next;
      await turnTo(next, 0, 0.5);
      if (tour.current === t) land(next);
    }, 700);
  };

  useEffect(() => {
    // Warm all four lines so the tour never waits on the network between endings.
    const warm = () => prefetch(SCENARIOS.flatMap((s) => s.lines));
    warm();
    const off = onVoice((on) => on && warm());
    return () => {
      off();
      stopTour();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lines: string[] = current
    ? current.lines
    : busy === "spin"
      ? ["Sirens. Who's driving?"]
      : ["Same ride. Same injury. Four different bills.", "Spin the dial, pick one, or play all four."];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={!current ? (busy ? "thinking" : "calm") : current.billed ? "shocked" : "happy"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic key={lines.join("|")} lines={lines} size="lg" voice onDone={onLinesDone} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* The dial. */}
        <div className="card p-5 sm:p-6 flex flex-col items-center">
          <Dial rotation={rotation} pick={pick} onPick={choose} disabled={busy === "spin"} />
          <div className="mt-5 grid w-full grid-cols-2 gap-2">
            <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={spin} disabled={busy !== null} className="rounded-full bg-ink text-paper h-12 text-[15px] disabled:opacity-50">
              {busy === "spin" ? "Sirens..." : "Spin"}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              type="button"
              onClick={playAll}
              disabled={busy === "spin"}
              className={`rounded-full h-12 text-[15px] border ${busy === "tour" ? "border-coral text-coral" : "border-line-strong"} disabled:opacity-50`}
            >
              {busy === "tour" ? "Stop" : "Play all four"}
            </motion.button>
          </div>
          <p className="text-[12px] text-faint mt-3 text-center">Tap a slice to pick one yourself.</p>
        </div>

        {/* The bill. */}
        <div className="card p-6 sm:p-7 min-h-[340px] flex flex-col">
          <AnimatePresence mode="wait" initial={false}>
            {current ? (
              <motion.div
                key={current.id}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={{ duration: 0.28, ease }}
                className="flex-1 flex flex-col"
              >
                <div className="eyebrow">
                  Ending {current.id} of 4 · {current.short}
                </div>
                <h3 className="text-[19px] font-medium mt-2 text-balance">{current.title}</h3>
                <p className="text-[14.5px] text-dim mt-1 text-pretty">{current.story}</p>
                <div className={`font-serif text-7xl sm:text-8xl leading-none mt-5 tracking-[-0.03em] tabular-nums ${current.billed ? "text-coral" : "text-moss"}`}>{usd(costFor(current).you)}</div>
                <div className="mt-3 text-[15px] text-dim text-pretty">
                  Your plan pays <span className="font-mono text-ink">{usd(costFor(current).plan)}</span>.
                  {current.billed ? (
                    <>
                      {" "}
                      <span className="font-mono text-coral">{usd(costFor(current).balanceBilled)}</span> of yours is a balance bill, and it never counts toward your out-of-pocket max.
                    </>
                  ) : (
                    " No surprise bill on top."
                  )}
                </div>
                <p className="mt-auto pt-5 text-[14px]">
                  <span className="font-medium">Why:</span> <span className="text-dim">{current.why}</span>
                </p>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 grid place-items-center text-center text-dim">
                <p className="max-w-sm text-pretty">
                  Federal law protects you from surprise bills at the ER and on air ambulances. It skipped the ground ambulance. Where you are and what kind of plan you have decide the rest.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* All four, side by side. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {SCENARIOS.map((s, i) => {
          const shown = seen.has(i);
          const on = pick === i;
          return (
            <motion.button
              key={s.id}
              type="button"
              onClick={() => choose(i)}
              whileTap={{ scale: 0.96 }}
              aria-pressed={on}
              className={`card-quiet text-left p-4 min-h-[104px] flex flex-col transition-[box-shadow,opacity] duration-200 ${on ? "ring-2 ring-ink/70" : ""} ${shown ? "" : "opacity-70"}`}
            >
              <span className="text-[12px] text-dim">
                <span className="font-mono">{s.id}</span> · {s.short}
              </span>
              <span className={`mt-auto font-mono tabular-nums text-[26px] leading-none ${shown ? (s.billed ? "text-coral" : "text-moss") : "text-faint"}`}>{shown ? usd(costFor(s).you) : "$ ?"}</span>
              <span className="text-[12px] text-dim mt-1.5">{shown ? (s.billed ? `includes ${usd(costFor(s).balanceBilled)} surprise bill` : "your normal share") : "not played yet"}</span>
            </motion.button>
          );
        })}
      </div>
      <p className="text-[11.5px] text-faint -mt-3">
        Your share comes from your plan&rsquo;s rules for an ambulance ride. The surprise bill is an average, not a quote: {AMBULANCE_BALANCE_BILL.source}.
      </p>

      <StateMap zip={zip} selfFunded={selfFunded} />

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card-quiet p-4 text-[13.5px]">
          <div className="font-medium">If it happens</div>
          <p className="text-dim mt-1">Call 911 anyway. Then don&rsquo;t pay the first bill: wait for your plan&rsquo;s statement and ask for an itemized bill.</p>
        </div>
        <div className="card-quiet p-4 text-[13.5px]">
          <div className="font-medium">Then push back</div>
          <p className="text-dim mt-1">Appeal through your plan, and ask the ambulance service about a hardship discount. City and county services often have one.</p>
        </div>
      </div>

      <Handoff person={selfFunded === true ? PEOPLE.ebsa : PEOPLE.moDci} line="If an ambulance bill doesn't make sense, this is who to call." />
    </section>
  );
}

/** Four slices under a fixed pointer. Tap a slice to turn the dial to it. */
function Dial({ rotation, pick, onPick, disabled }: { rotation: ReturnType<typeof useMotionValue<number>>; pick: number | null; onPick: (i: number) => void; disabled: boolean }) {
  const R = 120;
  const C = 130;
  const slice = (i: number) => {
    const a0 = ((i * SEG - SEG / 2 - 90) * Math.PI) / 180;
    const a1 = ((i * SEG + SEG / 2 - 90) * Math.PI) / 180;
    return `M ${C} ${C} L ${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A ${R} ${R} 0 0 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)} Z`;
  };
  const label = (i: number, r: number) => {
    const a = ((i * SEG - 90) * Math.PI) / 180;
    return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
  };
  return (
    <div className="relative w-[260px] max-w-full aspect-square">
      {/* Pointer. */}
      <svg viewBox="0 0 24 16" className="absolute left-1/2 -translate-x-1/2 -top-1 w-6 z-10 text-ink" aria-hidden>
        <path d="M12 16 L2 2 Q12 -2 22 2 Z" fill="currentColor" />
      </svg>
      <motion.svg viewBox="0 0 260 260" className="w-full h-full" style={{ rotate: rotation }} role="group" aria-label="Ambulance endings dial">
        {SCENARIOS.map((s, i) => {
          const p = label(i, 70);
          const on = pick === i;
          return (
            <g
              key={s.id}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={`Ending ${s.id}: ${s.short}`}
              onClick={() => !disabled && onPick(i)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && onPick(i)}
              className="cursor-pointer outline-none"
            >
              <path d={slice(i)} className={s.billed ? "fill-coral/15" : "fill-sage"} stroke="var(--color-paper, #FCFBF8)" strokeWidth={3} />
              {on && <path d={slice(i)} className={s.billed ? "fill-coral/25" : "fill-moss/20"} />}
              <g transform={`rotate(${i * SEG} ${p.x} ${p.y})`}>
                <text x={p.x} y={p.y - 6} textAnchor="middle" className="font-serif" fontSize="34" fill="currentColor">
                  {s.id}
                </text>
                <text x={p.x} y={p.y + 16} textAnchor="middle" fontSize="11" className={s.billed ? "fill-coral" : "fill-moss"}>
                  {s.billed ? "surprise bill" : "normal share"}
                </text>
              </g>
            </g>
          );
        })}
        <circle cx={C} cy={C} r={26} className="fill-paper" stroke="currentColor" strokeOpacity={0.12} />
        <path d="M121 130 h18 M130 121 v18" stroke="#EE6A4C" strokeWidth={5} strokeLinecap="round" />
      </motion.svg>
    </div>
  );
}

/** Where the state law helps. Tapping a state only reads it out; the game above is fixed stories. */
function StateMap({ zip, selfFunded }: { zip: string; selfFunded: boolean | null }) {
  const [stateId, setStateId] = useState(stateFromZip(zip));
  const st = stateById(stateId)!;
  const applies = stateLawApplies(st.status, selfFunded);
  return (
    <div className="card p-5 sm:p-7">
      <p className="text-[17px]">
        <span className="font-medium">23 states protect you from this.</span> <span className="text-dim">Tap one to see what it does.</span>
      </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center">
        <div className="grid grid-cols-11 gap-1 sm:gap-1.5">
          {Array.from({ length: 88 }, (_, idx) => {
            const s = STATES.find((x) => x.col === idx % 11 && x.row === Math.floor(idx / 11));
            if (!s) return <div key={idx} />;
            const on = s.id === stateId;
            const fill: Record<AmbulanceStatus, string> = { protected: "bg-moss text-paper", partial: "bg-gold/70 text-ink", none: "bg-line text-dim" };
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStateId(s.id)}
                aria-label={`${s.name}: ${STATUS_LABEL[s.status]}`}
                aria-pressed={on}
                className={`aspect-square rounded-[6px] grid place-items-center font-mono text-[9px] sm:text-[10.5px] ${fill[s.status]} ${on ? "ring-2 ring-coral ring-offset-2 ring-offset-surface" : ""}`}
              >
                {s.id}
              </button>
            );
          })}
        </div>
        <div>
          <div className="font-serif text-[2rem] leading-none">{st.name}</div>
          <div className="text-[14px] text-dim mt-2">
            {STATUS_LABEL[st.status]}
            {st.note ? `. ${st.note}` : "."}
          </div>
          <p className="text-[14px] mt-4 text-pretty">
            {applies === "yes"
              ? "On a plan the state regulates, you're protected."
              : applies === "partly"
                ? "Protected in some cases only."
                : applies === "depends"
                  ? "Protected only if your plan isn't self-funded."
                  : selfFunded === true && st.status !== "none"
                    ? "Your plan is self-funded, so the state law can't reach it."
                    : "If the company isn't in your network, the bill is whatever they say it is."}
          </p>
          <p className="text-[11.5px] text-faint mt-4">State list as of February 2026 (healthinsurance.org, Commonwealth Fund).</p>
        </div>
      </div>
    </div>
  );
}
