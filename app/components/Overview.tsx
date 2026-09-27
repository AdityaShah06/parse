"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import type { YearResult } from "@/lib/engine";
import { lookup, usd } from "@/lib/catalog";
import { PEOPLE } from "@/lib/kb/people";
import { STATUS_LABEL, stateById, stateFromZip } from "@/lib/kb/ambulance";
import { PROVIDERS, visitCost, visitDate } from "@/lib/care";
import type { Source } from "@/lib/profile";
import type { RoomId } from "./Planner";
import Money from "./Money";
import { Icon } from "./ui";

function Tile({
  onClick,
  className = "",
  i = 0,
  children,
  label,
  icon,
  eyebrow,
}: {
  onClick?: () => void;
  className?: string;
  i?: number;
  children: React.ReactNode;
  label: string;
  icon?: string;
  eyebrow: string;
}) {
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={label}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.05, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      whileHover={onClick ? { y: -3 } : undefined}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      className={`card group relative flex flex-col justify-start text-left p-6 overflow-hidden transition-[border-color] ${
        onClick ? "hover:border-line-strong cursor-pointer" : ""
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow flex items-center gap-2">
          {icon && <Icon name={icon} className="size-4" />}
          {eyebrow}
        </span>
        {onClick && (
          <span className="grid place-items-center size-7 rounded-full border border-line text-dim group-hover:text-ink group-hover:border-line-strong transition-colors">
            <Icon name="arrow" className="size-3.5" />
          </span>
        )}
      </div>
      {children}
    </Comp>
  );
}

/**
 * The hub: one glance at everything, each tile opens its room. Every dollar is
 * an engine field.
 */
export default function Overview({
  year,
  cheapest,
  planName,
  source,
  zip,
  selfFunded,
  go,
}: {
  year: YearResult;
  cheapest: YearResult | null;
  planName: string;
  source: Source | null;
  zip: string | null;
  selfFunded: boolean | null;
  go: (room: RoomId) => void;
}) {
  const total = year.patientTotal + year.planTotal; // layout ratio only
  const you = total > 0 ? (year.patientTotal / total) * 100 : 0;
  const state = stateById(stateFromZip(zip))!;

  const base = useMemo(() => year.timeline.map((r) => r.event), [year]);
  const urgent = useMemo(
    () => visitCost(year.plan, base, "urgentCare", visitDate(), { preventiveIsFree: source !== "uninsured" }),
    [year.plan, base, source]
  );

  return (
    <div>
      <div className="mb-6">
        <div className="eyebrow">Home</div>
        <h2 className="font-serif text-[2.1rem] sm:text-[2.6rem] leading-[1.02] mt-3 tracking-[-0.01em]">Your insurance, in one place.</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-6">
        <Tile
          label="Open your year"
          eyebrow="Your year"
          icon="year"
          onClick={() => go("year")}
          className="md:col-span-4 md:row-span-2 !bg-[radial-gradient(120%_120%_at_0%_0%,rgb(94_176_255/0.14),transparent_55%),radial-gradient(100%_100%_at_100%_100%,rgb(255_125_94/0.12),transparent_60%),rgb(255_255_255/0.02)]"
        >
          <div className="text-[14px] text-dim mt-4 truncate pr-6">on {planName}</div>
          <div className="mt-8 grid grid-cols-2 gap-6">
            <div>
              <div className="text-[13px] text-dim">You pay</div>
              <div className="font-serif text-5xl sm:text-7xl leading-none mt-2 text-red">
                <Money value={year.patientTotal} />
              </div>
            </div>
            <div>
              <div className="text-[13px] text-dim">Your plan pays</div>
              <div className="font-serif text-5xl sm:text-7xl leading-none mt-2 text-blue">
                <Money value={year.planTotal} />
              </div>
            </div>
          </div>
          <div className="relative h-2 mt-9 rounded-full bg-blue/80 overflow-hidden">
            <motion.div
              className="absolute inset-y-0 left-0 bg-red shadow-[0_0_18px] shadow-red/60"
              initial={{ width: 0 }}
              animate={{ width: `${you}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.2 }}
            />
          </div>
          <MonthBars year={year} />
          <div className="mt-auto pt-8 grid grid-cols-3 gap-4 text-[13px]">
            <div>
              <div className="text-dim">Deductible</div>
              <div className="font-mono mt-1">{Number.isFinite(year.plan.deductible) ? usd(year.plan.deductible) : "None"}</div>
            </div>
            <div>
              <div className="text-dim">Ceiling</div>
              <div className="font-mono mt-1">{Number.isFinite(year.plan.outOfPocketMax) ? usd(year.plan.outOfPocketMax) : "No ceiling"}</div>
            </div>
            <div>
              <div className="text-dim">Premiums</div>
              <div className="font-mono mt-1">{usd(year.annualPremium)}/yr</div>
            </div>
          </div>
        </Tile>

        <Tile label="Open Find care" eyebrow="Find care" icon="care" onClick={() => go("care")} i={1} className="md:col-span-2">
          <MiniMap />
          <div className="font-serif text-2xl leading-tight mt-4">
            Urgent care today: <span className="text-red">{usd(urgent.you)}</span>
          </div>
          <p className="text-[13px] text-dim mt-1.5">
            {PROVIDERS.length} places near you, rated and priced on your plan.
          </p>
        </Tile>

        <Tile label="Open prescriptions and tests" eyebrow="Rx and tests" icon="rx" onClick={() => go("rx")} i={2} className="md:col-span-2">
          <div className="font-serif text-2xl leading-tight mt-5">Is cash cheaper than your card?</div>
          <p className="text-[13px] text-dim mt-2">Checked over your whole year, deductible included.</p>
        </Tile>

        <Tile label="Open ambulance coverage" eyebrow="Ambulance" icon="ambulance" onClick={() => go("ambulance")} i={3} className="md:col-span-2">
          <div className="font-serif text-2xl leading-tight mt-5">
            {state.name}: <span className={state.status === "none" ? "text-red" : "text-good"}>{STATUS_LABEL[state.status].toLowerCase()}</span>
          </div>
          <p className="text-[13px] text-dim mt-2">
            {selfFunded === true
              ? "Your plan is self-funded, so no state law applies. See what an out-of-network ride costs."
              : "The federal law left ground ambulances out. See what a ride costs you."}
          </p>
        </Tile>

        <Tile label="Open denied claims" eyebrow="Denied?" icon="denied" onClick={() => go("denied")} i={4} className="md:col-span-2">
          <div className="font-serif text-2xl leading-tight mt-5">1 in 5 claims gets denied. Almost nobody appeals.</div>
          <p className="text-[13px] text-dim mt-2">Your deadline, who to call, and a letter ready to send.</p>
        </Tile>

        <Tile label="Ask the guide" eyebrow="Ask" icon="ask" onClick={() => go("ask")} i={5} className="md:col-span-2">
          <div className="font-serif text-2xl leading-tight mt-5">Ask anything about your coverage.</div>
          <p className="text-[13px] text-dim mt-2">Checked answers. Never medical advice. Always a person to call.</p>
        </Tile>

        <Tile label="Open plan comparison" eyebrow="Compare" icon="compare" onClick={() => go("compare")} i={6} className="md:col-span-3">
          {cheapest ? (
            <>
              <div className="font-serif text-2xl leading-tight mt-5 pr-6">
                Cheapest year for you: <span className="text-good">{usd(cheapest.trueAnnualCost)}</span>
              </div>
              <p className="text-[13px] text-dim mt-2 truncate">
                {lookup(cheapest.plan).plan.name}, premiums included. 43 Missouri plans ranked.
              </p>
            </>
          ) : null}
        </Tile>

        <Tile label="People to call" eyebrow="When you need a person" icon="phone" i={7} className="md:col-span-3">
          <ul className="mt-4 space-y-2.5">
            {[selfFunded === true ? PEOPLE.ebsa : PEOPLE.moDci, selfFunded === null ? PEOPLE.ebsa : PEOPLE.insurer, PEOPLE.crisis].map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] min-w-0 truncate">{p.name}</span>
                {p.phone ? (
                  <a href={`tel:${p.phone.replace(/\D/g, "")}`} className="font-mono text-[13px] underline decoration-line-strong underline-offset-4 shrink-0">
                    {p.phone}
                  </a>
                ) : (
                  <span className="text-[12px] text-dim shrink-0">Back of your card</span>
                )}
              </li>
            ))}
          </ul>
        </Tile>
      </div>
    </div>
  );
}

/**
 * The year month by month: coral for your share, blue for the plan's. Heights
 * are layout ratios only; no figure is printed from these sums.
 */
function MonthBars({ year }: { year: YearResult }) {
  const months = Array.from({ length: 12 }, () => ({ you: 0, plan: 0 }));
  for (const r of year.timeline) {
    const m = Number(r.event.date.slice(5, 7)) - 1;
    months[m].you += r.patientPays;
    months[m].plan += r.planPays;
  }
  const top = Math.max(1, ...months.map((m) => m.you + m.plan));
  return (
    <div className="mt-8" aria-hidden>
      <div className="flex items-end gap-1.5 h-24">
        {months.map((m, i) => {
          const h = ((m.you + m.plan) / top) * 100;
          const youPart = m.you + m.plan > 0 ? (m.you / (m.you + m.plan)) * 100 : 0;
          return (
            <div key={i} className="flex-1 h-full flex flex-col justify-end">
              <motion.div
                className="w-full rounded-[4px] overflow-hidden flex flex-col-reverse bg-white/[0.04]"
                initial={{ height: 2 }}
                animate={{ height: `${Math.max(h, 2)}%` }}
                transition={{ type: "spring", stiffness: 140, damping: 20, delay: 0.25 + i * 0.03 }}
              >
                <div className="bg-red" style={{ height: `${youPart}%` }} />
                <div className="bg-blue/80 flex-1" />
              </motion.div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 text-[10.5px] text-faint font-mono">
        {"JFMAMJJASOND".split("").map((c, i) => (
          <span key={i} className="flex-1 text-center">{c}</span>
        ))}
      </div>
    </div>
  );
}

/** A thumbnail of the Find care map: roads and pulsing places. */
function MiniMap() {
  return (
    <svg viewBox="0 0 1000 420" className="mt-4 w-full h-24 rounded-xl bg-white/[0.02] border border-line" aria-hidden>
      <path d="M0 110 C 300 95, 700 125, 1000 100" stroke="rgb(255 255 255 / 0.12)" strokeWidth="10" fill="none" />
      <path d="M760 0 C 740 150, 780 280, 760 420" stroke="rgb(255 255 255 / 0.09)" strokeWidth="7" fill="none" />
      <path d="M0 230 L 1000 210" stroke="rgb(255 255 255 / 0.07)" strokeWidth="5" fill="none" />
      <path d="M430 0 L 440 420" stroke="rgb(255 255 255 / 0.07)" strokeWidth="5" fill="none" />
      {PROVIDERS.map((p, i) => (
        <g key={p.id}>
          <motion.circle
            cx={p.x}
            cy={p.y * 0.6}
            r={18}
            fill={p.kind === "er" ? "#ff7d5e" : "#5eb0ff"}
            initial={{ opacity: 0.35, scale: 0.4 }}
            animate={{ opacity: [0.35, 0], scale: [0.4, 1.6] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.25 }}
            style={{ transformOrigin: `${p.x}px ${p.y * 0.6}px` }}
          />
          <circle cx={p.x} cy={p.y * 0.6} r={9} fill={p.kind === "er" ? "#ff7d5e" : "#5eb0ff"} />
        </g>
      ))}
    </svg>
  );
}
