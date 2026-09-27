"use client";

import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { useEffect, useMemo, useReducer, useState } from "react";
import { rankPlans, runYear, type Plan } from "@/lib/engine";
import { CATALOG, QUOTE_NOTE, usd } from "@/lib/catalog";
import { SURPRISES, buildYear } from "@/lib/scenarios";
import { cardPlan } from "@/lib/card";
import { medicaidPlan, uninsuredPlan } from "@/lib/other-plans";
import { initialProfile, readsPlan, reducer } from "@/lib/profile";
import { BRAND } from "@/lib/brand";
import Concierge from "./Concierge";
import YearRoom from "./YearRoom";
import PlanTable from "./PlanTable";
import RxRoom from "./RxRoom";
import DeniedRoom from "./DeniedRoom";
import Overview from "./Overview";
import CareRoom from "./CareRoom";
import AmbulanceRoom from "./AmbulanceRoom";
import AskRoom from "./AskRoom";
import { Icon, RoomHeader } from "./ui";

const PLANS = CATALOG.map((c) => c.plan);
// Stable objects, so memoized results do not recompute on every render.
const MEDICAID = medicaidPlan();
const UNINSURED = uninsuredPlan();

export type RoomId = "overview" | "year" | "care" | "rx" | "ambulance" | "denied" | "ask" | "compare";

const ROOMS: { id: RoomId; label: string; icon: string }[] = [
  { id: "overview", label: "Home", icon: "home" },
  { id: "year", label: "Your year", icon: "year" },
  { id: "care", label: "Find care", icon: "care" },
  { id: "rx", label: "Rx and tests", icon: "rx" },
  { id: "ambulance", label: "Ambulance", icon: "ambulance" },
  { id: "denied", label: "Denied?", icon: "denied" },
  { id: "ask", label: "Ask", icon: "ask" },
  { id: "compare", label: "Compare", icon: "compare" },
];
const MOBILE_TABS: RoomId[] = ["overview", "year", "care", "rx"];

const STATS = [
  { big: "53.5%", line: "of Americans get health insurance through a job", src: "Census, 2025" },
  { big: "1 in 5", line: "in-network marketplace claims were denied in 2024", src: "KFF" },
  { big: "< 1%", line: "of those denials were ever appealed", src: "KFF" },
];

export default function Planner() {
  const [p, dispatch] = useReducer(reducer, undefined, initialProfile);
  const [room, setRoom] = useState<RoomId>("year");
  const [guideOpen, setGuideOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);

  const uninsured = p.source === "uninsured";
  const { events, unexpected } = useMemo(
    () => buildYear(p.habits, SURPRISES[p.surprise], p.month, p.oon, { preventiveIsFree: !uninsured }),
    [p.habits, p.surprise, p.month, p.oon, uninsured]
  );

  // Every door ends in the same engine Plan.
  const card = useMemo(() => (readsPlan(p.source) ? cardPlan(p.card) : null), [p.source, p.card]);
  const selected = CATALOG.find((c) => c.id === p.selectedPlanId)!;
  const plan: Plan = card ? card.plan : p.source === "medicaid" ? MEDICAID : uninsured ? UNINSURED : selected.plan;

  const year = useMemo(() => runYear(events, plan), [events, plan]);
  const ranked = useMemo(() => rankPlans(events, PLANS), [events]);

  const live = p.source !== null;
  const done = p.step === "done";
  const info = p.planInfo;
  const { title, subtitle, note } = (() => {
    if (card)
      return {
        title: info?.planName ?? (p.source === "student" ? "Your student plan" : "The plan on your card"),
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
        title: "No insurance",
        subtitle: "Full price, no ceiling",
        note: "You may qualify for MO HealthNet or a marketplace plan with a tax credit. Compare shows what they would cost.",
      };
    return { title: selected.plan.name, subtitle: `${selected.meta.issuer} · ${selected.meta.metal}`, note: null };
  })();

  // The landing page may be scrolled; the app starts at the top.
  useEffect(() => {
    if (live && typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [live]);

  // A new visitor lands on the year; once it is built, home is the hub.
  useEffect(() => {
    if (done) setRoom((r) => (r === "year" ? "overview" : r));
  }, [done]);

  const go = (r: RoomId) => {
    setRoom(r);
    setMoreOpen(false);
    if (typeof window !== "undefined" && window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const selfFunded = info?.selfFunded ?? null;
  const showGuide = !done || guideOpen;

  const stage = (
    <AnimatePresence mode="wait">
      <motion.div
        key={room}
        initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        {room === "overview" && (
          <Overview year={year} cheapest={ranked[0] ?? null} planName={title} source={p.source} zip={p.zip} selfFunded={selfFunded} go={go} />
        )}
        {room === "year" && (
          <YearRoom
            p={p}
            dispatch={dispatch}
            year={year}
            title={title}
            subtitle={subtitle}
            unexpected={unexpected}
            estimated={card?.estimated ?? []}
            note={note}
          />
        )}
        {room === "care" && <CareRoom plan={plan} baseEvents={events} uninsured={uninsured} medicaid={p.source === "medicaid"} />}
        {room === "rx" && <RxRoom plan={plan} baseEvents={events} uninsured={uninsured} />}
        {room === "ambulance" && (
          <AmbulanceRoom plan={plan} baseEvents={events} zip={p.zip} source={p.source} planSelfFunded={selfFunded} />
        )}
        {room === "denied" && <DeniedRoom planSelfFunded={selfFunded} />}
        {room === "ask" && <AskRoom selfFunded={selfFunded} go={go} />}
        {room === "compare" && (
          <section>
            <RoomHeader
              eyebrow="Compare plans"
              title={p.source === "marketplace" ? "Every plan, ranked by your year." : "If you bought your own plan."}
              lede={
                p.source === "marketplace"
                  ? "Premiums plus what you pay for care. The cheapest premium is often not the cheapest year. Pick a row to make it yours."
                  : "The same year of care on every 2026 marketplace plan in Boone County. Worth knowing before you turn 26, change jobs, or lose coverage."
              }
            />
            <div className="card p-4 sm:p-6">
              <PlanTable ranked={ranked} selectedId={p.source === "marketplace" ? p.selectedPlanId : ""} onSelect={(id) => dispatch({ type: "selectPlan", id })} />
            </div>
          </section>
        )}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        {/* Top bar. */}
        <header className="sticky top-0 z-40 border-b border-line bg-paper/70 backdrop-blur-xl">
          <div className="mx-auto max-w-[1480px] px-4 sm:px-6 h-16 flex items-center gap-4">
            <button type="button" onClick={() => (live ? go("overview") : dispatch({ type: "restart" }))} className="flex items-center gap-2.5 shrink-0">
              <span className="relative grid place-items-center size-7 rounded-full bg-gradient-to-br from-blue to-red">
                <span className="size-2.5 rounded-full bg-paper" />
              </span>
              <span className="font-serif text-[22px] leading-none tracking-[-0.01em]">{BRAND.name}</span>
            </button>

            {live ? (
              <>
                <button
                  type="button"
                  onClick={() => go("year")}
                  className="hidden md:flex flex-1 min-w-0 items-center gap-3 max-w-xl mx-auto"
                  aria-label="Open your year"
                >
                  <span className="text-[12px] text-dim shrink-0">You pay</span>
                  <span className="relative flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <motion.span
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red/70 to-red"
                      animate={{
                        width: `${Math.min(100, (year.patientTotal / (Number.isFinite(plan.outOfPocketMax) ? plan.outOfPocketMax : Math.max(year.patientTotal, 1))) * 100)}%`,
                      }}
                      transition={{ type: "spring", stiffness: 160, damping: 24 }}
                    />
                  </span>
                  <span className="font-mono text-[12.5px] tabular shrink-0">
                    {usd(year.patientTotal)}
                    <span className="text-faint"> / {Number.isFinite(plan.outOfPocketMax) ? usd(plan.outOfPocketMax) : "no ceiling"}</span>
                  </span>
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <div className="hidden sm:block text-right leading-tight max-w-[220px]">
                    <div className="text-[12px] text-dim">{p.zip ? `ZIP ${p.zip}` : "Missouri"}</div>
                    <div className="text-[13px] truncate">{title}</div>
                  </div>
                  {done && (
                    <button
                      type="button"
                      onClick={() => setGuideOpen((v) => !v)}
                      aria-pressed={guideOpen}
                      className={`hidden lg:inline-flex items-center gap-2 min-h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                        guideOpen ? "border-line-strong bg-white/[0.06]" : "border-line text-dim hover:text-ink"
                      }`}
                    >
                      <Icon name="guide" className="size-4" />
                      {guideOpen ? "Hide guide" : "Guide"}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="ml-auto text-[12.5px] text-dim hidden sm:block">Real 2026 plan rules · Every dollar computed, never guessed</div>
            )}
          </div>
        </header>

        {!live ? (
          <Landing>
            <motion.div layoutId="concierge" transition={{ type: "spring", stiffness: 170, damping: 26 }}>
              <Concierge p={p} dispatch={dispatch} year={null} estimatedCount={0} hero />
            </motion.div>
          </Landing>
        ) : (
          <div className="mx-auto max-w-[1480px] px-4 sm:px-6 pt-5 pb-28 lg:pb-12">
            <div
              className={`grid gap-5 lg:gap-6 items-start ${
                showGuide ? "lg:grid-cols-[76px_minmax(340px,390px)_minmax(0,1fr)]" : "lg:grid-cols-[76px_minmax(0,1fr)]"
              }`}
            >
              {/* Rail. */}
              <nav aria-label="Rooms" className="hidden lg:flex flex-col gap-1 sticky top-[5.25rem]">
                {ROOMS.map((r) => {
                  const on = room === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => go(r.id)}
                      aria-current={on ? "page" : undefined}
                      className={`relative flex flex-col items-center gap-1.5 rounded-2xl py-2.5 text-[11px] leading-tight transition-colors ${
                        on ? "text-ink" : "text-dim hover:text-ink"
                      }`}
                    >
                      {on && (
                        <motion.span
                          layoutId="rail-pill"
                          className="absolute inset-0 rounded-2xl bg-white/[0.07] border border-line"
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        />
                      )}
                      <span className="relative">
                        <Icon name={r.icon} className="size-5" />
                      </span>
                      <span className="relative text-center px-1">{r.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Guide. */}
              <AnimatePresence initial={false}>
                {showGuide && (
                  <motion.div
                    key="guide"
                    layoutId="concierge"
                    transition={{ type: "spring", stiffness: 170, damping: 26 }}
                    className={`min-w-0 lg:sticky lg:top-[5.25rem] ${done ? "hidden lg:block" : ""}`}
                  >
                    <Concierge
                      p={p}
                      dispatch={dispatch}
                      year={year}
                      estimatedCount={card?.estimated.length ?? 0}
                      onClose={done ? () => setGuideOpen(false) : undefined}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Stage. */}
              <motion.div
                layout="position"
                className="min-w-0"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              >
                {stage}
                <p className="mt-14 pt-5 text-[12px] text-faint leading-relaxed max-w-3xl border-t border-line">
                  Plan rules come from the CMS 2026 public use files. Service prices are representative figures,
                  not negotiated rates at any named hospital. This models one person, in network, on a plan with one
                  combined deductible. {QUOTE_NOTE}
                </p>
              </motion.div>
            </div>
          </div>
        )}

        {/* Phone tab bar. */}
        {live && (
          <>
            <nav aria-label="Rooms" className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
              <ul className="grid grid-cols-5">
                {MOBILE_TABS.map((id) => {
                  const r = ROOMS.find((x) => x.id === id)!;
                  const on = room === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => go(id)}
                        className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] ${on ? "text-ink" : "text-dim"}`}
                      >
                        {on && <motion.span layoutId="tab-dot" className="absolute top-1.5 size-1 rounded-full bg-ink" />}
                        <Icon name={r.icon} className="size-5" />
                        {r.label}
                      </button>
                    </li>
                  );
                })}
                <li>
                  <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    className={`flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] ${
                      moreOpen || !MOBILE_TABS.includes(room) ? "text-ink" : "text-dim"
                    }`}
                  >
                    <Icon name="more" className="size-5" />
                    More
                  </button>
                </li>
              </ul>
            </nav>
            <AnimatePresence>
              {moreOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="lg:hidden fixed inset-x-3 bottom-[4.75rem] z-40 card p-2 grid grid-cols-2 gap-1.5"
                >
                  {ROOMS.filter((r) => !MOBILE_TABS.includes(r.id)).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => go(r.id)}
                      className={`flex min-h-12 items-center gap-2.5 rounded-2xl px-3.5 text-[14px] ${room === r.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
                    >
                      <Icon name={r.icon} className="size-5 text-dim" />
                      {r.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </LayoutGroup>
    </MotionConfig>
  );
}

function Landing({ children }: { children: React.ReactNode }) {
  const words = "Everything your insurance never explained.".split(" ");
  return (
    <main className="relative mx-auto max-w-[1480px] px-4 sm:px-6 pb-20">
      {/* A slow halo behind the guide. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[330px] -translate-x-1/2 size-[680px] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgb(94 176 255 / 0.16), rgb(255 125 94 / 0.06) 45%, transparent 70%)" }}
        animate={{ scale: [1, 1.06, 1], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative text-center max-w-4xl mx-auto pt-14 sm:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 text-[12.5px] text-dim"
        >
          <span className="size-1.5 rounded-full bg-good shadow-[0_0_10px] shadow-good" />
          <span className="sm:hidden">Made for students on a parent&rsquo;s plan</span>
          <span className="hidden sm:inline">Built for students on a parent&rsquo;s plan, and everyone else</span>
        </motion.div>
        <h1 className="font-serif text-[3.1rem] leading-[0.95] sm:text-7xl lg:text-[5.6rem] tracking-[-0.02em] mt-6">
          {words.map((w, i) => (
            <motion.span
              key={i}
              className="inline-block mr-[0.22em]"
              initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.08 + i * 0.07, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              {w === "never" ? <em className="text-transparent bg-clip-text bg-gradient-to-r from-blue to-red pr-1">{w}</em> : w}
            </motion.span>
          ))}
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-6 text-[17px] sm:text-lg text-dim max-w-2xl mx-auto leading-relaxed"
        >
          What your year will really cost. Whether cash beats your card. Where to go and what it costs there. What
          to do when a claim is denied. And a real person to call, every time.
        </motion.p>
      </div>

      <div className="relative max-w-[640px] mx-auto mt-10">{children}</div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.6 }}
        className="relative mx-auto mt-14 max-w-4xl grid sm:grid-cols-3 gap-px rounded-3xl overflow-hidden border border-line bg-line"
      >
        {STATS.map((s) => (
          <div key={s.big} className="bg-paper/90 px-6 py-6">
            <div className="font-serif text-4xl tracking-[-0.01em]">{s.big}</div>
            <div className="text-[14px] text-dim mt-2 leading-snug">{s.line}</div>
            <div className="text-[11px] text-faint mt-2">{s.src}</div>
          </div>
        ))}
      </motion.div>
    </main>
  );
}
