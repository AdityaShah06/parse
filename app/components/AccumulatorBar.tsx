"use client";

import { motion } from "framer-motion";
import type { YearResult } from "@/lib/engine";
import { usd } from "@/lib/catalog";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

type Segment = {
  key: string;
  label: string;
  /** Dollar figure shown in the tooltip, read straight off an engine field. */
  shown: number;
  left: number;
  width: number;
  breach: boolean;
};

/**
 * The patient's money for the year, laid along one dollar axis with two
 * marks: the deductible wall and the out-of-pocket ceiling.
 *
 * Every dollar printed here is an engine field. The only additions below are
 * pixel offsets for layout, never a figure anyone reads.
 */
export default function AccumulatorBar({ result }: { result: YearResult }) {
  const { plan, timeline } = result;
  const counted = timeline.length ? timeline[timeline.length - 1].after.outOfPocketSpent : 0;

  // Layout offsets. Money that counts toward the ceiling runs from zero in
  // date order. Money outside the ceiling is stacked after it.
  const segments: Segment[] = [];
  let x = 0;
  timeline.forEach((r, i) => {
    const inside = r.outsideCeiling ? 0 : r.toDeductible + r.costShare;
    if (inside > 0) {
      segments.push({
        key: `in-${i}`,
        label: r.event.label,
        shown: r.patientPays,
        left: x,
        width: inside,
        breach: false,
      });
      x += inside;
    }
  });
  timeline.forEach((r, i) => {
    const outside = r.balanceBilled + (r.outsideCeiling ? r.toDeductible + r.costShare : 0);
    if (outside > 0) {
      segments.push({
        key: `out-${i}`,
        label: r.outsideCeiling
          ? `${r.event.label}, outside the ceiling`
          : `${r.event.label}, balance bill outside the ceiling`,
        shown: r.outsideCeiling ? r.patientPays : r.balanceBilled,
        left: x,
        width: outside,
        breach: true,
      });
      x += outside;
    }
  });

  // No insurance means no ceiling: scale to the spending itself and draw no walls.
  const walls = Number.isFinite(plan.outOfPocketMax);
  const scale = Math.max(walls ? plan.outOfPocketMax : 0, x, 1) * 1.06;
  const pct = (n: number) => (n / scale) * 100;
  const hasBreach = segments.some((s) => s.breach);
  const pastCeiling = hasBreach && x > plan.outOfPocketMax;

  return (
    <div>
      <div className="relative h-14 rounded-2xl border border-line bg-white/[0.02] overflow-hidden">
        {segments.map((s) => (
          <motion.div
            key={s.key}
            title={`${s.label}: ${usd(s.shown)}`}
            className={`absolute top-0 bottom-0 border-r border-paper/60 ${s.breach ? "hatch" : "bg-gradient-to-b from-red to-[#e8664a]"}`}
            initial={{ left: `${pct(s.left)}%`, width: 0 }}
            animate={{ left: `${pct(s.left)}%`, width: `${pct(s.width)}%` }}
            transition={spring}
          />
        ))}

        {walls && <Mark at={pct(plan.deductible)} />}
        {walls && <Mark at={pct(plan.outOfPocketMax)} heavy />}
      </div>

      {/* Labels sit under the bar so they never collide with segments. */}
      <div className="relative h-[4.5rem] mt-1 text-[13px] leading-tight">
        {!walls ? (
          <p className="pt-1 text-breach">
            No insurance means no ceiling. Nothing stops this bar from growing.
          </p>
        ) : plan.deductible === plan.outOfPocketMax ? (
          <MarkLabel at={pct(plan.outOfPocketMax)} align="end" row={0}>
            Deductible and ceiling are the same, {usd(plan.outOfPocketMax)}
            <span className="block text-dim">you pay everything until here, then nothing</span>
          </MarkLabel>
        ) : (
          <>
            <MarkLabel
              at={pct(plan.deductible)}
              align={pct(plan.deductible) > 55 ? "end" : "start"}
              row={0}
            >
              Deductible {usd(plan.deductible)}
              <span className="text-dim"> you pay everything until here</span>
            </MarkLabel>
            <MarkLabel at={pct(plan.outOfPocketMax)} align="end" row={1}>
              Ceiling {usd(plan.outOfPocketMax)}
              <span className="text-dim"> covered care stops costing you here</span>
            </MarkLabel>
          </>
        )}
      </div>

      <p className={`text-sm text-dim mt-1 ${walls ? "" : "hidden"}`}>
        {usd(counted)} of your spending counted toward the ceiling.
        {hasBreach && (
          <span className="text-breach">
            {" "}
            The striped part never counts toward it
            {pastCeiling ? ", which is how your bill ran past the ceiling." : "."}
          </span>
        )}
      </p>
    </div>
  );
}

function Mark({ at, heavy = false }: { at: number; heavy?: boolean }) {
  return (
    <motion.div
      className={`absolute top-0 bottom-0 ${heavy ? "w-[3px] bg-ink" : "w-[2px] bg-ink/70"}`}
      animate={{ left: `${at}%` }}
      transition={spring}
    />
  );
}

function MarkLabel({
  at,
  align,
  row,
  children,
}: {
  at: number;
  align: "start" | "end";
  row: 0 | 1;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      style={{
        top: row === 0 ? 0 : "2.25rem",
        // Never wider than the room on its side of the mark, so it cannot
        // spill off the edge on a phone. It wraps instead.
        maxWidth: `${Math.max(20, align === "end" ? at : 100 - at)}%`,
      }}
      className={`absolute w-max ${align === "end" ? "-translate-x-full text-right pr-1" : "pl-1"}`}
      animate={{ left: `${at}%` }}
      transition={spring}
    >
      {children}
    </motion.div>
  );
}
