"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { CareEvent, Plan } from "@/lib/engine";
import { usd } from "@/lib/catalog";
import { AMBULANCE_BALANCE_BILL } from "@/lib/prices";
import { visitCost, visitDate } from "@/lib/care";
import {
  AMBULANCE_SOURCE,
  STATES,
  STATUS_LABEL,
  stateById,
  stateFromZip,
  stateLawApplies,
  type AmbulanceStatus,
} from "@/lib/kb/ambulance";
import { PEOPLE } from "@/lib/kb/people";
import type { Source } from "@/lib/profile";
import Money from "./Money";
import { CallCard, Icon, RoomHeader, Rise } from "./ui";

const FILL: Record<AmbulanceStatus, string> = {
  protected: "bg-good/80 text-paper",
  partial: "bg-gold/70 text-paper",
  none: "bg-white/[0.05] text-dim",
};

const spring = { type: "spring" as const, stiffness: 110, damping: 20 };

export default function AmbulanceRoom({
  plan,
  baseEvents,
  zip,
  source,
  planSelfFunded,
}: {
  plan: Plan;
  baseEvents: CareEvent[];
  zip: string | null;
  source: Source | null;
  planSelfFunded: boolean | null;
}) {
  const home = stateFromZip(zip);
  const [picked, setPicked] = useState(home);
  const employer = source === "employer";
  const [selfFunded, setSelfFunded] = useState<boolean | null>(
    planSelfFunded ?? (source === "marketplace" || source === "student" ? false : null)
  );
  const [run, setRun] = useState(0);
  const st = stateById(picked)!;
  const applies = stateLawApplies(st.status, selfFunded);
  const date = useMemo(() => visitDate(), []);
  const uninsured = source === "uninsured";

  const inNet = useMemo(() => visitCost(plan, baseEvents, "ambulance", date), [plan, baseEvents, date]);
  const outNet = useMemo(
    () => visitCost(plan, baseEvents, "ambulance", date, { balanceBilled: AMBULANCE_BALANCE_BILL.amount }),
    [plan, baseEvents, date]
  );
  const protectedRide = applies === "yes";
  const bars = [
    { key: "in", label: "In-network ambulance", sub: "The company has a contract with your plan", cost: inNet, tone: "good" },
    {
      key: "out",
      label: "Out-of-network ambulance",
      sub: protectedRide
        ? `${st.name} law limits this to your in-network cost`
        : "They can bill you the part your plan does not pay",
      cost: protectedRide ? inNet : outNet,
      tone: "red",
    },
  ];
  const widest = Math.max(1, ...bars.map((b) => b.cost.you + b.cost.plan)); // layout ratio only

  const counts = STATES.reduce(
    (m, s) => ({ ...m, [s.status]: (m[s.status] ?? 0) + 1 }),
    {} as Record<AmbulanceStatus, number>
  );

  const verdict =
    applies === "yes"
      ? `${st.name} protects you from ground ambulance surprise bills on your kind of plan.`
      : applies === "partly"
        ? `${st.name} protects you only in some cases. ${st.note ?? ""}`
        : applies === "depends"
          ? `${st.name} has a law, but it only covers plans the state regulates. If your employer pays claims itself, it does not apply.`
          : selfFunded === true && st.status !== "none"
            ? `${st.name} has a law, but self-funded employer plans are outside every state law.`
            : `${st.name} has no law protecting you from ground ambulance surprise bills.`;

  return (
    <section>
      <RoomHeader
        eyebrow="Ambulance"
        title="The ER is protected. The ride there often is not."
        lede="The federal No Surprises Act covers emergency rooms and air ambulances. Ground ambulances were left out, so an out-of-network company can bill you the difference. Some states closed the gap."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Your situation. */}
        <Rise className="card p-5 sm:p-7">
          <div className="eyebrow">Your situation</div>
          <div className="mt-3 flex items-center gap-3">
            <span className={`grid place-items-center size-10 rounded-full ${applies === "yes" ? "bg-good/15 text-good" : applies === "partly" || applies === "depends" ? "bg-gold/15 text-gold" : "bg-red/15 text-red"}`}>
              <Icon name={applies === "yes" ? "check" : "ambulance"} className="size-5" />
            </span>
            <div>
              <div className="font-serif text-[1.8rem] leading-none">{st.name}</div>
              <div className="text-[13px] text-dim mt-1">{STATUS_LABEL[st.status]}</div>
            </div>
          </div>
          <p className="mt-4 text-[15px] leading-relaxed">{verdict}</p>

          <div className="mt-5">
            <div className="text-[13px] text-dim mb-2">
              {employer ? "Does your employer pay claims itself (a self-funded plan)?" : "Is your plan self-funded by an employer?"}
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                [true, "Yes, self-funded"],
                [false, "No, insured"],
                [null, "Not sure"],
              ] as const).map(([v, l]) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setSelfFunded(v)}
                  aria-pressed={selfFunded === v}
                  className={`min-h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                    selfFunded === v ? "border-blue/70 bg-blue/15" : "border-line text-dim hover:text-ink"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-faint mt-2">
              About two in three workers with job coverage are in self-funded plans (KFF, 2025). Your plan summary or HR can tell you.
            </p>
          </div>
        </Rise>

        {/* One ride, two companies. */}
        <Rise i={1} className="card p-5 sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow">One ride, two companies</div>
              <p className="text-[14px] text-dim mt-2">In an emergency you don&rsquo;t pick the ambulance. Here is the difference it makes.</p>
            </div>
            <button
              type="button"
              onClick={() => setRun((n) => n + 1)}
              className="shrink-0 inline-flex items-center gap-2 min-h-9 px-3.5 rounded-full border border-line text-[13px] text-dim hover:text-ink hover:border-line-strong"
            >
              <Icon name="spark" className="size-4" />
              Replay
            </button>
          </div>
          <div key={run} className="mt-6 space-y-6">
            {bars.map((b, i) => {
              const total = b.cost.you + b.cost.plan;
              const youShare = total > 0 ? (b.cost.you / total) * 100 : 0;
              return (
                <div key={b.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[15px]">{b.label}</div>
                      <div className="text-[12.5px] text-dim">{b.sub}</div>
                    </div>
                    <span className={`font-serif text-3xl leading-none shrink-0 ${b.tone === "red" && !protectedRide ? "text-red" : "text-ink"}`}>
                      <Money value={b.cost.you} />
                    </span>
                  </div>
                  <div className="relative mt-3 h-3 rounded-full bg-white/[0.04] overflow-hidden">
                    <motion.div
                      className="absolute inset-y-0 left-0 flex rounded-full overflow-hidden"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max((total / widest) * 100, 1.5)}%` }}
                      transition={{ ...spring, delay: 0.15 + i * 0.25 }}
                    >
                      <div className="h-full bg-red shadow-[0_0_14px] shadow-red/60" style={{ width: `${youShare}%` }} />
                      <div className="h-full flex-1 bg-blue/80" />
                    </motion.div>
                  </div>
                  {b.cost.balanceBilled > 0 && !protectedRide && (
                    <div className="mt-2 text-[12.5px] text-red/90">
                      Includes a {usd(b.cost.balanceBilled)} balance bill that never counts toward your ceiling.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-[12px] text-faint">
            {uninsured ? "With no insurance you pay the full bill either way. " : ""}
            Balance bill: the average surprise charge, {usd(AMBULANCE_BALANCE_BILL.amount)}, from {AMBULANCE_BALANCE_BILL.source}.
          </p>
        </Rise>
      </div>

      {/* The country. */}
      <Rise i={2} className="card p-5 sm:p-7 mt-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Where states stepped in</div>
            <h3 className="font-serif text-[1.7rem] leading-tight mt-2">
              {counts.protected + counts.partial} states protect you. {counts.none - 1} states and DC do not.
            </h3>
          </div>
          <div className="flex flex-wrap gap-3 text-[12px] text-dim">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-good/80" />Protected</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-gold/70" />Partial</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-white/[0.12]" />None</span>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start">
          <div className="grid grid-cols-11 gap-1 sm:gap-1.5" role="list" aria-label="States">
            {Array.from({ length: 8 * 11 }, (_, idx) => {
              const col = idx % 11;
              const row = Math.floor(idx / 11);
              const s = STATES.find((x) => x.col === col && x.row === row);
              if (!s) return <div key={idx} aria-hidden />;
              const on = s.id === picked;
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  role="listitem"
                  onClick={() => setPicked(s.id)}
                  aria-pressed={on}
                  aria-label={`${s.name}: ${STATUS_LABEL[s.status]}`}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 + (col + row) * 0.03, type: "spring", stiffness: 300, damping: 22 }}
                  whileHover={{ scale: 1.08 }}
                  className={`relative aspect-square rounded-[6px] sm:rounded-lg grid place-items-center text-[9px] sm:text-[11px] font-mono tracking-tight ${FILL[s.status]} ${
                    on ? "ring-2 ring-ink ring-offset-2 ring-offset-paper z-10" : ""
                  }`}
                >
                  {s.id}
                  {s.id === home && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-blue ring-2 ring-paper" />}
                </motion.button>
              );
            })}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-line p-4">
              <div className="text-[12px] text-dim">What to do with an ambulance bill</div>
              <ol className="mt-2 space-y-2 text-[14px] list-decimal pl-5 leading-snug">
                <li>In an emergency, call 911 anyway. Sort out the bill later.</li>
                <li>Don&rsquo;t pay the first bill. Wait for your plan&rsquo;s explanation of benefits and ask for an itemized bill.</li>
                <li>Appeal through your plan if it paid out-of-network rates. The Denied room writes the letter.</li>
                <li>Many ambulance services are run by a city or county. Ask for a hardship reduction or a payment plan.</li>
              </ol>
            </div>
            <CallCard person={PEOPLE.insurer} compact />
            <CallCard person={selfFunded === true ? PEOPLE.ebsa : PEOPLE.moDci} compact />
          </div>
        </div>
        <p className="mt-5 text-[12px] text-faint">
          State list as of {AMBULANCE_SOURCE.asOf}: {AMBULANCE_SOURCE.name}. Protections apply to plans the state regulates, never to self-funded employer plans.
        </p>
      </Rise>
    </section>
  );
}
