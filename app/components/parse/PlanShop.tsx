"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { Answers } from "@/lib/app-state";
import type { Plan } from "@/lib/engine";
import { runYear } from "@/lib/engine";
import { yearsFor } from "@/lib/finder";
import { shop, SHOP_SOURCES, type LivePlan, type ShopRow } from "@/lib/shop";
import { usd } from "@/lib/catalog";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import { useTheme } from "./theme";

const EASE = [0.23, 1, 0.32, 1] as const;
const DEFAULT: Answers = { who: "me", use: "some", doctor: false, fear: "surprise" };

type Resp = {
  ok: boolean;
  code?: string;
  healthcareGov?: boolean;
  state?: string;
  county?: { name: string; state: string };
  stateMarketplace?: { name: string; url: string } | null;
  plans?: LivePlan[];
};
type Explain = { headline: string | null; summary: string | null; bestFor: string | null; watchOut: string | null };

/**
 * Room: a better plan, for anyone in a HealthCare.gov state. Live plans and
 * premiums from CMS for your ZIP, each run through a normal year and a bad
 * year by the engine, then weighed with CMS quality stars and the insurer's
 * real 2024 claim denial rate. Gemini explains the pick; it doesn't make it.
 */
export default function PlanShop({
  answers: initial,
  zip: initialZip,
  current,
  onChoose,
}: {
  answers: Answers | null;
  zip: string;
  current: { name: string; plan: Plan } | null;
  onChoose: (p: LivePlan, answers: Answers) => void;
}) {
  const [theme] = useTheme();
  const night = theme === "night";
  const [a, setA] = useState<Answers>(initial ?? DEFAULT);
  const [zip, setZip] = useState(initialZip);
  const [age, setAge] = useState(21);
  const [income, setIncome] = useState<string>("");
  const [query, setQuery] = useState({ zip: initialZip, age: 21, income: "" });
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [explain, setExplain] = useState<Explain | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setExplain(null);
    const inc = query.income ? `&income=${Number(query.income.replace(/\D/g, ""))}` : "";
    fetch(`/api/marketplace/plans?zip=${query.zip}&age=${query.age}${inc}&limit=80`)
      .then((r) => r.json())
      .then((j: Resp) => alive && setResp(j))
      .catch(() => alive && setResp({ ok: false, code: "network" }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  const rows = useMemo(() => (resp?.ok && resp.plans ? shop(resp.plans, a) : []), [resp, a]);
  const pick = rows[0];
  const yours = useMemo(() => {
    if (!current) return null;
    const { normal, bad } = yearsFor(a);
    return { typical: runYear(normal, current.plan).trueAnnualCost, bad: runYear(bad, current.plan).trueAnnualCost, noPremium: current.plan.monthlyPremium === 0 };
  }, [current, a]);

  // Gemini explains the pick against the runners-up. Numbers are copied from here, never made.
  useEffect(() => {
    if (!pick) return;
    let alive = true;
    const facts = {
      question: "Why is the first plan the best fit for this person, compared with the others?",
      person: { worriedAbout: a.fear === "monthly" ? "monthly bills" : "one giant bill", keepsADoctor: a.doctor, usesCare: a.use },
      plans: rows.slice(0, 4).map((r) => ({
        plan: r.p.name,
        insurer: r.p.issuer,
        type: r.p.type,
        metal: r.p.metal,
        monthlyPremium: usd(r.p.premiumWithCredit ?? r.p.premium ?? 0),
        normalYear: usd(r.typical),
        badYear: usd(r.bad),
        deductible: usd(r.p.deductible),
        qualityStars: r.stars,
        claimDenialRate2024: r.denialRate === null ? null : `${r.denialRate.toFixed(1)}%`,
        score: r.score,
      })),
    };
    fetch("/api/plan-explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts }) })
      .then((r) => r.json())
      .then((j) => alive && j.ok && setExplain(j.explain))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pick, rows, a]);

  const place = resp?.county ? `${resp.county.name}, ${resp.county.state}` : query.zip;
  const lines = loading
    ? [`Pulling every plan sold in ${query.zip}.`]
    : resp?.ok && resp.healthcareGov === false
      ? ["Your state runs its own marketplace.", "I'll send you there. Your current plan still works everywhere here."]
      : !resp?.ok
        ? ["I couldn't reach HealthCare.gov's data.", "Check the CMS key, then try again."]
        : pick
          ? ["Premiums lie. A bad year tells the truth.", explain?.headline ?? `My pick: ${pick.p.name}.`]
          : ["No plans came back for that ZIP."];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={loading ? "thinking" : pick ? "happy" : "calm"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic key={lines.join("|")} lines={lines} size="lg" />
        </div>
      </div>

      {/* The person. */}
      <form
        className="card p-5 grid gap-4 lg:grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{5}$/.test(zip)) setQuery({ zip, age, income });
        }}
      >
        <Field label="ZIP">
          <input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" className="w-[96px] h-11 rounded-full border border-line bg-surface px-4 font-mono text-[14px]" />
        </Field>
        <Field label="Age">
          <input value={age} onChange={(e) => setAge(Math.max(0, Math.min(64, Number(e.target.value.replace(/\D/g, "")) || 0)))} inputMode="numeric" className="w-[72px] h-11 rounded-full border border-line bg-surface px-4 font-mono text-[14px]" />
        </Field>
        <Field label="Yearly income (for tax credits)">
          <input value={income} onChange={(e) => setIncome(e.target.value.replace(/[^\d]/g, ""))} placeholder="optional" inputMode="numeric" className="w-[170px] h-11 rounded-full border border-line bg-surface px-4 font-mono text-[14px]" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Seg label="Worried about" value={a.fear} set={(v) => setA({ ...a, fear: v as Answers["fear"] })} opts={[["monthly", "Monthly bills"], ["surprise", "One giant bill"]]} />
          <Seg label="Care" value={a.use} set={(v) => setA({ ...a, use: v as Answers["use"] })} opts={[["rare", "Rarely"], ["some", "Sometimes"], ["lots", "Monthly"]]} />
          <Seg label="Keep a doctor" value={a.doctor ? "y" : "n"} set={(v) => setA({ ...a, doctor: v === "y" })} opts={[["n", "No"], ["y", "Yes"]]} />
        </div>
        <button type="submit" className="h-11 rounded-full bg-ink text-paper px-6 text-[14.5px]">
          Shop
        </button>
      </form>

      {resp?.ok && resp.healthcareGov === false && resp.stateMarketplace && (
        <a href={resp.stateMarketplace.url} target="_blank" rel="noreferrer" className="card p-6 block hover:bg-surface">
          <div className="eyebrow">Your state&rsquo;s marketplace</div>
          <div className="font-serif text-[2rem] mt-2">{resp.stateMarketplace.name}</div>
          <p className="text-dim text-[14px] mt-1">Plans there aren&rsquo;t in HealthCare.gov&rsquo;s data. Shop there, then upload the plan&rsquo;s Summary of Benefits here to decode it.</p>
        </a>
      )}

      {loading && (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <motion.div key={i} className="card-quiet h-[96px]" animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }} />
          ))}
        </div>
      )}

      {!loading && pick && (
        <>
          <Hero r={pick} explain={explain} yours={yours} currentName={current?.name ?? null} onChoose={() => onChoose(pick.p, a)} />
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-2">
              <span className="font-medium text-[17px]">Every plan, ranked.</span>
              <span className="text-dim text-[15px]">
                {rows.length} plans in {place}, each run through a normal year and a bad one. Tap one to see why it scored the way it did.
              </span>
            </div>
            {rows.slice(0, 25).map((r, i) => (
              <RankRow key={r.p.id} r={r} i={i} open={open === r.p.id} toggle={() => setOpen(open === r.p.id ? null : r.p.id)} onChoose={() => onChoose(r.p, a)} />
            ))}
          </div>
          <div className="text-[11.5px] text-faint space-y-0.5 pt-2">
            {SHOP_SOURCES.map((s) => (
              <p key={s}>{s}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] text-faint mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Seg({ label, value, set, opts }: { label: string; value: string; set: (v: string) => void; opts: [string, string][] }) {
  return (
    <div>
      <span className="block text-[12px] text-faint mb-1.5">{label}</span>
      <div className="flex rounded-full border border-line p-1 bg-surface">
        {opts.map(([v, l]) => (
          <button key={v} type="button" onClick={() => set(v)} className={`relative h-9 px-3.5 rounded-full text-[13px] ${value === v ? "text-paper" : "text-dim"}`}>
            {value === v && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", duration: 0.35, bounce: 0 }} />}
            <span className="relative">{l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Parts({ r }: { r: ShopRow }) {
  return (
    <div className="space-y-3">
      {r.parts.map((p, i) => (
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
              transition={{ duration: 0.8, delay: 0.2 + i * 0.08, ease: EASE }}
            />
          </div>
          <div className="text-[12px] text-faint mt-1">{p.why}</div>
        </div>
      ))}
    </div>
  );
}

function Hero({ r, explain, yours, currentName, onChoose }: { r: ShopRow; explain: Explain | null; yours: { typical: number; bad: number; noPremium: boolean } | null; currentName: string | null; onChoose: () => void }) {
  const monthly = r.p.premiumWithCredit ?? r.p.premium ?? 0;
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="card p-6 sm:p-8 relative overflow-hidden">
      <div className="absolute -right-16 -top-16 size-64 rounded-full opacity-40 blur-3xl pointer-events-none" style={{ background: "radial-gradient(circle, var(--mint), transparent 70%)" }} />
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <div className="eyebrow">My pick for you</div>
          <div className="font-serif text-[2.2rem] sm:text-[2.8rem] leading-[1.02] mt-2">{r.p.name}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
            {[r.p.issuer, r.p.metal, r.p.type, r.p.hsa ? "HSA" : null, r.stars ? `${r.stars} stars` : null].filter(Boolean).map((t) => (
              <span key={t as string} className="rounded-full bg-sage px-3 py-1">
                {t}
              </span>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-4">
            <Stat label="Per month" value={usd(monthly)} note={r.p.premiumWithCredit !== null && r.p.premiumWithCredit !== r.p.premium ? "after tax credit" : "list price"} />
            <Stat label="Normal year" value={usd(r.typical)} note="all in" />
            <Stat label="Bad year" value={usd(r.bad)} note="all in" tone="coral" />
          </div>
          {yours && currentName && (
            <div className="mt-5 text-[14px] text-dim">
              Versus {currentName}{yours.noPremium ? " (someone else pays its premium)" : ""}: a normal year is{" "}
              <span className={`font-mono ${r.typical <= yours.typical ? "text-moss" : "text-coral"}`}>{usd(Math.abs(yours.typical - r.typical))}</span> {r.typical <= yours.typical ? "cheaper" : "more"}, a bad year{" "}
              <span className={`font-mono ${r.bad <= yours.bad ? "text-moss" : "text-coral"}`}>{usd(Math.abs(yours.bad - r.bad))}</span> {r.bad <= yours.bad ? "cheaper" : "more"}.
            </div>
          )}
          <AnimatePresence>
            {explain?.summary && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-3 text-[15px] leading-relaxed">
                <p>{explain.summary}</p>
                {explain.watchOut && (
                  <p>
                    <span className="text-coral font-medium">Watch out: </span>
                    {explain.watchOut}
                  </p>
                )}
                <p className="text-[11.5px] text-faint">Written by Gemini from the numbers on this page. The ranking itself is computed, not written.</p>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={onChoose} className="rounded-full bg-ink text-paper h-12 px-6 text-[15px]">
              Make it mine and see my plan
            </button>
            {(r.p.urls.benefits || r.p.urls.brochure) && (
              <a href={(r.p.urls.benefits || r.p.urls.brochure)!} target="_blank" rel="noreferrer" className="rounded-full border border-line h-12 px-6 text-[15px] inline-flex items-center">
                The insurer&rsquo;s summary
              </a>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-4">
            <span className="eyebrow">Why it won</span>
            <span className="font-serif text-[2.4rem] leading-none">
              {r.score}
              <span className="text-dim text-[1rem]">/100</span>
            </span>
          </div>
          <Parts r={r} />
          <ul className="mt-5 space-y-2 text-[13.5px]">
            {r.pros.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-moss" />
                {t}
              </li>
            ))}
            {r.cons.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-coral" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "coral" }) {
  return (
    <div>
      <div className="text-[12px] text-faint">{label}</div>
      <div className={`font-serif text-[1.9rem] leading-none mt-1 ${tone === "coral" ? "text-coral" : ""}`}>{value}</div>
      <div className="text-[11.5px] text-faint mt-1">{note}</div>
    </div>
  );
}

function RankRow({ r, i, open, toggle, onChoose }: { r: ShopRow; i: number; open: boolean; toggle: () => void; onChoose: () => void }) {
  const monthly = r.p.premiumWithCredit ?? r.p.premium ?? 0;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.03, ease: EASE }} className="card-quiet overflow-hidden">
      <button type="button" onClick={toggle} className="w-full text-left p-4 sm:px-5 grid gap-3 grid-cols-[28px_minmax(0,1fr)_auto] sm:grid-cols-[28px_minmax(0,1fr)_repeat(4,92px)_120px] items-center">
        <span className="font-mono text-[12px] text-faint">{String(i + 1).padStart(2, "0")}</span>
        <span className="min-w-0">
          <span className="block text-[14.5px] truncate">{r.p.name}</span>
          <span className="block text-[12px] text-faint truncate">{[r.p.issuer, r.p.metal, r.p.type].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="hidden sm:block text-right font-mono text-[13px]">
          {usd(monthly)}
          <span className="block text-[11px] text-faint font-sans">a month</span>
        </span>
        <span className="hidden sm:block text-right font-mono text-[13px]">
          {usd(r.typical)}
          <span className="block text-[11px] text-faint font-sans">normal yr</span>
        </span>
        <span className="hidden sm:block text-right font-mono text-[13px] text-coral">
          {usd(r.bad)}
          <span className="block text-[11px] text-faint font-sans">bad yr</span>
        </span>
        <span className="hidden sm:block text-right text-[12.5px]">
          {r.stars ? `${"★".repeat(r.stars)}` : "unrated"}
          <span className="block text-[11px] text-faint">{r.denialRate === null ? "no denial data" : `${r.denialRate.toFixed(1)}% denied`}</span>
        </span>
        <span className="flex items-center gap-2 justify-end">
          <span className="w-16 h-1.5 rounded-full bg-line overflow-hidden">
            <span className="block h-full rounded-full bg-moss" style={{ width: `${r.score}%` }} />
          </span>
          <span className="font-mono text-[13px] w-7 text-right">{r.score}</span>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-5 pb-5 grid gap-6 lg:grid-cols-2">
              <Parts r={r} />
              <div>
                <ul className="space-y-2 text-[13.5px]">
                  {[...r.pros.map((t) => ["p", t]), ...r.cons.map((t) => ["c", t])].map(([k, t]) => (
                    <li key={t} className="flex gap-2">
                      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${k === "p" ? "bg-moss" : "bg-coral"}`} />
                      {t}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={onChoose} className="mt-4 rounded-full bg-ink text-paper h-10 px-5 text-[14px]">
                  Make it mine
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
