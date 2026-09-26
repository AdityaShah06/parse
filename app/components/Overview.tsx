"use client";

import { motion } from "framer-motion";
import type { YearResult } from "@/lib/engine";
import { lookup, usd } from "@/lib/catalog";
import { PEOPLE } from "@/lib/kb/people";
import Money from "./Money";

type Go = (room: "year" | "rx" | "denied" | "compare") => void;

function Tile({
  onClick,
  className = "",
  delay = 0,
  children,
  label,
}: {
  onClick?: () => void;
  className?: string;
  delay?: number;
  children: React.ReactNode;
  label: string;
}) {
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={label}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      className={`group relative flex flex-col justify-start text-left rounded-[26px] border border-line bg-surface/80 p-6 overflow-hidden transition-colors ${
        onClick ? "hover:border-ink/40 cursor-pointer" : ""
      } ${className}`}
    >
      {children}
      {onClick && (
        <span className="absolute right-6 top-6 text-[13px] text-dim group-hover:text-ink transition-colors">Open</span>
      )}
    </Comp>
  );
}

/**
 * The hub: one glance at everything, each tile opens its room. Every dollar is
 * an engine field passed in from the Planner.
 */
export default function Overview({
  year,
  cheapest,
  planName,
  go,
}: {
  year: YearResult;
  cheapest: YearResult | null;
  planName: string;
  go: Go;
}) {
  const total = year.patientTotal + year.planTotal; // layout ratio only
  const you = total > 0 ? (year.patientTotal / total) * 100 : 0;

  return (
    <div className="grid gap-4 md:grid-cols-6">
      <Tile label="Open your year" onClick={() => go("year")} className="md:col-span-4 md:row-span-2 bg-ink! text-surface border-ink!">
        <div className="text-[13px] text-surface/60">Your year on {planName}</div>
        <div className="mt-8 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[13px] text-surface/60">You pay</div>
            <div className="font-serif text-5xl sm:text-6xl leading-none mt-1 text-red-soft">
              <Money value={year.patientTotal} />
            </div>
          </div>
          <div>
            <div className="text-[13px] text-surface/60">Your plan pays</div>
            <div className="font-serif text-5xl sm:text-6xl leading-none mt-1 text-blue-soft">
              <Money value={year.planTotal} />
            </div>
          </div>
        </div>
        <div className="relative h-1.5 mt-8 rounded-full bg-blue-soft/40 overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 bg-red-soft"
            animate={{ width: `${you}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 26 }}
          />
        </div>
        <p className="mt-6 text-[14px] text-surface/70 max-w-md">
          Every visit, prescription and surprise, run through your plan&rsquo;s real rules in date order.
        </p>
      </Tile>

      <Tile label="Open prescriptions and tests" onClick={() => go("rx")} delay={0.06} className="md:col-span-2">
        <div className="text-[13px] text-dim">Rx and tests</div>
        <div className="font-serif text-2xl leading-tight mt-6">Is cash cheaper than your card?</div>
        <p className="text-[13px] text-dim mt-2">Checked over your whole year, deductible included.</p>
      </Tile>

      <Tile label="Open denied claims" onClick={() => go("denied")} delay={0.12} className="md:col-span-2">
        <div className="text-[13px] text-dim">Denied?</div>
        <div className="font-serif text-2xl leading-tight mt-6">1 in 5 claims gets denied. Almost nobody appeals.</div>
        <p className="text-[13px] text-dim mt-2">Deadline, who to call, and your letter, ready to send.</p>
      </Tile>

      <Tile label="Open plan comparison" onClick={() => go("compare")} delay={0.18} className="md:col-span-3">
        <div className="text-[13px] text-dim">Compare plans</div>
        {cheapest ? (
          <>
            <div className="font-serif text-2xl leading-tight mt-6 pr-12">
              Cheapest year for you: {usd(cheapest.trueAnnualCost)}
            </div>
            <p className="text-[13px] text-dim mt-2 truncate">
              {lookup(cheapest.plan).plan.name}, premiums included. 43 Missouri plans ranked.
            </p>
          </>
        ) : null}
      </Tile>

      <Tile label="People to call" delay={0.24} className="md:col-span-3">
        <div className="text-[13px] text-dim">When you need a person</div>
        <ul className="mt-4 space-y-2.5">
          {[PEOPLE.moDci, PEOPLE.ebsa, PEOPLE.crisis].map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] min-w-0 truncate">{p.name}</span>
              {p.phone && (
                <a href={`tel:${p.phone.replace(/\D/g, "")}`} className="font-mono text-[13px] underline underline-offset-4 shrink-0">
                  {p.phone}
                </a>
              )}
            </li>
          ))}
        </ul>
      </Tile>
    </div>
  );
}
