"use client";

import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import { useMemo, useState } from "react";
import type { CareEvent, Plan } from "@/lib/engine";
import { usd } from "@/lib/catalog";
import { AMBULANCE_BALANCE_BILL } from "@/lib/prices";
import { visitCost, visitDate } from "@/lib/care";
import { STATES, STATUS_LABEL, stateById, stateFromZip, stateLawApplies, type AmbulanceStatus } from "@/lib/kb/ambulance";
import { PEOPLE } from "@/lib/kb/people";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import Handoff from "./Handoff";
import { useTheme } from "./theme";

const RIGS = [
  { name: "City fire department", inNetwork: true },
  { name: "Private company", inNetwork: false },
  { name: "County ambulance district", inNetwork: true },
  { name: "Private company", inNetwork: false },
  { name: "Hospital-owned ambulance", inNetwork: true },
  { name: "Some company two towns over", inNetwork: false },
];
const ROW = 64;

/** Room: the ride nobody covers, as a game. Spin to see who showed up. */
export default function AmbulanceGame({ plan, baseEvents, zip, selfFunded: initialSelfFunded }: { plan: Plan; baseEvents: CareEvent[]; zip: string; selfFunded: boolean | null }) {
  const [theme] = useTheme();
  const night = theme === "night";
  const [stateId, setStateId] = useState(stateFromZip(zip));
  const [selfFunded, setSelfFunded] = useState<boolean | null>(initialSelfFunded);
  const [result, setResult] = useState<(typeof RIGS)[number] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const y = useMotionValue(0);
  const st = stateById(stateId)!;
  const applies = stateLawApplies(st.status, selfFunded);
  const date = useMemo(() => visitDate(), []);
  const inNet = useMemo(() => visitCost(plan, baseEvents, "ambulance", date), [plan, baseEvents, date]);
  const outNet = useMemo(() => visitCost(plan, baseEvents, "ambulance", date, { balanceBilled: AMBULANCE_BALANCE_BILL.amount }), [plan, baseEvents, date]);
  const reel = useMemo(() => Array.from({ length: 8 }, () => RIGS).flat(), []);

  const spin = () => {
    if (spinning) return;
    setResult(null);
    setSpinning(true);
    const land = RIGS.length * 5 + Math.floor(Math.random() * RIGS.length);
    y.set(0);
    animate(y, -land * ROW, {
      duration: 2.6,
      ease: [0.12, 0.7, 0.18, 1],
      onComplete: () => {
        setSpinning(false);
        setResult(reel[land]);
      },
    });
  };

  const protectedRide = applies === "yes";
  const cost = result ? (result.inNetwork || protectedRide ? inNet : outNet) : null;
  const lines = !result
    ? ["You're in the back of an ambulance.", "Quick question: who sent it? Spin."]
    : result.inNetwork
      ? ["Lucky. They're in your network.", "You pay your normal share. Enjoy the ride."]
      : protectedRide
        ? [`Out of network, but ${st.name} has your back.`, "State law holds you to your normal share."]
        : [`Out of network, in ${st.name}.`, "Nothing stops them from billing you the difference. Federal law forgot ambulances."];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={!result ? "calm" : result.inNetwork || protectedRide ? "happy" : "shocked"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic key={lines.join()} lines={lines} size="lg" />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        {/* The reel. */}
        <div className="card p-5">
          <div className="relative h-[192px] overflow-hidden rounded-[20px] bg-paper border border-line">
            <motion.ul style={{ y }} className="absolute inset-x-0 top-[64px]">
              {reel.map((r, i) => (
                <li key={i} className="h-16 flex items-center justify-between gap-3 px-5">
                  <span className="text-[16px] truncate">{r.name}</span>
                  <span className={`shrink-0 whitespace-nowrap text-[12px] rounded-full px-2.5 py-1 ${r.inNetwork ? "bg-sage text-moss" : "bg-coral/15 text-coral"}`}>{r.inNetwork ? "In network" : "Out of network"}</span>
                </li>
              ))}
            </motion.ul>
            <div className="absolute inset-x-0 top-[64px] h-16 border-y-2 border-moss/60 pointer-events-none" />
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-paper to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-paper to-transparent pointer-events-none" />
          </div>
          <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={spin} disabled={spinning} className="mt-4 w-full rounded-full bg-ink text-paper h-12 text-[15px] disabled:opacity-60">
            {spinning ? "Sirens..." : result ? "Spin again" : "Spin the ambulance"}
          </motion.button>
          <div className="mt-4">
            <div className="text-[12.5px] text-dim mb-2">Does your employer pay claims itself (self-funded)?</div>
            <div className="flex flex-wrap gap-2">
              {([[true, "Yes"], [false, "No, it's insurance"], [null, "No idea"]] as const).map(([v, l]) => (
                <button key={String(v)} type="button" onClick={() => setSelfFunded(v)} className={`rounded-full px-3 h-9 text-[13px] border ${selfFunded === v ? "border-moss bg-sage" : "border-line text-dim"}`}>
                  {l}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-faint mt-2">Self-funded plans skip state law entirely. About two in three workers with job coverage are on one.</p>
          </div>
        </div>

        {/* The bill. */}
        <div className="card p-6 sm:p-7 min-h-[320px] flex flex-col">
          <AnimatePresence mode="wait">
            {result && cost ? (
              <motion.div key={result.name + String(result.inNetwork)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col">
                <div className="eyebrow">Your bill for the ride</div>
                <div className={`font-serif text-7xl sm:text-8xl leading-none mt-3 tracking-[-0.03em] ${result.inNetwork || protectedRide ? "text-moss" : "text-coral"}`}>{usd(cost.you)}</div>
                <div className="mt-4 text-[15px] text-dim">
                  Your plan pays <span className="font-mono text-ink">{usd(cost.plan)}</span>.
                  {!result.inNetwork && !protectedRide && <> <span className="font-mono text-coral">{usd(cost.balanceBilled)}</span> of yours is a balance bill, and it never counts toward your out-of-pocket max.</>}
                </div>
                <div className="mt-auto pt-6 grid sm:grid-cols-2 gap-3">
                  <div className="card-quiet p-4 text-[13.5px]">
                    <div className="font-medium">If it happens</div>
                    <p className="text-dim mt-1">Call 911 anyway. Then don&rsquo;t pay the first bill: wait for your plan&rsquo;s statement and ask for an itemized bill.</p>
                  </div>
                  <div className="card-quiet p-4 text-[13.5px]">
                    <div className="font-medium">Then push back</div>
                    <p className="text-dim mt-1">Appeal through your plan, and ask the ambulance service about a hardship discount. City and county services often have one.</p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 grid place-items-center text-center text-dim">
                <p className="max-w-sm">Spin to see which ambulance company shows up, and what it costs you on your plan in {st.name}.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* The country. */}
      <div className="card p-5 sm:p-7">
        <p className="text-[17px]">
          <span className="font-medium">23 states protect you from this.</span> <span className="text-dim">Tap a state to move the game there.</span>
        </p>
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center">
          <div className="grid grid-cols-11 gap-1 sm:gap-1.5">
            {Array.from({ length: 88 }, (_, idx) => {
              const s = STATES.find((x) => x.col === idx % 11 && x.row === Math.floor(idx / 11));
              if (!s) return <div key={idx} />;
              const on = s.id === stateId;
              const fill: Record<AmbulanceStatus, string> = { protected: "bg-moss text-paper", partial: "bg-gold/70 text-ink", none: "bg-line text-dim" };
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  onClick={() => setStateId(s.id)}
                  aria-label={`${s.name}: ${STATUS_LABEL[s.status]}`}
                  aria-pressed={on}
                  whileHover={{ scale: 1.1 }}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: ((idx % 11) + Math.floor(idx / 11)) * 0.025 }}
                  className={`aspect-square rounded-[6px] grid place-items-center font-mono text-[9px] sm:text-[10.5px] ${fill[s.status]} ${on ? "ring-2 ring-coral ring-offset-2 ring-offset-surface" : ""}`}
                >
                  {s.id}
                </motion.button>
              );
            })}
          </div>
          <div>
            <div className="font-serif text-[2rem] leading-none">{st.name}</div>
            <div className="text-[14px] text-dim mt-2">{STATUS_LABEL[st.status]}{st.note ? `. ${st.note}` : "."}</div>
            <p className="text-[14px] mt-4">
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
            <p className="text-[11.5px] text-faint mt-4">State list as of February 2026 (healthinsurance.org, Commonwealth Fund). Surprise charge: {AMBULANCE_BALANCE_BILL.source}.</p>
          </div>
        </div>
      </div>

      <Handoff person={selfFunded === true ? PEOPLE.ebsa : PEOPLE.moDci} line="If an ambulance bill doesn't make sense, this is who to call." />
    </section>
  );
}
