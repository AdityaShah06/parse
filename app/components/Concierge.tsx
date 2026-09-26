"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import Orb from "./Orb";
import { ConfirmDecoded, DecodeAsk } from "./DecodePlan";
import { QUESTIONS, isMissouriZip, type Action, type Profile, type Source } from "@/lib/profile";
import { COPAY_LABELS, TYPICAL, type CopayKey } from "@/lib/card";
import { HABITS, PERSONAS, SURPRISES, surpriseHasAmbulance } from "@/lib/scenarios";
import { AMBULANCE_BALANCE_BILL } from "@/lib/prices";
import { usd } from "@/lib/catalog";
import type { YearResult } from "@/lib/engine";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Focus without yanking the page: autoFocus scrolls the window on open. */
function useCalmFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

/** Words fade up one after another, quickly. */
function Reveal({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <span>
      {words.map((w, i) => (
        <motion.span
          key={i}
          className="inline-block mr-[0.28em]"
          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: i * 0.028, duration: 0.3, ease: "easeOut" }}
        >
          {w}
        </motion.span>
      ))}
    </span>
  );
}

function Chip({
  children,
  onClick,
  active = false,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  primary?: boolean;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      aria-pressed={active || undefined}
      className={`min-h-11 px-4 rounded-full border text-[15px] transition-colors ${
        primary
          ? "bg-ink text-surface border-ink"
          : active
            ? "bg-blue text-surface border-blue"
            : "bg-surface border-line hover:border-ink"
      }`}
    >
      {children}
    </motion.button>
  );
}

function NumberAsk({
  prefix,
  suffix,
  placeholder,
  onSubmit,
  extra,
}: {
  prefix?: string;
  suffix?: string;
  placeholder: string;
  onSubmit: (n: number) => void;
  extra?: ReactNode;
}) {
  const [v, setV] = useState("");
  const focus = useCalmFocus<HTMLInputElement>();
  const n = Number(v.replace(/[,$%\s]/g, ""));
  const ok = v.trim() !== "" && Number.isFinite(n) && n >= 0;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(n);
      }}
    >
      <label className="flex items-center min-h-11 rounded-full border border-ink bg-surface pl-4 pr-3 focus-within:ring-2 focus-within:ring-blue/40">
        {prefix && <span className="text-dim mr-1">{prefix}</span>}
        <input
          ref={focus}
          inputMode="decimal"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-28 bg-transparent outline-none font-serif text-2xl tabular"
        />
        {suffix && <span className="text-dim ml-1">{suffix}</span>}
      </label>
      <Chip primary onClick={() => ok && onSubmit(n)}>
        Continue
      </Chip>
      {extra}
    </form>
  );
}

function CopayAsk({ onSubmit }: { onSubmit: (c: Partial<Record<CopayKey, number>>) => void }) {
  const [vals, setVals] = useState<Partial<Record<CopayKey, string>>>({});
  const parsed = () => {
    const out: Partial<Record<CopayKey, number>> = {};
    for (const [k, v] of Object.entries(vals)) {
      const n = Number((v ?? "").replace(/[,$\s]/g, ""));
      if ((v ?? "").trim() !== "" && Number.isFinite(n) && n >= 0) out[k as CopayKey] = n;
    }
    return out;
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(COPAY_LABELS) as CopayKey[]).map((k) => (
          <label
            key={k}
            className="flex items-center justify-between gap-2 rounded-[14px] border border-line bg-surface px-3 py-2 focus-within:border-ink"
          >
            <span className="text-[13px] text-dim leading-tight">{COPAY_LABELS[k]}</span>
            <span className="flex items-center">
              <span className="text-dim">$</span>
              <input
                inputMode="decimal"
                value={vals[k] ?? ""}
                onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                aria-label={`${COPAY_LABELS[k]} copay`}
                placeholder="-"
                className="w-12 bg-transparent outline-none font-serif text-xl tabular text-right"
              />
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip primary onClick={() => onSubmit(parsed())}>
          Continue
        </Chip>
        <Chip onClick={() => onSubmit({})}>My card doesn&rsquo;t show any</Chip>
      </div>
    </div>
  );
}

function ZipAsk({ onSubmit }: { onSubmit: (zip: string) => void }) {
  const [v, setV] = useState("");
  const focus = useCalmFocus<HTMLInputElement>();
  const ok = /^\d{5}$/.test(v);
  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSubmit(v);
        }}
      >
        <input
          ref={focus}
          inputMode="numeric"
          maxLength={5}
          value={v}
          onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
          placeholder="ZIP code"
          aria-label="ZIP code"
          className="min-h-11 w-36 rounded-full border border-ink bg-surface px-4 outline-none font-serif text-2xl tabular focus:ring-2 focus:ring-blue/40"
        />
        <Chip primary onClick={() => ok && onSubmit(v)}>
          Continue
        </Chip>
      </form>
      <div className="flex flex-wrap gap-2">
        <Chip onClick={() => onSubmit("65201")}>Columbia, 65201</Chip>
        <Chip onClick={() => onSubmit("63501")}>Kirksville, 63501</Chip>
      </div>
    </div>
  );
}

/** Five ways in. Each becomes the same engine Plan. */
const DOORS: { source: Source; label: string }[] = [
  { source: "employer", label: "A parent's or employer's plan" },
  { source: "marketplace", label: "A plan I bought myself" },
  { source: "student", label: "My school's student plan" },
  { source: "medicaid", label: "Medicaid (MO HealthNet)" },
  { source: "uninsured", label: "No insurance right now" },
];

/** The live input for the current step. */
function StepInput({ p, dispatch }: { p: Profile; dispatch: Dispatch<Action> }) {
  switch (p.step) {
    case "welcome":
      return (
        <div className="space-y-4">
          <Chip primary onClick={() => dispatch({ type: "start" })}>
            Let&rsquo;s start
          </Chip>
          <div>
            <p className="text-[13px] text-dim mb-2">Or start from an example person</p>
            <div className="flex flex-wrap gap-2">
              {PERSONAS.map((x) => (
                <Chip key={x.id} onClick={() => dispatch({ type: "persona", id: x.id })}>
                  {x.name}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      );

    case "zip":
      return <ZipAsk onSubmit={(zip) => dispatch({ type: "zip", zip })} />;

    case "source":
      return (
        <div className="space-y-3">
          {p.zip && !isMissouriZip(p.zip) && (
            <p className="text-[13px] text-dim">
              I only have Missouri plans loaded so far. A plan summary or card numbers work
              anywhere, so the first and third options still run your real plan.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {DOORS.map((d) => (
              <Chip key={d.label} onClick={() => dispatch({ type: "source", source: d.source, label: d.label })}>
                {d.label}
              </Chip>
            ))}
          </div>
        </div>
      );

    case "decode":
      return <DecodeAsk dispatch={dispatch} />;

    case "confirm":
      return p.decoded ? <ConfirmDecoded decoded={p.decoded} dispatch={dispatch} /> : null;

    case "deductible":
      return (
        <NumberAsk
          prefix="$"
          placeholder="2,000"
          onSubmit={(n) => dispatch({ type: "cardNumber", field: "deductible", value: n })}
          extra={
            <Chip onClick={() => dispatch({ type: "cardNumber", field: "deductible", value: null })}>
              I don&rsquo;t know
            </Chip>
          }
        />
      );

    case "coinsurance":
      return (
        <div className="space-y-2">
          <NumberAsk
            suffix="%"
            placeholder="20"
            onSubmit={(n) => dispatch({ type: "cardNumber", field: "coinsurancePct", value: Math.min(n, 100) })}
            extra={
              <Chip onClick={() => dispatch({ type: "cardNumber", field: "coinsurancePct", value: null })}>
                I don&rsquo;t know
              </Chip>
            }
          />
          <div className="flex gap-2">
            {[10, 20, 30].map((n) => (
              <Chip key={n} onClick={() => dispatch({ type: "cardNumber", field: "coinsurancePct", value: n })}>
                {n}%
              </Chip>
            ))}
          </div>
        </div>
      );

    case "ceiling":
      return (
        <NumberAsk
          prefix="$"
          placeholder="5,000"
          onSubmit={(n) => dispatch({ type: "cardNumber", field: "outOfPocketMax", value: n })}
          extra={
            <Chip onClick={() => dispatch({ type: "cardNumber", field: "outOfPocketMax", value: null })}>
              I don&rsquo;t know
            </Chip>
          }
        />
      );

    case "copays":
      return <CopayAsk onSubmit={(copays) => dispatch({ type: "copays", copays })} />;

    case "premium":
      return (
        <NumberAsk
          prefix="$"
          suffix="/mo"
          placeholder="0"
          onSubmit={(n) => dispatch({ type: "premium", value: n, label: `${usd(n)} a month` })}
          extra={
            <Chip onClick={() => dispatch({ type: "premium", value: 0, label: "Someone else pays it" })}>
              Someone else pays it
            </Chip>
          }
        />
      );

    case "habits":
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {HABITS.map((h) => (
              <Chip
                key={h.id}
                active={p.habits.includes(h.id)}
                onClick={() => dispatch({ type: "toggleHabit", id: h.id })}
              >
                {h.label}
              </Chip>
            ))}
          </div>
          <Chip
            primary
            onClick={() =>
              dispatch({
                type: "habitsDone",
                label: p.habits.length
                  ? HABITS.filter((h) => p.habits.includes(h.id)).map((h) => h.label.toLowerCase()).join(", ")
                  : "Honestly, I barely see a doctor",
              })
            }
          >
            That&rsquo;s my year
          </Chip>
        </div>
      );

    case "surprise":
      return <SurpriseControls p={p} dispatch={dispatch} />;

    case "done":
      return null;
  }
}

export function SurpriseControls({ p, dispatch, compact = false }: { p: Profile; dispatch: Dispatch<Action>; compact?: boolean }) {
  const surprise = SURPRISES[p.surprise];
  return (
    <div className="space-y-4">
      <div>
        <div className="font-serif text-3xl mb-3" aria-live="polite">
          {surprise.label}
        </div>
        <input
          type="range"
          className="ladder"
          min={0}
          max={SURPRISES.length - 1}
          step={1}
          value={p.surprise}
          onChange={(e) => dispatch({ type: "surprise", index: Number(e.target.value) })}
          aria-label="Something unexpected"
          aria-valuetext={surprise.label}
        />
        <div className="flex justify-between text-[12px] text-dim mt-2">
          <span>Nothing</span>
          <span>Car crash</span>
        </div>
      </div>

      <label className="flex items-center gap-3 text-[14px]">
        <span className="text-dim">In</span>
        <select
          value={p.month}
          onChange={(e) => dispatch({ type: "month", month: Number(e.target.value) })}
          disabled={p.surprise === 0}
          className="min-h-11 border border-line bg-surface rounded-full px-4 disabled:opacity-50"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-dim">Your deductible resets January 1.</span>
      </label>

      {surpriseHasAmbulance(surprise) && (
        <label className="flex gap-3 items-start cursor-pointer">
          <input
            type="checkbox"
            checked={p.oon}
            onChange={(e) => dispatch({ type: "oon", value: e.target.checked })}
            className="mt-1 size-4 accent-[var(--color-breach)]"
          />
          <span className="text-[14px]">
            The ambulance was out of network
            <span className="block text-[13px] text-dim">
              Federal surprise billing law leaves out ground ambulances, so the company can bill you
              the difference. Those bills averaged {usd(AMBULANCE_BALANCE_BILL.amount)} in 2021, the
              latest data we found. In an emergency, call 911 anyway.
            </span>
          </span>
        </label>
      )}

      {!compact && (
        <Chip primary onClick={() => dispatch({ type: "surpriseDone", label: `${surprise.label}${p.surprise ? ` in ${MONTHS[p.month - 1]}` : ""}` })}>
          Show me what that costs
        </Chip>
      )}
    </div>
  );
}

export default function Concierge({
  p,
  dispatch,
  year,
  estimatedCount,
  hero = false,
}: {
  p: Profile;
  dispatch: Dispatch<Action>;
  year: YearResult | null;
  estimatedCount: number;
  /** Centered on the landing screen before the visitor has answered. */
  hero?: boolean;
}) {
  // A short "thinking" beat between questions. Purely theatrical.
  const [thinking, setThinking] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setThinking(true);
    const t = setTimeout(() => setThinking(false), 420);
    return () => clearTimeout(t);
  }, [p.step]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [p.transcript.length, thinking]);

  return (
    <section
      aria-label="Concierge"
      className={`flex flex-col rounded-[26px] border border-line bg-surface/90 backdrop-blur-sm shadow-[0_30px_80px_-40px_rgb(14_44_64/0.35)] ${
        hero ? "h-[min(600px,72vh)]" : "lg:h-[calc(100vh-7rem)] lg:min-h-[620px]"
      }`}
    >
      <header className="flex items-center gap-3 px-5 py-4 border-b border-line">
        <Orb thinking={thinking} />
        <div className="min-w-0">
          <div className="font-serif text-xl leading-none">Your guide</div>
          <div className="text-[12px] text-dim mt-1">Plain English. Math from real 2026 plan rules.</div>
        </div>
        {p.step !== "welcome" && (
          <button
            type="button"
            onClick={() => dispatch({ type: "restart" })}
            className="ml-auto text-[13px] text-dim underline underline-offset-4 decoration-line hover:text-ink"
          >
            Start over
          </button>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-5 space-y-4" aria-live="polite">
        {p.transcript.map((t) =>
          t.who === "ai" ? (
            <p key={t.id} className="text-[15px] leading-relaxed text-dim max-w-[36ch]">
              {t.text}
            </p>
          ) : (
            <motion.p
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-[6px] bg-ink text-surface px-4 py-2 text-[15px]"
            >
              {t.text}
            </motion.p>
          )
        )}

        <AnimatePresence mode="wait">
          {thinking ? (
            <motion.div
              key="thinking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex gap-1.5 py-2"
              aria-label="Thinking"
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1.5 rounded-full bg-blue"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div key={p.step} className="space-y-4">
              {p.step === "done" ? (
                <DoneMessage p={p} year={year} estimatedCount={estimatedCount} dispatch={dispatch} />
              ) : (
                <>
                  <p className="font-serif text-[26px] leading-[1.15] max-w-[26ch]">
                    <Reveal text={QUESTIONS[p.step]} />
                  </p>
                  {p.step === "deductible" && (
                    <p className="text-[12px] text-dim -mt-2">
                      Not sure? I&rsquo;ll use the typical employer plan, {usd(TYPICAL.deductible.value)}, and
                      mark it as a guess.
                    </p>
                  )}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                  >
                    <StepInput p={p} dispatch={dispatch} />
                  </motion.div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function DoneMessage({
  p,
  year,
  estimatedCount,
  dispatch,
}: {
  p: Profile;
  year: YearResult | null;
  estimatedCount: number;
  dispatch: Dispatch<Action>;
}) {
  if (!year) return null;
  // Every figure here is an engine field.
  return (
    <div className="space-y-4">
      <p className="font-serif text-[26px] leading-[1.15] max-w-[28ch]">
        <Reveal
          text={`This year you'd pay ${usd(year.patientTotal)} for care, and your plan would pay ${usd(year.planTotal)}.`}
        />
      </p>
      {year.annualPremium > 0 && (
        <p className="text-[15px] text-dim">
          Add {usd(year.annualPremium)} in premiums and the whole year costs you {usd(year.trueAnnualCost)}.
        </p>
      )}
      {estimatedCount > 0 && (
        <p className="text-[13px] text-dim">
          {estimatedCount === 1 ? "One number is" : `${estimatedCount} numbers are`} a typical value
          rather than yours. Check your card to make this exact.
        </p>
      )}
      <p className="text-[15px]">Drag the slider to try a different year.</p>
      <SurpriseControls p={p} dispatch={dispatch} compact />
    </div>
  );
}
