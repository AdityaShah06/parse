"use client";

import type { Dispatch } from "react";
import type { CareEvent, YearResult } from "@/lib/engine";
import type { CardPlan } from "@/lib/card";
import type { Action, Profile } from "@/lib/profile";
import { usd } from "@/lib/catalog";
import AccumulatorBar from "./AccumulatorBar";
import WhoPaid from "./WhoPaid";
import EventList from "./EventList";
import { SurpriseControls } from "./Concierge";
import { RoomHeader, Rise } from "./ui";

/** The year, in full: who paid, the bar, what if, and every visit. */
export default function YearRoom({
  p,
  dispatch,
  year,
  title,
  subtitle,
  unexpected,
  estimated,
  note,
}: {
  p: Profile;
  dispatch: Dispatch<Action>;
  year: YearResult;
  title: string;
  subtitle: string;
  unexpected: Set<CareEvent>;
  estimated: CardPlan["estimated"];
  note: string | null;
}) {
  return (
    <section>
      <RoomHeader eyebrow="Your year" title={title} lede={subtitle} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Rise className="card p-5 sm:p-7 min-w-0">
          <WhoPaid result={year} />
          <div className="mt-8">
            <AccumulatorBar result={year} />
          </div>
          {year.annualPremium > 0 && (
            <p className="mt-2 text-[14px] text-dim">
              Plus {usd(year.annualPremium)} in premiums: <span className="text-ink">{usd(year.trueAnnualCost)}</span> for the whole year.
            </p>
          )}
          {note && <div className="mt-4 rounded-2xl border border-dashed border-line px-4 py-3 text-[13px] text-dim">{note}</div>}
          {estimated.length > 0 && (
            <div className="mt-4 rounded-2xl border border-dashed border-line px-4 py-3 text-[13px] text-dim">
              <span className="text-ink">Typical values used:</span>{" "}
              {estimated.map((e, i) => (
                <span key={e.field} title={e.source}>
                  {e.field.toLowerCase()} {e.value}
                  {i < estimated.length - 1 ? ", " : ". "}
                </span>
              ))}
              Check your card to make these exact.
            </div>
          )}
        </Rise>

        <Rise i={1} className="card p-5 sm:p-6">
          <div className="eyebrow">What if</div>
          <p className="text-[14px] text-dim mt-2 mb-5">
            Insurance is for the year you can&rsquo;t plan. Drag to see what one bad day does to it.
          </p>
          <SurpriseControls p={p} dispatch={dispatch} compact />
        </Rise>
      </div>

      <Rise i={2} className="card p-5 sm:p-7 mt-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="eyebrow">Every visit, in order</div>
          <div className="text-[12px] text-faint">{year.timeline.length} items</div>
        </div>
        <div className="grid grid-cols-[3.25rem_1fr_4.75rem_4.75rem] sm:grid-cols-[3.75rem_1fr_6rem_6rem] gap-x-3 text-[12px] text-dim pb-2 border-b border-line">
          <span>Date</span>
          <span>Care</span>
          <span className="text-right">You</span>
          <span className="text-right">Plan</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          <EventList timeline={year.timeline} unexpected={unexpected} ceiling={year.plan.outOfPocketMax} />
        </div>
      </Rise>
    </section>
  );
}
