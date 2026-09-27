"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { CareEvent } from "@/lib/engine";
import type { MyPlan } from "@/lib/my-plan";
import { benefitsFor, type BenefitView, type CareCategory } from "@/lib/benefits";
import { scorePlan, ACA_MOOP_2026 } from "@/lib/plan-score";
import { usd } from "@/lib/catalog";
import { PRICES, PRICE_FILE_META, noContract } from "@/lib/prices";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import { useTheme } from "./theme";
import { Icon } from "../ui";

type Explain = { headline: string | null; summary: string | null; bestFor: string | null; watchOut: string | null; moves: { benefit: string; text: string }[] };

const EASE = [0.23, 1, 0.32, 1] as const;

/**
 * Room: your plan, on one page. The document writes itself in with the
 * important numbers highlighted and a plain note beside each; the score is
 * computed in lib/plan-score.ts; Gemini only explains what's already here.
 */
export default function YourPlan({
  my,
  events,
  goCare,
  goRoom,
}: {
  my: MyPlan;
  events: CareEvent[];
  goCare: (c: CareCategory) => void;
  goRoom: (r: "year" | "rx" | "plans") => void;
}) {
  const [theme] = useTheme();
  const night = theme === "night";
  const plan = my.plan;
  const benefits = useMemo(() => benefitsFor(plan, events, my.kind !== "uninsured"), [plan, events, my.kind]);
  const score = useMemo(() => scorePlan(plan, benefits, { planType: my.planType, issuer: my.issuer, referralRequired: my.referralRequired ?? null }), [plan, benefits, my.planType, my.issuer, my.referralRequired]);
  const [explain, setExplain] = useState<Explain | null>(null);
  const [aiState, setAiState] = useState<"loading" | "done" | "off">("loading");

  const facts = useMemo(
    () => ({
      plan: my.name,
      insurer: my.issuer,
      type: my.planType,
      metal: my.metal,
      deductible: usd(plan.deductible),
      outOfPocketMax: usd(plan.outOfPocketMax),
      legalMaxOutOfPocket: usd(ACA_MOOP_2026),
      afterDeductibleYouPay: `${Math.round(plan.coinsuranceRate * 100)}%`,
      benefits: benefits.map((b) => ({ key: b.key, benefit: b.label, youPay: b.share.text })),
      score: `${score.score} out of 100 (${score.grade})`,
      pros: score.pros,
      cons: score.cons,
    }),
    [my, plan, benefits, score]
  );

  useEffect(() => {
    let alive = true;
    setAiState("loading");
    fetch("/api/plan-explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts }) })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok && j.explain) {
          setExplain(j.explain);
          setAiState("done");
        } else setAiState("off");
      })
      .catch(() => alive && setAiState("off"));
    return () => {
      alive = false;
    };
  }, [facts]);

  const lines = explain?.headline ? ["Here's your plan, on one page.", explain.headline] : ["Here's your plan, on one page.", "I highlighted the parts that cost money."];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={aiState === "loading" ? "thinking" : score.grade === "A" || score.grade === "B" ? "happy" : "calm"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic key={lines.join("|")} lines={lines} size="lg" />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start">
        <PlanDocument my={my} benefits={benefits} />
        <div className="space-y-5 xl:sticky xl:top-6">
          <ScoreCard score={score} />
          <AiCard explain={explain} state={aiState} />
        </div>
      </div>

      <BenefitGrid benefits={benefits} moves={explain?.moves ?? []} goCare={goCare} goRoom={goRoom} deductible={plan.deductible} pricing={pricingNote(my)} />
    </section>
  );
}

function pricingNote(my: MyPlan): { text: string; warn: boolean } {
  const hosp = PRICE_FILE_META.hospital ? "MU Health Care" : "local hospitals";
  if (my.kind === "medicaid" || my.kind === "uninsured") return { text: `Prices are the median of every private insurer's contract at ${hosp}.`, warn: false };
  if (noContract(my.issuer)) return { text: `${hosp}'s public price file lists no contract with ${my.issuer}. It may be out of network there: check before you go. Prices shown are other insurers' median.`, warn: true };
  if (PRICES.mri.payer) return { text: `Priced at ${my.issuer}'s own negotiated rates at ${hosp}, from the hospital's public price file.`, warn: false };
  return { text: `Prices are the median of every private insurer's contract at ${hosp}.`, warn: false };
}

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

function Marker({ on, tone = "coral", children, delay = 0 }: { on: boolean; tone?: "coral" | "mint" | "gold"; children: React.ReactNode; delay?: number }) {
  const color = tone === "mint" ? "rgb(143 220 180 / 0.55)" : tone === "gold" ? "rgb(240 217 168 / 0.7)" : "rgb(255 139 110 / 0.4)";
  return (
    <motion.span
      className="box-decoration-clone px-1 -mx-1 rounded-[2px]"
      style={{ backgroundImage: `linear-gradient(transparent 50%, ${color} 50%)`, backgroundRepeat: "no-repeat" }}
      initial={{ backgroundSize: "0% 100%" }}
      animate={{ backgroundSize: on ? "100% 100%" : "0% 100%" }}
      transition={{ duration: 0.7, delay, ease: [0.77, 0, 0.175, 1] }}
    >
      {children}
    </motion.span>
  );
}

function PlanDocument({ my, benefits }: { my: MyPlan; benefits: BenefitView[] }) {
  const plan = my.plan;
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = [300, 1100, 1900, 2700, 3500].map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => t.forEach(clearTimeout);
  }, [my.name]);

  const questions: { q: string; a: string; note: string; tone: "coral" | "mint" | "gold" }[] = [
    {
      q: "What is the overall deductible?",
      a: usd(plan.deductible),
      note: plan.deductible >= 5000 ? "You pay the full price of most care until you've spent this much." : "You pay full price for most care until you've spent this. Not a lot, as deductibles go.",
      tone: "coral",
    },
    {
      q: "After that, what do I pay?",
      a: plan.coinsuranceRate === 0 ? "Nothing" : `${Math.round(plan.coinsuranceRate * 100)}% of each bill`,
      note: plan.coinsuranceRate >= 0.4 ? "A big share. The plan and you split bills close to evenly." : "Your share of each bill once the deductible is done.",
      tone: "gold",
    },
    {
      q: "What is the out-of-pocket limit?",
      a: usd(plan.outOfPocketMax),
      note: "The most you can pay in a year for covered, in-network care. After this, the plan pays everything.",
      tone: "mint",
    },
    {
      q: "Do I need to stay in the network?",
      // HDHP describes the deductible, not the network, so it doesn't answer this question.
      a: my.planType && my.planType !== "HDHP" ? `${my.planType}${my.network ? `, ${my.network}` : ""}` : my.network ?? "Not printed",
      note:
        (/PPO|POS/i.test(my.planType ?? "") ? "Out-of-network care is partly covered, at a higher price." : /HMO|EPO/i.test(my.planType ?? "") ? "Only in-network doctors are covered, except in emergencies." : "Check the plan's network before you book.") +
        (my.referralRequired === true ? " Specialists need a referral first." : my.referralRequired === false ? " No referral needed for specialists." : ""),
      tone: "gold",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="relative rounded-[8px] bg-[#fffdf6] text-[#1c2420] p-6 sm:p-9 shadow-[0_40px_80px_-40px_rgb(0_0_0/0.5)] overflow-hidden"
    >
      <div className="absolute inset-x-0 top-0 h-1.5 bg-[#1e7a4e]" />
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-[#1c2420]/55">
        <span>Summary of Benefits and Coverage</span>
        <span>{my.rowsFrom}</span>
      </div>
      <div className="font-serif text-[2rem] sm:text-[2.4rem] leading-[1.02] mt-3">{my.name}</div>
      <div className="text-[13.5px] text-[#1c2420]/65 mt-1.5">{[my.issuer, my.planType, my.metal, my.hsa ? "HSA eligible" : null].filter(Boolean).join(" · ")}</div>

      <div className="mt-7 text-[11px] uppercase tracking-[0.18em] text-[#1c2420]/50">Important questions</div>
      <div className="mt-2 divide-y divide-black/10 border-y border-black/10">
        {questions.map((row, i) => (
          <div key={row.q} className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 py-3.5">
            <div className="text-[14.5px]">{row.q}</div>
            <div className="font-mono text-[15px] sm:text-right">
              <Marker on={step > i} tone={row.tone}>
                {row.a}
              </Marker>
            </div>
            <AnimatePresence>
              {step > i && (
                <motion.div
                  initial={{ opacity: 0, x: -8, filter: "blur(4px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.45, delay: 0.35, ease: EASE }}
                  className="sm:col-span-2 font-serif italic text-[15px] text-[#1e7a4e]"
                >
                  {row.note}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <div className="mt-7 text-[11px] uppercase tracking-[0.18em] text-[#1c2420]/50">Common medical events, what you pay in network</div>
      <div className="mt-2 text-[14px]">
        {benefits.map((b, i) => (
          <motion.div
            key={b.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: step >= 4 ? 1 : 0, y: step >= 4 ? 0 : 6 }}
            transition={{ duration: 0.35, delay: step >= 4 ? i * 0.05 : 0, ease: EASE }}
            className="flex items-baseline justify-between gap-4 py-2 border-b border-dashed border-black/10"
          >
            <span>{b.label}</span>
            <span className={`font-mono text-[13.5px] text-right ${b.share.free ? "text-[#1e7a4e]" : b.share.beforeDeductible ? "" : "text-[#c2502f]"}`}>
              <Marker on={step >= 5 && (b.share.free || !b.share.beforeDeductible)} tone={b.share.free ? "mint" : "coral"} delay={i * 0.04}>
                {b.share.text}
              </Marker>
            </span>
          </motion.div>
        ))}
      </div>
      {(my.excluded?.length ?? 0) > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: step >= 5 ? 1 : 0 }} transition={{ duration: 0.5, delay: 0.6 }} className="mt-7">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#1c2420]/50">Not covered, per your document</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {my.excluded!.slice(0, 14).map((x) => (
              <span key={x} className="rounded-full border border-[#c2502f]/30 text-[#c2502f] text-[12px] px-2.5 py-0.5 line-through decoration-[#c2502f]/40">
                {x}
              </span>
            ))}
          </div>
        </motion.div>
      )}
      {(my.otherCovered?.length ?? 0) > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: step >= 5 ? 1 : 0 }} transition={{ duration: 0.5, delay: 0.8 }} className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#1c2420]/50">Also covered, often forgotten</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {my.otherCovered!.slice(0, 14).map((x) => (
              <span key={x} className="rounded-full bg-[#8fdcb4]/40 text-[12px] px-2.5 py-0.5">
                {x}
              </span>
            ))}
          </div>
        </motion.div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[#1c2420]/55">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#8fdcb4]" /> free</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#ff8b6e]" /> deductible first</span>
        {my.sbcUrl && (
          <a href={my.sbcUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 ml-auto">
            Original document
          </a>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Score                                                               */
/* ------------------------------------------------------------------ */

function ScoreCard({ score }: { score: ReturnType<typeof scorePlan> }) {
  const [open, setOpen] = useState(false);
  const R = 46;
  const C = 2 * Math.PI * R;
  const tone = score.score >= 65 ? "var(--moss)" : score.score >= 50 ? "var(--gold)" : "var(--coral)";
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15, ease: EASE }} className="card p-6">
      <div className="flex items-center gap-5">
        <div className="relative size-[112px] shrink-0">
          <svg viewBox="0 0 112 112" className="size-full -rotate-90">
            <circle cx="56" cy="56" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
            <motion.circle
              cx="56"
              cy="56"
              r={R}
              fill="none"
              stroke={tone}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={{ strokeDashoffset: C * (1 - score.score / 100) }}
              transition={{ duration: 1.4, delay: 0.4, ease: EASE }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="font-serif text-[2.6rem] leading-none">{score.grade}</div>
              <div className="font-mono text-[12px] text-dim mt-0.5">{score.score}/100</div>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">Plan score</div>
          <p className="text-[14px] text-dim mt-1.5 leading-snug">{score.note} Computed from the plan's rules and public data, not by the AI.</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {score.parts.map((p, i) => (
          <div key={p.key}>
            <div className="flex items-baseline justify-between text-[13.5px]">
              <span>{p.label}</span>
              <span className="font-mono text-dim">{p.value === null ? "no data" : Math.round(p.value * 100)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-line overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: p.value === null ? "transparent" : p.value >= 0.65 ? "var(--moss)" : p.value >= 0.45 ? "var(--gold)" : "var(--coral)" }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round((p.value ?? 0) * 100)}%` }}
                transition={{ duration: 0.9, delay: 0.5 + i * 0.12, ease: EASE }}
              />
            </div>
            <div className="text-[12px] text-faint mt-1 leading-snug">{p.why}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <ul className="space-y-2 text-[13.5px]">
          {score.pros.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-moss" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <ul className="space-y-2 text-[13.5px]">
          {score.cons.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-coral" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      {score.insurer && (
        <div className="mt-5 border-t border-line pt-4">
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-[13px] text-dim hover:text-ink inline-flex items-center gap-2">
            <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span> Where the insurer's track record comes from
          </button>
          <AnimatePresence>
            {open && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-3 space-y-2 text-[12.5px]">
                {score.insurer.factors
                  .filter((f) => !f.missing)
                  .map((f) => (
                    <li key={f.key} className="flex justify-between gap-3">
                      <span className="text-dim">{f.label}</span>
                      <a href={f.source.sourceUrl} target="_blank" rel="noreferrer" className="font-mono text-right hover:underline">
                        {f.display}
                        <span className="text-faint"> {f.source.year ?? ""}</span>
                      </a>
                    </li>
                  ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* The AI's read                                                       */
/* ------------------------------------------------------------------ */

function AiCard({ explain, state }: { explain: Explain | null; state: "loading" | "done" | "off" }) {
  if (state === "off") return null;
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3, ease: EASE }} className="card p-6 relative overflow-hidden">
      <div className="absolute -right-10 -top-10 size-40 rounded-full opacity-40 blur-2xl pointer-events-none" style={{ background: "radial-gradient(circle, var(--mint), transparent 70%)" }} />
      <div className="relative">
        <div className="eyebrow">What I make of it</div>
        {state === "loading" || !explain ? (
          <div className="mt-4 space-y-2.5">
            {[92, 80, 86, 60].map((w, i) => (
              <motion.div key={i} className="h-3.5 rounded-full bg-line" style={{ width: `${w}%` }} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }} />
            ))}
          </div>
        ) : (
          <div className="mt-3 space-y-4 text-[15px] leading-relaxed">
            {explain.summary && <p>{explain.summary}</p>}
            {explain.bestFor && (
              <p>
                <span className="text-moss font-medium">Works well for: </span>
                {explain.bestFor}
              </p>
            )}
            {explain.watchOut && (
              <p>
                <span className="text-coral font-medium">Watch out: </span>
                {explain.watchOut}
              </p>
            )}
          </div>
        )}
        <div className="mt-5 text-[11.5px] text-faint">Written by Gemini from the numbers on this page. It can't change them.</div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Benefits                                                            */
/* ------------------------------------------------------------------ */

const GROUPS: { key: BenefitView["group"]; title: string; line: string }[] = [
  { key: "everyday", title: "Everyday care", line: "What you'll use most." },
  { key: "drugs", title: "Prescriptions", line: "Where cash sometimes beats the card." },
  { key: "tests", title: "Tests and scans", line: "Where the price depends on where you go." },
  { key: "big", title: "The big stuff", line: "Where the out-of-pocket max earns its keep." },
];

const CARE_LABEL: Record<CareCategory, string> = {
  primary: "doctors",
  urgent: "urgent care",
  er: "ERs",
  mental: "therapists",
  imaging: "imaging centers",
  orthopedics: "specialists",
  pharmacy: "pharmacies",
  lab: "labs",
};

function BenefitGrid({
  benefits,
  moves,
  goCare,
  goRoom,
  deductible,
  pricing,
}: {
  benefits: BenefitView[];
  moves: { benefit: string; text: string }[];
  goCare: (c: CareCategory) => void;
  goRoom: (r: "year" | "rx" | "plans") => void;
  deductible: number;
  pricing: { text: string; warn: boolean };
}) {
  const aiTip = (k: string) => moves.find((m) => m.benefit === k)?.text;
  return (
    <div className="space-y-8 pt-4">
      <div>
        <div className="font-serif text-[2rem] sm:text-[2.4rem] leading-[1.05]">Your benefits, and how to use them.</div>
        <p className="text-dim text-[15px] mt-2">Each price below is what one visit costs you today, run through your plan with everything else in your year. Deductible: {usd(deductible)}.</p>
        <p className={`text-[13.5px] mt-2 ${pricing.warn ? "text-coral" : "text-faint"}`}>{pricing.text}</p>
      </div>
      {GROUPS.map((g) => (
        <div key={g.key}>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="font-medium text-[17px]">{g.title}.</span>
            <span className="text-dim text-[15px]">{g.line}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {benefits
              .filter((b) => b.group === g.key)
              .map((b, i) => (
                <motion.div
                  key={b.key}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.45, delay: i * 0.05, ease: EASE }}
                  className="card-quiet p-5 flex flex-col"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[15px] font-medium">{b.label}</div>
                      <div className="text-[12.5px] text-faint mt-0.5">{b.what}</div>
                    </div>
                    {b.share.free && <span className="shrink-0 rounded-full bg-sage text-moss text-[11px] px-2 py-0.5">Free</span>}
                  </div>
                  <div className="mt-3 flex items-baseline justify-between gap-3">
                    <span className={`font-serif text-[1.7rem] leading-none ${b.share.free ? "text-moss" : b.share.beforeDeductible ? "" : "text-coral"}`}>{b.share.text}</span>
                  </div>
                  {b.oneToday && (
                    <div className="mt-2 text-[12.5px] text-dim">
                      One today: <span className="font-mono text-ink">{usd(b.oneToday.you)}</span> you, <span className="font-mono">{usd(b.oneToday.plan)}</span> plan
                    </div>
                  )}
                  <p className="mt-3 text-[13.5px] leading-snug">{aiTip(b.key) ?? b.tip}</p>
                  <div className="mt-auto pt-4 flex flex-wrap gap-2">
                    {b.category && b.category !== "pharmacy" && (
                      <button type="button" onClick={() => goCare(b.category!)} className="rounded-full bg-ink text-paper h-9 px-4 text-[13px] inline-flex items-center gap-2">
                        <Icon name="pin" className="size-3.5" /> Find {CARE_LABEL[b.category]} near you
                      </button>
                    )}
                    {b.category === "pharmacy" && (
                      <button type="button" onClick={() => goRoom("rx")} className="rounded-full bg-ink text-paper h-9 px-4 text-[13px]">
                        Compare prices for a drug
                      </button>
                    )}
                    {(b.group === "big" || b.group === "tests") && (
                      <button type="button" onClick={() => goRoom("year")} className="rounded-full border border-line h-9 px-4 text-[13px] text-dim hover:text-ink">
                        Try it in your year
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
