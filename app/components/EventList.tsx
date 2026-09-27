"use client";

import type { CareEvent, EventResult } from "@/lib/engine";
import { usd } from "@/lib/catalog";
import { CASH } from "@/lib/other-plans";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function when(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Why the engine charged what it did, in words, from the engine's own flags. */
function why(r: EventResult, ceiling: number): string {
  if (r.event.serviceType === CASH) return "Paid cash: doesn't count toward your deductible";
  if (!Number.isFinite(ceiling)) return "No insurance: you pay the full price";
  if (r.event.preventive) return "Preventive care is free under the ACA";
  if (r.outsideCeiling && r.planPays === 0) return "Your plan does not cover this";
  if (r.balanceBilled > 0) return "Out of network: they can bill you the difference";
  if (r.hitOutOfPocketMax) return "You hit the ceiling on this one";
  if (r.patientPays === 0 && r.after.outOfPocketSpent >= ceiling) return "Past the ceiling, the plan pays it all";
  if (r.patientPays === 0) return "Your plan covers this in full";
  if (r.toDeductible > 0 && r.costShare === 0) return "All of it goes to your deductible";
  if (r.toDeductible > 0) return "Finishes your deductible, then you split the rest";
  return "You pay your share, the plan pays the rest";
}

export default function EventList({
  timeline,
  unexpected,
  ceiling,
}: {
  timeline: EventResult[];
  unexpected: Set<CareEvent>;
  ceiling: number;
}) {
  if (!timeline.length) return <p className="text-sm text-dim">No care this year.</p>;

  return (
    <ol className="divide-y divide-line/70">
      {timeline.map((r, i) => (
        <li
          key={i}
          className={`grid grid-cols-[3.25rem_1fr_4.75rem_4.75rem] sm:grid-cols-[3.75rem_1fr_6rem_6rem] gap-x-3 py-2 text-[14px] ${
            unexpected.has(r.event) ? "bg-red/[0.06] -mx-2 px-2 rounded-lg" : ""
          }`}
        >
          <span className="font-mono text-[12px] text-dim pt-0.5 tabular">{when(r.event.date)}</span>
          <span className="min-w-0">
            <span className="block truncate">{r.event.label}</span>
            <span className="block text-[12px] text-dim truncate">{why(r, ceiling)}</span>
          </span>
          <span className="font-mono text-[13px] text-right text-red tabular">{usd(r.patientPays)}</span>
          <span className="font-mono text-[13px] text-right text-blue tabular">{usd(r.planPays)}</span>
        </li>
      ))}
    </ol>
  );
}
