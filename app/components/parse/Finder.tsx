"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { Answers } from "@/lib/app-state";
import { CHEAPEST_PREMIUM, usd } from "@/lib/catalog";
import { NETWORK_LINE, recommend, type Pick } from "@/lib/finder";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import { useTheme } from "./theme";

type Q = { key: keyof Answers; ask: string[]; options: { label: string; sub: string; value: Answers[keyof Answers] }[] };

const QUESTIONS: Q[] = [
  {
    key: "who",
    ask: ["Four questions, then a verdict.", "Who's on this plan?"],
    options: [
      { label: "Just me", sub: "The classic.", value: "me" },
      { label: "Me and a partner", sub: "Congratulations.", value: "partner" },
      { label: "Me and kids", sub: "Condolences to your sleep.", value: "kids" },
    ],
  },
  {
    key: "use",
    ask: ["How often do you see a doctor?", "Be honest. I'm not your mother."],
    options: [
      { label: "Almost never", sub: "A checkup, maybe a cold.", value: "rare" },
      { label: "A few times a year", sub: "Labs, a specialist now and then.", value: "some" },
      { label: "Pretty much monthly", sub: "Therapy, prescriptions, the works.", value: "lots" },
    ],
  },
  {
    key: "doctor",
    ask: ["Is there a doctor you'd never leave?"],
    options: [
      { label: "Yes, don't make me switch", sub: "Keeping them matters more than price.", value: true },
      { label: "No, anyone good is fine", sub: "A tighter network is okay.", value: false },
    ],
  },
  {
    key: "fear",
    ask: ["Last one. Which would hurt more?"],
    options: [
      { label: "A big bill every month", sub: "I want the lowest premium.", value: "monthly" },
      { label: "One giant bill someday", sub: "I want protection from the bad year.", value: "surprise" },
    ],
  },
];

/** Room: for people who get to choose. Four questions, then a verdict with reasons. */
export default function Finder({ answers, onAnswers, onChoose, currentPlanId }: { answers: Answers | null; onAnswers: (a: Answers, planId: string) => void; onChoose: (id: string) => void; currentPlanId: string }) {
  const [draft, setDraft] = useState<Partial<Answers>>(answers ?? {});
  const [step, setStep] = useState(answers ? QUESTIONS.length : 0);
  const [theme] = useTheme();
  const night = theme === "night";

  const done = step >= QUESTIONS.length;
  const picks = useMemo(() => (done ? recommend(draft as Answers) : []), [done, draft]);

  if (!done) {
    const q = QUESTIONS[step];
    return (
      <section>
        <div className="flex items-start gap-5">
          <Sphere size={96} mood="thinking" night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
          <div className="min-w-0 pt-1">
            <Kinetic key={step} lines={q.ask} size="lg" />
          </div>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3 max-w-4xl">
          {q.options.map((o, i) => (
            <motion.button
              key={o.label}
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.07, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                const next = { ...draft, [q.key]: o.value };
                setDraft(next);
                if (step === QUESTIONS.length - 1) {
                  const top = recommend(next as Answers)[0];
                  onAnswers(next as Answers, top.c.id);
                }
                setStep(step + 1);
              }}
              className="card text-left p-5"
            >
              <div className="text-[17px] font-medium">{o.label}</div>
              <div className="text-[13.5px] text-dim mt-1">{o.sub}</div>
            </motion.button>
          ))}
        </div>
        <div className="mt-6 flex gap-1.5">
          {QUESTIONS.map((_, i) => (
            <span key={i} className={`h-1 rounded-full transition-all ${i <= step ? "w-8 bg-moss" : "w-4 bg-line-strong"}`} />
          ))}
        </div>
      </section>
    );
  }

  return <Verdict picks={picks} answers={draft as Answers} onChoose={onChoose} currentPlanId={currentPlanId} onRestart={() => setStep(0)} night={night} />;
}

function Verdict({ picks, answers, onChoose, currentPlanId, onRestart, night }: { picks: Pick[]; answers: Answers; onChoose: (id: string) => void; currentPlanId: string; onRestart: () => void; night: boolean }) {
  const [view, setView] = useState<"mine" | "most">("mine");
  const top = picks.slice(0, 3);
  const most = picks.find((p) => p.c.id === CHEAPEST_PREMIUM.id)!;
  const hero = view === "mine" ? top[0] : most;
  const widest = Math.max(...top.map((p) => p.worst), most.worst); // layout ratio only

  return (
    <section>
      <div className="flex items-start gap-5">
        <Sphere size={96} mood="happy" night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic
            size="lg"
            lines={[
              "Here's my verdict.",
              answers.doctor ? "You want to keep your doctor, so I weighed the network heavily." : answers.fear === "surprise" ? "You fear the giant bill, so I weighed the bad year heavily." : "You want the lowest monthly bill, but I kept an eye on the bad year.",
            ]}
          />
          {answers.who !== "me" && <p className="mt-3 text-[13.5px] text-dim">Priced for one person for now. Family tiers are next on my list.</p>}
        </div>
      </div>

      {/* Before / With, stolen from the best insurance site on the internet. */}
      <div className="mt-8 inline-flex rounded-full border border-line p-1 bg-surface/70">
        {(
          [
            ["most", "What most people pick"],
            ["mine", "What I'd pick for you"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`relative px-4 h-10 rounded-full text-[14px] ${view === k ? "text-paper" : "text-dim"}`}>
            {view === k && <motion.span layoutId="verdict-toggle" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", duration: 0.4, bounce: 0 }} />}
            <span className="relative">{l}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={hero.c.id + view}
          initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          className="card mt-5 p-6 sm:p-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        >
          <div>
            <div className="eyebrow">{view === "mine" ? "My pick" : "The lowest premium"}</div>
            <h3 className="font-serif text-[2.2rem] sm:text-[2.6rem] leading-[1.02] mt-3 tracking-[-0.02em]">{hero.c.plan.name}</h3>
            <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
              <span className="rounded-full bg-sage px-3 py-1">{hero.c.meta.issuer}</span>
              <span className="rounded-full bg-sage px-3 py-1">{hero.c.meta.metal}</span>
              <span className="rounded-full bg-sage px-3 py-1">{hero.c.meta.planType}</span>
              {hero.c.meta.hsaEligible && <span className="rounded-full bg-gold/25 px-3 py-1">HSA eligible</span>}
            </div>
            <p className="mt-4 text-[15px] text-dim">{NETWORK_LINE[(hero.c.meta.planType ?? "").toUpperCase()] ?? "Check the network before you sign up."}</p>
            <ul className="mt-5 space-y-2">
              {hero.reasons.map((r) => (
                <li key={r} className="flex gap-2.5 text-[15px]">
                  <span className="mt-2 size-1.5 rounded-full bg-moss shrink-0" />
                  {r}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={() => onChoose(hero.c.id)} className="rounded-full bg-ink text-paper h-11 px-5 text-[14.5px]">
                {currentPlanId === hero.c.id ? "Stress-test this plan" : "Make it mine and stress-test it"}
              </motion.button>
              {hero.c.meta.sbcUrl && (
                <a href={hero.c.meta.sbcUrl} target="_blank" rel="noreferrer" className="rounded-full border border-line-strong h-11 px-5 inline-flex items-center text-[14.5px] hover:bg-surface">
                  Read its Summary of Benefits
                </a>
              )}
            </div>
          </div>

          <div className="space-y-5">
            {(
              [
                ["Premiums for the year", hero.premiumYear, "var(--gold)"],
                ["A normal year, all in", hero.typical, "var(--moss)"],
                ["A bad year, all in", hero.worst, "var(--coral)"],
              ] as const
            ).map(([label, v, color], i) => (
              <div key={label}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[14px] text-dim">{label}</span>
                  <span className="font-mono tabular text-[22px]">{usd(v)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-line mt-2 overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${(v / widest) * 100}%` }} transition={{ type: "spring", duration: 0.9, bounce: 0, delay: 0.15 + i * 0.12 }} />
                </div>
              </div>
            ))}
            <div className="pt-2">
              <div className="flex items-baseline justify-between text-[14px] text-dim">
                <span>Freedom to pick doctors</span>
                <span>{hero.convenience >= 0.9 ? "High" : hero.convenience >= 0.6 ? "Medium" : "Low"}</span>
              </div>
              <div className="mt-2 grid grid-cols-10 gap-1">
                {Array.from({ length: 10 }).map((_, k) => (
                  <motion.span key={k} className="h-2.5 rounded-sm" initial={{ opacity: 0 }} animate={{ opacity: 1, backgroundColor: k < Math.round(hero.convenience * 10) ? "var(--moss)" : "var(--line)" }} transition={{ delay: 0.4 + k * 0.03 }} />
                ))}
              </div>
            </div>
            <p className="text-[12px] text-faint">A bad year here means a car crash with an ambulance, the ER and four nights in the hospital. All figures run through each plan&rsquo;s real 2026 rules. Premiums are list prices for a 30-year-old in Boone County, before tax credits.</p>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {top.slice(1).map((p, i) => (
          <motion.button
            key={p.c.id}
            type="button"
            onClick={() => onChoose(p.c.id)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.08 }}
            whileHover={{ y: -3 }}
            className="card text-left p-5"
          >
            <div className="eyebrow">Runner-up {i + 1}</div>
            <div className="text-[17px] font-medium mt-2 leading-snug">{p.c.plan.name}</div>
            <div className="text-[13px] text-dim mt-1">{p.c.meta.issuer} · {p.c.meta.metal} · {p.c.meta.planType}</div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[12px] text-dim">
              <span>Monthly<span className="block font-mono text-[15px] text-ink">{usd(p.c.plan.monthlyPremium)}</span></span>
              <span>Normal year<span className="block font-mono text-[15px] text-ink">{usd(p.typical)}</span></span>
              <span>Bad year<span className="block font-mono text-[15px] text-ink">{usd(p.worst)}</span></span>
            </div>
          </motion.button>
        ))}
      </div>

      <button type="button" onClick={onRestart} className="mt-6 text-[14px] text-dim hover:text-ink underline decoration-line-strong underline-offset-4">
        Answer the questions again
      </button>
    </section>
  );
}
