"use client";

import { motion } from "framer-motion";
import type { CareEvent, YearResult } from "@/lib/engine";
import type { CardPlan } from "@/lib/card";
import AccumulatorBar from "./AccumulatorBar";
import WhoPaid from "./WhoPaid";
import EventList from "./EventList";

/**
 * The right-hand side: who paid, the accumulator bar, and every visit. It
 * starts faint and fills as the visitor answers the concierge.
 */
export default function Instrument({
  year,
  title,
  subtitle,
  unexpected,
  estimated,
  note = null,
  live,
}: {
  year: YearResult;
  title: string;
  subtitle: string;
  unexpected: Set<CareEvent>;
  estimated: CardPlan["estimated"];
  note?: string | null;
  live: boolean;
}) {
  return (
    <motion.section
      aria-label="Your year"
      animate={{ opacity: live ? 1 : 0.45 }}
      transition={{ duration: 0.5 }}
      className="rounded-[22px] border border-line bg-surface/70 p-5 lg:p-7"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
        <div className="min-w-0">
          <div className="text-sm text-dim">Your year on</div>
          <div className="font-serif text-2xl truncate">{title}</div>
        </div>
        <div className="text-sm text-dim">{subtitle}</div>
      </div>

      {live ? (
        <>
          <WhoPaid result={year} />
          <div className="mt-7">
            <AccumulatorBar result={year} />
          </div>
        </>
      ) : (
        <div className="space-y-5">
          <div className="flex justify-between font-serif text-5xl leading-none text-line">
            <span>$0</span>
            <span>$0</span>
          </div>
          <div className="h-14 rounded-[3px] border border-dashed border-line" />
          <p className="text-sm text-dim">
            Your year builds here as you answer. Red is money you pay. Blue is money your plan pays.
          </p>
        </div>
      )}

      {note && live && (
        <div className="mt-4 rounded-[12px] border border-dashed border-line px-4 py-3 text-[13px] text-dim">{note}</div>
      )}

      {estimated.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-dashed border-line px-4 py-3 text-[13px] text-dim">
          <span className="text-ink">Guessed for you:</span>{" "}
          {estimated.map((e, i) => (
            <span key={e.field} title={e.source}>
              {e.field.toLowerCase()} {e.value}
              {i < estimated.length - 1 ? ", " : ". "}
            </span>
          ))}
          Hover each one to see where it comes from.
        </div>
      )}

      <div className={`mt-7 ${live ? "" : "hidden"}`}>
        <div className="grid grid-cols-[3.25rem_1fr_4.75rem_4.75rem] sm:grid-cols-[3.75rem_1fr_6rem_6rem] gap-x-3 text-[13px] text-dim pb-2 border-b border-line">
          <span>Date</span>
          <span>Care</span>
          <span className="text-right">You</span>
          <span className="text-right">Plan</span>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          <EventList timeline={year.timeline} unexpected={unexpected} ceiling={year.plan.outOfPocketMax} />
        </div>
      </div>
    </motion.section>
  );
}
