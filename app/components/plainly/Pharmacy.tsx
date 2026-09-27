"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CareEvent } from "@/lib/engine";
import type { MyPlan } from "@/lib/my-plan";
import { BENEFIT } from "@/lib/load-plans";
import { eventCost, visitDate } from "@/lib/care";
import { usd } from "@/lib/catalog";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import { useTheme } from "./theme";

type Option = {
  id: string;
  kind: "cost-plus" | "nadac-benchmark" | "program" | "manufacturer" | "insurance";
  title: string;
  price: number | null;
  priceNote: string;
  eligibility: string;
  countsTowardDeductible: "no" | "usually-no" | "yes" | "ask-plan";
  privacy: string;
  url: string | null;
  source: string;
  asOf: string | null;
  extraEstimate?: number;
  allowedAmountEstimate?: number;
  reported?: boolean;
};
type Drug = { rxcui: string; name: string; ingredient: string; brand: string | null; strength: string; form: string; generic: boolean };
type Result = { drug: Drug | null; options: Option[]; notes: string[]; attribution: string[] };
type Suggestion = { name: string; strengths: string[] };

const EASE = [0.23, 1, 0.32, 1] as const;
const COUNTS: Record<Option["countsTowardDeductible"], { text: string; tone: string }> = {
  yes: { text: "Counts toward your deductible", tone: "bg-sage text-moss" },
  "ask-plan": { text: "Ask your plan if it counts", tone: "bg-gold/25 text-ink" },
  "usually-no": { text: "Usually doesn't count toward your deductible", tone: "bg-coral/15 text-coral" },
  no: { text: "Doesn't count toward your deductible", tone: "bg-coral/15 text-coral" },
};

/**
 * Room: the cheapest honest way to fill a prescription. Live prices from Cost
 * Plus Drugs' public API, the federal NADAC benchmark, cited cash programs,
 * and your own plan run through the engine. No discount card, no tracking.
 */
export default function Pharmacy({ my, events }: { my: MyPlan; events: CareEvent[] }) {
  const [theme] = useTheme();
  const night = theme === "night";
  const [q, setQ] = useState("sertraline 50 mg");
  const [draft, setDraft] = useState("sertraline 50 mg");
  const [qty, setQty] = useState(30);
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [coverage, setCoverage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setCoverage(null);
    fetch(`/api/rx?q=${encodeURIComponent(q)}&qty=${qty}&days=${qty}`)
      .then((r) => r.json())
      .then((j) => alive && setRes(j.ok ? j : { drug: null, options: [], notes: [j.error ?? "Lookup failed."], attribution: [] }))
      .catch(() => alive && setRes({ drug: null, options: [], notes: ["Couldn't reach the drug price services."], attribution: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q, qty]);

  // Formulary check from CMS when we know the plan id.
  useEffect(() => {
    if (!my.hiosId || !res?.drug) return;
    let alive = true;
    fetch(`/api/drug-coverage?planId=${my.hiosId}&rxcuis=${res.drug.rxcui}`)
      .then((r) => r.json())
      .then((j) => alive && setCoverage(j.ok ? j.results?.[0]?.coverage ?? null : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [my.hiosId, res?.drug]);

  const onType = (v: string) => {
    setDraft(v);
    clearTimeout(timer.current);
    if (v.trim().length < 3) return setSugg([]);
    timer.current = setTimeout(() => {
      fetch(`/api/rx?suggest=${encodeURIComponent(v.trim())}`)
        .then((r) => r.json())
        .then((j) => setSugg(j.ok ? (j.suggestions ?? []).slice(0, 6) : []))
        .catch(() => setSugg([]));
    }, 250);
  };

  // Your plan: the insurance row's allowed amount, run through the engine.
  const planRow = useMemo(() => {
    const ins = res?.options.find((o) => o.kind === "insurance");
    if (!ins?.allowedAmountEstimate || !res?.drug) return null;
    const serviceType = res.drug.generic ? BENEFIT.GENERIC_DRUGS : BENEFIT.BRAND_DRUGS;
    const c = eventCost(my.plan, events, { date: visitDate(), label: res.drug.name, serviceType, allowedAmount: ins.allowedAmountEstimate });
    return { you: c.you, allowed: ins.allowedAmountEstimate, opt: ins };
  }, [res, my.plan, events]);

  const priced = useMemo(() => {
    const rows = (res?.options ?? []).filter((o) => o.kind !== "insurance" && o.kind !== "nadac-benchmark");
    return rows.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  }, [res]);
  const benchmark = res?.options.find((o) => o.kind === "nadac-benchmark");
  const best = priced.find((o) => o.price !== null);
  const cashWins = planRow && best?.price != null && best.price + (best.extraEstimate ?? 0) < planRow.you;

  const lines = loading
    ? ["Pricing it everywhere at once."]
    : !res?.drug
      ? ["I couldn't find that one.", "Try the generic name and a strength, like sertraline 50 mg."]
      : cashWins
        ? [`Cash beats your card here.`, `${best!.title.split(",")[0]} is cheaper than your plan's price.`]
        : ["Your plan is the better deal for this one.", "And it counts toward your deductible."];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={loading ? "thinking" : cashWins ? "happy" : "calm"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic key={lines.join("|")} lines={lines} size="lg" />
        </div>
      </div>

      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            setQ(draft.trim());
            setSugg([]);
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={draft}
            onChange={(e) => onType(e.target.value)}
            placeholder="A drug and strength, like atorvastatin 20 mg"
            className="flex-1 min-w-[240px] h-14 rounded-full border border-line bg-surface px-6 text-[16px]"
            aria-label="Drug name"
          />
          <div className="flex rounded-full border border-line p-1 bg-surface">
            {[30, 60, 90].map((n) => (
              <button key={n} type="button" onClick={() => setQty(n)} className={`relative h-11 px-4 rounded-full text-[14px] ${qty === n ? "text-paper" : "text-dim"}`}>
                {qty === n && <motion.span layoutId="rx-qty" className="absolute inset-0 rounded-full bg-ink" />}
                <span className="relative">{n} days</span>
              </button>
            ))}
          </div>
          <button type="submit" className="h-14 rounded-full bg-ink text-paper px-7 text-[15px]">
            Compare
          </button>
        </div>
        <AnimatePresence>
          {sugg.length > 0 && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute z-20 left-0 right-0 sm:right-auto sm:w-[520px] mt-2 card p-2">
              {sugg.flatMap((s) =>
                (s.strengths.length ? s.strengths.slice(0, 3) : [""]).map((st) => (
                  <button
                    key={s.name + st}
                    type="button"
                    onClick={() => {
                      const v = `${s.name.replace(/\s*\(.*\)\s*/, " ").trim()} ${st}`.trim();
                      setDraft(v);
                      setQ(v);
                      setSugg([]);
                    }}
                    className="block w-full text-left px-4 py-2.5 rounded-xl hover:bg-sage text-[14.5px]"
                  >
                    {s.name} <span className="text-dim">{st}</span>
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </form>

      {res?.drug && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-serif text-[1.9rem] leading-none">{res.drug.name}</span>
          <span className="text-dim text-[14px]">{res.drug.generic ? "Generic" : `Brand${res.drug.brand ? `: ${res.drug.brand}` : ""}`}</span>
          {coverage && (
            <span className={`rounded-full text-[12px] px-2.5 py-1 ${coverage === "Covered" || coverage === "GenericCovered" ? "bg-sage text-moss" : coverage === "NotCovered" ? "bg-coral/15 text-coral" : "border border-line text-faint"}`}>
              {coverage === "Covered" ? "On your plan's formulary" : coverage === "GenericCovered" ? "Generic version covered" : coverage === "NotCovered" ? "Not on your plan's formulary" : "Plan didn't report this drug"}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] items-start">
        <div className="space-y-3">
          {loading &&
            [0, 1, 2].map((i) => <motion.div key={i} className="card-quiet h-[120px]" animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }} />)}
          {!loading && planRow && (
            <OptionCard
              title={`Through ${my.kind === "uninsured" ? "no insurance" : "your plan"}`}
              price={planRow.you}
              highlight={!cashWins}
              note={`Your plan's rules applied to an estimated billed amount of ${usd(planRow.allowed)} (what pharmacies pay, plus a typical dispensing fee). Your real copay can differ by tier.`}
              counts="yes"
              eligibility="Fill at any in-network pharmacy."
              privacy="Your pharmacy and plan see the claim, as with any insured fill."
              i={0}
            />
          )}
          {!loading &&
            priced.map((o, i) => (
              <OptionCard
                key={o.id}
                title={o.title}
                price={o.price}
                extra={o.extraEstimate}
                highlight={!!cashWins && o === best}
                note={o.priceNote}
                counts={o.countsTowardDeductible}
                eligibility={o.eligibility}
                privacy={o.privacy}
                url={o.url}
                source={o.source}
                reported={o.reported}
                i={i + 1}
              />
            ))}
          {!loading && res?.notes?.length ? <div className="text-[12.5px] text-faint space-y-1">{res.notes.map((n) => <p key={n}>{n}</p>)}</div> : null}
        </div>

        <div className="space-y-4 xl:sticky xl:top-6">
          {benchmark && (
            <div className="card p-5">
              <div className="eyebrow">What pharmacies pay</div>
              <div className="font-serif text-[2.4rem] leading-none mt-3">{usd(benchmark.price ?? 0)}</div>
              <p className="text-[13px] text-dim mt-2 leading-snug">{benchmark.priceNote}</p>
              <div className="text-[11.5px] text-faint mt-3">{benchmark.source}{benchmark.asOf ? `, as of ${benchmark.asOf}` : ""}</div>
            </div>
          )}
          <div className="card-quiet p-5 text-[13.5px] leading-relaxed">
            <div className="font-medium">Why there&rsquo;s no discount card here</div>
            <p className="text-dim mt-1.5">
              In 2023 the FTC fined GoodRx $1.5 million for sharing people&rsquo;s medications and health conditions with advertisers including Facebook and Google. This page sends only a drug name and quantity, from our server, and stores nothing.
            </p>
            <a className="underline text-[12.5px] mt-2 inline-block" href="https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising" target="_blank" rel="noreferrer">
              FTC press release
            </a>
          </div>
          {res?.attribution?.length ? <div className="text-[11px] text-faint space-y-1">{res.attribution.map((a) => <p key={a}>{a}</p>)}</div> : null}
        </div>
      </div>
    </section>
  );
}

function OptionCard({
  title,
  price,
  extra,
  highlight,
  note,
  counts,
  eligibility,
  privacy,
  url,
  source,
  reported,
  i,
}: {
  title: string;
  price: number | null;
  extra?: number;
  highlight?: boolean;
  note: string;
  counts: Option["countsTowardDeductible"];
  eligibility: string;
  privacy: string;
  url?: string | null;
  source?: string;
  reported?: boolean;
  i: number;
}) {
  const [open, setOpen] = useState(false);
  const c = COUNTS[counts];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: i * 0.05, ease: EASE }}
      className={`p-5 rounded-[22px] border transition-colors ${highlight ? "border-moss/50 bg-sage/60" : "border-line bg-surface/60"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[15.5px] font-medium">{title}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`rounded-full text-[11.5px] px-2.5 py-1 ${c.tone}`}>{c.text}</span>
            {reported && <span className="rounded-full border border-line text-faint text-[11.5px] px-2.5 py-1">Reported, not confirmed</span>}
            {highlight && <span className="rounded-full bg-moss text-paper text-[11.5px] px-2.5 py-1">Best here</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-serif text-[2rem] leading-none">{price === null ? "Varies" : usd(price)}</div>
          {extra ? <div className="text-[11.5px] text-faint mt-1">+ about {usd(extra)} shipping</div> : null}
        </div>
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-3 text-[12.5px] text-dim hover:text-ink">
        {open ? "Less" : "Details"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="pt-3 space-y-2 text-[13px] leading-snug">
              <p>{note}</p>
              <p className="text-dim">Who can use it: {eligibility}</p>
              <p className="text-dim">Privacy: {privacy}</p>
              {url && (
                <a href={url} target="_blank" rel="noreferrer" className="underline text-[12.5px]">
                  {source ?? "Source"}
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
