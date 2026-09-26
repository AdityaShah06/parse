"use client";

import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { useMemo, useReducer, useState } from "react";
import { rankPlans, runYear, type Plan } from "@/lib/engine";
import { CATALOG, QUOTE_NOTE } from "@/lib/catalog";
import { SURPRISES, buildYear } from "@/lib/scenarios";
import { cardPlan } from "@/lib/card";
import { medicaidPlan, uninsuredPlan } from "@/lib/other-plans";
import { initialProfile, readsPlan, reducer } from "@/lib/profile";
import Concierge from "./Concierge";
import Instrument from "./Instrument";
import PlanTable from "./PlanTable";
import RxRoom from "./RxRoom";
import DeniedRoom from "./DeniedRoom";
import Overview from "./Overview";

const PLANS = CATALOG.map((c) => c.plan);
// Stable objects, so memoized results do not recompute on every render.
const MEDICAID = medicaidPlan();
const UNINSURED = uninsuredPlan();

type RoomId = "overview" | "year" | "rx" | "denied" | "compare";

export default function Planner() {
  const [p, dispatch] = useReducer(reducer, undefined, initialProfile);
  const [room, setRoom] = useState<RoomId>("year");

  const uninsured = p.source === "uninsured";
  const { events, unexpected } = useMemo(
    () => buildYear(p.habits, SURPRISES[p.surprise], p.month, p.oon, { preventiveIsFree: !uninsured }),
    [p.habits, p.surprise, p.month, p.oon, uninsured]
  );

  // Every door ends in the same engine Plan.
  const card = useMemo(() => (readsPlan(p.source) ? cardPlan(p.card) : null), [p.source, p.card]);
  const selected = CATALOG.find((c) => c.id === p.selectedPlanId)!;
  const plan: Plan = card
    ? card.plan
    : p.source === "medicaid"
      ? MEDICAID
      : uninsured
        ? UNINSURED
        : selected.plan;

  const year = useMemo(() => runYear(events, plan), [events, plan]);
  const ranked = useMemo(() => rankPlans(events, PLANS), [events]);

  const live = p.source !== null;
  const info = p.planInfo;
  const { title, subtitle, note } = (() => {
    if (card)
      return {
        title: info?.planName ?? (p.source === "student" ? "your student plan" : "the plan on your card"),
        subtitle: info
          ? [info.insurer, info.planType].filter(Boolean).join(" · ") || "Read from your plan summary"
          : "Built from the numbers you gave me",
        note: null,
      };
    if (p.source === "medicaid")
      return {
        title: "MO HealthNet",
        subtitle: "Missouri Medicaid",
        note: "Most MO HealthNet services cost little or nothing. Check your card for any copays.",
      };
    if (uninsured)
      return {
        title: "no insurance",
        subtitle: "Full price, no ceiling",
        note: "You may qualify for MO HealthNet or a marketplace plan with a tax credit. Compare plans shows what they would cost.",
      };
    return { title: selected.plan.name, subtitle: `${selected.meta.issuer} · ${selected.meta.metal}`, note: null };
  })();

  const rooms: { id: RoomId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "year", label: "Your year" },
    { id: "rx", label: "Rx and tests" },
    { id: "denied", label: "Denied?" },
    { id: "compare", label: p.source === "marketplace" ? "Compare plans" : "If you bought a plan" },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto max-w-[1320px] px-4 sm:px-6 py-6 lg:py-8">
        <LayoutGroup>
          {/* Header: a quiet wordmark once the app is running, the full statement before. */}
          <motion.header layout className={live ? "flex flex-wrap items-end justify-between gap-3 mb-6" : "text-center max-w-3xl mx-auto mt-6 lg:mt-14 mb-10"}>
            <motion.h1
              layout="position"
              className={`font-serif leading-[0.98] tracking-[-0.01em] ${live ? "text-3xl lg:text-4xl" : "text-5xl sm:text-6xl lg:text-7xl"}`}
            >
              {live ? "What you\u2019d actually pay" : "Everything your insurance never explained."}
            </motion.h1>
            <AnimatePresence>
              {!live && (
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: 0.15 }}
                  className="mt-5 text-lg text-dim max-w-xl mx-auto"
                >
                  What your year will cost, whether cash beats your card, what to do when a claim is denied,
                  and who to call. In plain English, in one place.
                </motion.p>
              )}
            </AnimatePresence>
            {live && (
              <p className="text-[13px] text-dim max-w-md">
                Real 2026 plan rules from the federal government. Every dollar is computed, none are guessed by AI.
              </p>
            )}
          </motion.header>

          <div className={live ? "grid gap-6 lg:grid-cols-[minmax(360px,420px)_1fr] items-start" : "max-w-[620px] mx-auto"}>
            <motion.div layout layoutId="concierge" transition={{ type: "spring", stiffness: 170, damping: 26 }} className="min-w-0 lg:sticky lg:top-6">
              <Concierge
                p={p}
                dispatch={dispatch}
                year={live ? year : null}
                estimatedCount={card?.estimated.length ?? 0}
                hero={!live}
              />
            </motion.div>

            {live && (
              <motion.div
                className="min-w-0"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <nav aria-label="Rooms" className="mb-5 flex gap-1 overflow-x-auto rounded-full border border-line bg-surface/70 p-1 w-fit max-w-full">
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRoom(r.id)}
                      aria-current={room === r.id ? "page" : undefined}
                      className={`relative shrink-0 px-4 min-h-10 rounded-full text-[14px] ${room === r.id ? "text-surface" : "text-dim hover:text-ink"}`}
                    >
                      {room === r.id && (
                        <motion.span
                          layoutId="room-pill"
                          className="absolute inset-0 rounded-full bg-ink"
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        />
                      )}
                      <span className="relative">{r.label}</span>
                    </button>
                  ))}
                </nav>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={room}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    {room === "overview" && (
                      <Overview
                        year={year}
                        cheapest={ranked[0] ?? null}
                        planName={title}
                        go={(r) => setRoom(r)}
                      />
                    )}
                    {room === "year" && (
                      <Instrument
                        year={year}
                        title={title}
                        subtitle={subtitle}
                        unexpected={unexpected}
                        estimated={card?.estimated ?? []}
                        note={note}
                        live
                      />
                    )}
                    {room === "rx" && <RxRoom plan={plan} baseEvents={events} uninsured={uninsured} />}
                    {room === "denied" && <DeniedRoom planSelfFunded={p.planInfo?.selfFunded ?? null} />}
                    {room === "compare" && (
                      <section>
                        <h2 className="font-serif text-3xl">
                          {p.source === "marketplace" ? "Every plan, ranked by your year" : "If you bought your own plan"}
                        </h2>
                        <p className="text-sm text-dim mt-1 mb-4 max-w-2xl">
                          {p.source === "marketplace"
                            ? "Premiums plus what you pay for care. The cheapest premium is often not the cheapest year. Pick a row to put it in Your year."
                            : "The same year of care on every 2026 marketplace plan in Boone County. Worth knowing before you turn 26, change jobs, or lose coverage."}
                        </p>
                        <PlanTable
                          ranked={ranked}
                          selectedId={p.source === "marketplace" ? p.selectedPlanId : ""}
                          onSelect={(id) => dispatch({ type: "selectPlan", id })}
                        />
                      </section>
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </LayoutGroup>

        <p className="mt-14 border-t border-line pt-5 text-[12px] text-dim leading-relaxed max-w-3xl">
          Service prices are representative figures, not negotiated rates at any named hospital. Plan
          rules come from the CMS 2026 public use files. This models one person, in network, on a plan
          with one combined deductible. {QUOTE_NOTE}
        </p>
      </main>
    </MotionConfig>
  );
}
