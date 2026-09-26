"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { YearResult } from "@/lib/engine";
import { CHEAPEST_PREMIUM, lookup, usd } from "@/lib/catalog";

const COLLAPSED = 8;
// Phones show rank, plan and the year total; the two middle columns join at sm.
const COLS = "grid-cols-[1.75rem_1fr_5.5rem] sm:grid-cols-[2rem_1fr_6.5rem_6.5rem_7rem]";
const spring = { type: "spring" as const, stiffness: 380, damping: 34 };

/**
 * Every plan, ranked by what this year actually costs, premium included.
 * Rows reorder with FLIP (framer-motion `layout`) when the year changes.
 */
export default function PlanTable({
  ranked,
  selectedId,
  onSelect,
}: {
  ranked: YearResult[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  // Keep the selected plan visible even when it ranks below the fold.
  const rows = ranked.map((r, i) => ({ r, rank: i + 1, c: lookup(r.plan) }));
  const visible = showAll
    ? rows
    : rows.filter((row) => row.rank <= COLLAPSED || row.c.id === selectedId);

  return (
    <div>
      <div className={`grid ${COLS} gap-x-3 px-3 pb-2 text-[13px] text-dim border-b border-line`}>
        <span>#</span>
        <span>Plan</span>
        <span className="text-right hidden sm:block">Premiums</span>
        <span className="text-right hidden sm:block">Your care</span>
        <span className="text-right">Your year</span>
      </div>

      <ul className="relative">
        <AnimatePresence initial={false}>
          {visible.map(({ r, rank, c }) => {
            const selected = c.id === selectedId;
            return (
              <motion.li
                key={c.id}
                layout="position"
                transition={spring}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="border-b border-line/70"
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-pressed={selected}
                  className={`w-full grid ${COLS} gap-x-3 items-center px-3 py-2 text-left border-l-[3px] ${
                    selected ? "border-ink bg-surface" : "border-transparent hover:bg-surface/60"
                  }`}
                >
                  <span className="font-mono text-[13px] text-dim tabular">{rank}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px]">{c.plan.name}</span>
                    <span className="block text-[12px] text-dim truncate">
                      {c.meta.issuer} · {c.meta.metal}
                      {c.id === CHEAPEST_PREMIUM.id && " · lowest premium"}
                      {rank === 1 && " · cheapest year"}
                    </span>
                  </span>
                  <span className="font-mono text-[13px] text-right tabular hidden sm:block">
                    {usd(r.annualPremium)}
                  </span>
                  <span className="font-mono text-[13px] text-right tabular hidden sm:block">
                    {usd(r.patientTotal)}
                  </span>
                  <span className="font-mono text-[14px] text-right tabular text-red">
                    {usd(r.trueAnnualCost)}
                  </span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        className="mt-3 text-sm text-blue underline underline-offset-4 decoration-line hover:decoration-blue"
      >
        {showAll ? "Show the top plans only" : `Show all ${ranked.length} plans`}
      </button>
    </div>
  );
}
