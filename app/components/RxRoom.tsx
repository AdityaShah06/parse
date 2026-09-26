"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { runYear, type CareEvent, type Plan } from "@/lib/engine";
import { RX, RX_GROUPS, RX_SERVICE, type RxItem } from "@/lib/kb/rx";
import { CASH, withCash } from "@/lib/other-plans";
import { usd } from "@/lib/catalog";
import Money from "./Money";
import SampleBadge from "./SampleBadge";

type Freq = "once" | "quarterly" | "monthly";
const FREQ: { id: Freq; label: string; months: number[] }[] = [
  { id: "once", label: "Once", months: [3] },
  { id: "quarterly", label: "Every 3 months", months: [1, 4, 7, 10] },
  { id: "monthly", label: "Every month", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
];

function purchases(item: RxItem, freq: Freq, cash: boolean): CareEvent[] {
  const months = FREQ.find((f) => f.id === freq)!.months;
  return months.map((m) => ({
    date: `2026-${String(m).padStart(2, "0")}-05`,
    label: cash ? `${item.name}, cash` : item.name,
    serviceType: cash ? CASH : RX_SERVICE[item.kind],
    allowedAmount: cash ? item.cashPrice : item.planPrice,
  }));
}

/**
 * The same purchase two ways, over the whole year. Both totals come from
 * runYear with the rest of your year included, because whether cash wins
 * depends on whether you would have reached your deductible anyway: cash
 * usually does not count toward it.
 */
export default function RxRoom({
  plan,
  baseEvents,
  uninsured,
}: {
  plan: Plan;
  baseEvents: CareEvent[];
  uninsured: boolean;
}) {
  const [query, setQuery] = useState("");
  const [item, setItem] = useState<RxItem>(RX[0]);
  const [freq, setFreq] = useState<Freq>(RX[0].typically);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? RX.filter((r) => `${r.name} ${r.detail}`.toLowerCase().includes(q)) : RX;
  }, [query]);

  const cashPlan = useMemo(() => withCash(plan), [plan]);
  const viaPlan = useMemo(
    () => runYear([...baseEvents, ...purchases(item, freq, false)], plan),
    [baseEvents, item, freq, plan]
  );
  const viaCash = useMemo(
    () => runYear([...baseEvents, ...purchases(item, freq, true)], cashPlan),
    [baseEvents, item, freq, cashPlan]
  );

  const cashWins = viaCash.patientTotal < viaPlan.patientTotal;
  const same = viaCash.patientTotal === viaPlan.patientTotal;
  const planLabel = uninsured ? "Full price" : "Through your plan";

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-3xl">Prescriptions and tests: cash or card?</h2>
          <p className="text-sm text-dim mt-1 max-w-xl">
            Sometimes paying cash beats your insurance. Sometimes it only looks that way, because cash
            usually doesn&rsquo;t count toward your deductible. This checks your whole year.
          </p>
        </div>
        <SampleBadge label="Typical prices, not a quote" />
      </div>

      {/* Picker */}
      <div className="space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a medication or a test"
          aria-label="Search a medication or a test"
          className="w-full min-h-12 rounded-full border border-line bg-surface px-5 outline-none focus:border-ink text-[15px]"
        />
        {RX_GROUPS.map((g) => {
          const rows = matches.filter((r) => g.kinds.includes(r.kind));
          if (!rows.length) return null;
          return (
            <div key={g.label}>
              <div className="text-[13px] text-dim mb-2">{g.label}</div>
              <div className="flex flex-wrap gap-2">
                {rows.map((r) => (
                  <motion.button
                    key={r.id}
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      setItem(r);
                      setFreq(r.typically);
                    }}
                    aria-pressed={r.id === item.id}
                    className={`min-h-10 px-4 rounded-full border text-[14px] transition-colors ${
                      r.id === item.id ? "bg-ink text-surface border-ink" : "bg-surface border-line hover:border-ink"
                    }`}
                  >
                    {r.name}
                  </motion.button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* The comparison */}
      <div className="rounded-[22px] border border-line bg-surface/80 p-5 lg:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
          <div>
            <div className="font-serif text-2xl">{item.name}</div>
            <div className="text-[13px] text-dim">{item.detail}</div>
          </div>
          <div className="flex gap-1 rounded-full border border-line p-1 bg-paper">
            {FREQ.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFreq(f.id)}
                aria-pressed={f.id === freq}
                className={`px-3 min-h-9 rounded-full text-[13px] ${f.id === freq ? "bg-ink text-surface" : "text-dim hover:text-ink"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {[
            { key: "plan", label: planLabel, price: item.planPrice, who: uninsured ? "What the pharmacy or lab charges" : "What your plan gets billed", total: viaPlan.patientTotal, win: !cashWins && !same },
            { key: "cash", label: "Paying cash", price: item.cashPrice, who: item.cashSeller, total: viaCash.patientTotal, win: cashWins },
          ].map((c) => (
            <motion.div
              key={c.key}
              layout
              className={`rounded-[16px] border p-4 ${c.win ? "border-ink bg-surface" : "border-line"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[14px]">{c.label}</span>
                <AnimatePresence>
                  {c.win && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-[12px] rounded-full bg-ink text-surface px-2.5 py-0.5"
                    >
                      Cheaper this year
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <div className="text-[13px] text-dim mt-2">
                {usd(c.price)} per purchase, {c.who.toLowerCase()}
              </div>
              <div className="mt-4 text-[13px] text-dim">Everything you pay for care this year</div>
              <div className="font-serif text-4xl text-red leading-none mt-1">
                <Money value={c.total} />
              </div>
            </motion.div>
          ))}
        </div>

        <p className="mt-5 font-serif text-xl leading-snug" aria-live="polite">
          {same
            ? "Same either way this year."
            : cashWins
              ? "Pay cash for this one."
              : uninsured
                ? "The regular price wins here."
                : "Use your insurance for this one."}
        </p>
        <ul className="mt-3 space-y-1 text-[13px] text-dim">
          <li>Cash purchases usually don&rsquo;t count toward your deductible. Some plans let you mail in the receipt so they do: ask your insurer.</li>
          <li>At the counter, ask the pharmacist to run both prices. They see the real numbers before you pay.</li>
        </ul>
      </div>
    </div>
  );
}
