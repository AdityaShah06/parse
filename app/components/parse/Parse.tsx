"use client";

import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { useEffect, useMemo, useReducer } from "react";
import { runYear, type Plan } from "@/lib/engine";
import { CATALOG } from "@/lib/catalog";
import { cardPlan } from "@/lib/card";
import { medicaidPlan, uninsuredPlan } from "@/lib/other-plans";
import { sampleDecoded } from "@/lib/decode";
import { initialState, reducer, type Room } from "@/lib/app-state";
import { buildStress } from "@/lib/year";
import { applyPayer } from "@/lib/prices";
import { fromCatalog, matchCatalog, hiosOf, type MyPlan } from "@/lib/my-plan";
import dynamic from "next/dynamic";
import Welcome from "./Welcome";
import Wall from "./Wall";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import { setTheme, useTheme } from "./theme";

// Only the welcome screen ships in the first download. Every other screen is
// its own chunk, fetched quietly while the guide is introducing itself.
const load = {
  decode: () => import("./Decode"),
  stress: () => import("./Stress"),
  ambulance: () => import("./AmbulanceGame"),
  denied: () => import("./Denied"),
  rx: () => import("./Pharmacy"),
  care: () => import("./FindCare"),
  plan: () => import("./YourPlan"),
  shop: () => import("./PlanShop"),
  ask: () => import("./Agent"),
};
const Decode = dynamic(load.decode, { ssr: false });
const Stress = dynamic(load.stress, { ssr: false });
const AmbulanceGame = dynamic(load.ambulance, { ssr: false });
const Denied = dynamic(load.denied, { ssr: false });
const Pharmacy = dynamic(load.rx, { ssr: false });
const FindCare = dynamic(load.care, { ssr: false });
const YourPlan = dynamic(load.plan, { ssr: false });
const PlanShop = dynamic(load.shop, { ssr: false });
const Agent = dynamic(load.ask, { ssr: false });
const NightGarden = dynamic(() => import("./NightGarden"), { ssr: false });

const MEDICAID = medicaidPlan();
const UNINSURED = uninsuredPlan();

const ROOM_LINES: Partial<Record<Room, string[]>> = {
};

export default function Parse() {
  const [s, dispatch] = useReducer(reducer, undefined, initialState);
  const [theme] = useTheme();
  const night = theme === "night";

  const uninsured = s.door === "uninsured";
  const card = useMemo(() => (s.card ? cardPlan(s.card) : null), [s.card]);
  const catalogPlan = CATALOG.find((c) => c.id === s.planId) ?? CATALOG[0];
  const plan: Plan = s.door === "fixed" && card ? card.plan : s.door === "medicaid" ? MEDICAID : uninsured ? UNINSURED : catalogPlan.plan;
  const planName =
    s.door === "fixed" ? s.info?.planName ?? "Your plan" : s.door === "medicaid" ? "MO HealthNet" : uninsured ? "No insurance" : catalogPlan.plan.name;

  // One description of "your plan" for every room.
  const my: MyPlan = useMemo(() => {
    if (s.door === "fixed" && card) {
      const match = matchCatalog(s.info?.planName, s.info?.insurer);
      // Rows CMS publishes for this exact plan fill in what the card doesn't show; confirmed numbers win.
      const merged = match ? { ...card.plan, costSharing: { ...match.plan.costSharing, ...card.plan.costSharing } } : card.plan;
      return {
        name: s.info?.planName ?? "Your plan",
        issuer: s.info?.insurer ?? match?.meta.issuer ?? null,
        planType: s.info?.planType ?? match?.meta.planType ?? null,
        network: s.info?.network ?? null,
        hiosId: match ? hiosOf(match.id) : null,
        memberPhone: s.info?.memberPhone ?? null,
        sbcUrl: match?.meta.sbcUrl ?? s.info?.website ?? null,
        metal: match?.meta.metal ?? null,
        hsa: match?.meta.hsaEligible ?? null,
        plan: merged,
        rowsFrom: match ? "your document and CMS 2026 plan data" : "your document",
        kind: match ? "marketplace" : "employer-or-parent",
        referralRequired: s.info?.referralRequired ?? null,
        coveragePeriod: s.info?.coveragePeriod ?? null,
        excluded: s.info?.excluded ?? [],
        otherCovered: s.info?.otherCovered ?? [],
      };
    }
    if (s.door === "medicaid" || uninsured)
      return {
        name: uninsured ? "No insurance" : "MO HealthNet",
        issuer: null,
        planType: null,
        network: null,
        hiosId: null,
        memberPhone: null,
        sbcUrl: null,
        metal: null,
        hsa: null,
        plan,
        rowsFrom: "state program rules",
        kind: uninsured ? "uninsured" : "medicaid",
      };
    if (s.door === "switch" && s.live) {
      const l = s.live;
      return {
        name: l.name,
        issuer: l.issuer,
        planType: l.type,
        network: null,
        hiosId: l.id.slice(0, 14),
        memberPhone: l.issuerPhone,
        sbcUrl: l.urls.benefits ?? l.urls.brochure ?? null,
        metal: l.metal,
        hsa: l.hsa,
        plan: l.enginePlan,
        rowsFrom: "CMS 2026 plan data",
        kind: "marketplace",
        referralRequired: l.referral ?? null,
      };
    }
    return fromCatalog(catalogPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.door, card, s.info, catalogPlan, uninsured, s.live]);

  // Price care at this insurer's own contracted rates at MU Health Care when the price file has them.
  const priced = useMemo(() => applyPayer(my.kind === "medicaid" || my.kind === "uninsured" ? null : my.issuer, my.kind === "marketplace"), [my.issuer, my.kind]);
  const { events, origin } = useMemo(
    () => buildStress(s.habits, s.picked, s.oon, !uninsured),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.habits, s.picked, s.oon, uninsured, priced, my.issuer]
  );
  const year = useMemo(() => runYear(events, my.plan), [events, my.plan]);

  // Hidden demo controls: Shift+D jumps to a decoded example plan, Shift+R starts over.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "D") {
        dispatch({ type: "door", door: "fixed" });
        dispatch({ type: "decoded", decoded: sampleDecoded() });
      }
      if (e.key === "R") {
        setTheme("day");
        dispatch({ type: "restart" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Warm the other screens once the first one has painted.
  useEffect(() => {
    const idle = (cb: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 1200));
    idle(() => {
      load.decode();
      load.stress();
      idle(() => Object.values(load).forEach((f) => f()));
    });
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [s.stage, s.room]);

  const restart = () => {
    setTheme("day");
    dispatch({ type: "restart" });
  };

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        {night && <NightGarden tree={s.stage !== "app"} />}
        <AnimatePresence mode="wait">
          {(s.stage === "intro" || s.stage === "doors") && (
            <motion.div key="welcome" exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }}>
              <Welcome stage={s.stage} onIntroDone={() => dispatch({ type: "intro-done" })} onDoor={(door) => dispatch({ type: "door", door })} />
            </motion.div>
          )}
          {(s.stage === "decode" || s.stage === "card") && (
            <motion.div key="decode" exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }}>
              <Decode
                stage={s.stage}
                decoded={s.decoded}
                onDecoded={(decoded) => dispatch({ type: "decoded", decoded })}
                onConfirm={(c, info) => dispatch({ type: "confirm-card", card: c, info })}
              />
            </motion.div>
          )}
          {s.stage === "finder" && (
            <motion.main key="finder" className="garden min-h-screen" exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }}>
              <div className="mx-auto max-w-[1180px] px-5 sm:px-10 pt-12 pb-24">
                <PlanShop answers={s.answers} zip={s.zip} current={null} onChoose={(plan, answers) => dispatch({ type: "choose-live", plan, answers })} />
              </div>
            </motion.main>
          )}
          {s.stage === "app" && (
            <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className={night ? "relative min-h-screen" : "garden relative min-h-screen"}>
              <Wall room={s.room} go={(room) => dispatch({ type: "room", room })} restart={restart} />
              <main className="relative lg:pl-[104px] px-4 sm:px-8 pt-8 sm:pt-10 pb-28 lg:pb-16 mx-auto max-w-[1440px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={s.room}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
                  >
                    {ROOM_LINES[s.room] && (
                      <div className="flex items-start gap-5 mb-8">
                        <Sphere size={92} mood="calm" night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
                        <div className="min-w-0 pt-1">
                          <Kinetic lines={ROOM_LINES[s.room]!} size="lg" />
                        </div>
                      </div>
                    )}
                    {s.room === "year" && (
                      <Stress
                        plan={my.plan}
                        year={year}
                        origin={origin}
                        picked={s.picked}
                        habits={s.habits}
                        oon={s.oon}
                        dispatch={dispatch}
                        planName={planName}
                        uninsured={uninsured}
                      />
                    )}
                    {s.room === "plans" && (
                      <PlanShop
                        answers={s.answers}
                        zip={s.zip}
                        current={s.door === "uninsured" ? null : { name: my.name, plan: my.plan }}
                        onChoose={(plan, answers) => dispatch({ type: "choose-live", plan, answers })}
                      />
                    )}
                    {s.room === "plan" && (
                      <YourPlan
                        my={my}
                        events={events}
                        goCare={(category) => dispatch({ type: "find-care", category })}
                        goRoom={(room) => dispatch({ type: "room", room })}
                      />
                    )}
                    {s.room === "rx" && <Pharmacy my={my} events={events} />}
                    {s.room === "care" && <FindCare my={my} events={events} zip={s.zip} category={s.careCat} />}
                    {s.room === "ambulance" && <AmbulanceGame plan={my.plan} baseEvents={events} zip={s.zip} selfFunded={s.info?.selfFunded ?? null} />}
                    {s.room === "denied" && <Denied planSelfFunded={s.info?.selfFunded ?? null} hiosId={my.hiosId} issuer={my.issuer} />}
                    {s.room === "ask" && <Agent my={my} events={events} zip={s.zip} goCare={(category) => dispatch({ type: "find-care", category })} />}
                  </motion.div>
                </AnimatePresence>
                <p className="mt-16 pt-5 text-[12px] text-faint leading-relaxed max-w-3xl border-t border-line">
                  Plan rules come from the CMS 2026 public use files and your own document. Hospital prices are MU Health Care&rsquo;s negotiated rates from its public price file, using your insurer&rsquo;s own contract when it has one; doctors&rsquo; fees are 2026 Medicare rates times the commercial markup RAND measured. This models one person, in network, on a plan with one combined deductible. I do math, not medicine: if something hurts, call 911 or your plan&rsquo;s nurse line.
                </p>
              </main>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </MotionConfig>
  );
}
