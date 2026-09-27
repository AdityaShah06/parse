"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { FIRST_MOVE, KIND_LABEL, PLAIN_REASON, SAMPLE_DENIALS, appealDeadline, appealLetter, daysLeft, fmtDate, whoToCall, type Denial, type DenialKind } from "@/lib/denial";
import { APPEALS_SOURCE, NATIONAL, funnelFor, insurersIn, pct, type Funnel } from "@/lib/kb/appeals";
import { usd } from "@/lib/catalog";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import Handoff from "./Handoff";
import { useTheme } from "./theme";
import { Icon } from "../ui";

/**
 * Room: denied. It opens on the real odds (how many denials your insurer
 * issued in 2024, how few people appealed, how many of those won), then lets
 * you pick a kind of denial letter, or upload yours, and translates it: the
 * insurer's sentences get struck through one by one with a plain note beside
 * each, and the appeal letter types itself.
 */

const n = (x: number) => x.toLocaleString("en-US");
const oneIn = (part: number, whole: number) => (part > 0 ? Math.max(1, Math.round(whole / part)) : null);
/** "Healthy Alliance Life Co(Anthem BCBS)" reads as "Anthem BCBS"; otherwise drop the legal suffixes. */
const shortName = (label: string) => {
  const brand = label.match(/\(([^)]+)\)/)?.[1];
  if (brand) return brand.trim();
  return label.replace(/\b(Insurance Company|Insurance Co|Company|Inc\.?)\b/g, "").replace(/\s+/g, " ").trim();
};

const KINDS: Exclude<DenialKind, "unclear">[] = ["prior_auth", "paperwork", "out_of_network", "medical_necessity", "not_covered"];

export default function Denied({ planSelfFunded, hiosId, issuer }: { planSelfFunded: boolean | null; hiosId: string | null; issuer: string | null }) {
  const [theme] = useTheme();
  const night = theme === "night";

  const mine = useMemo(() => funnelFor(hiosId, issuer), [hiosId, issuer]);
  const [funnel, setFunnel] = useState<Funnel>(mine ?? NATIONAL);

  const [kind, setKind] = useState<DenialKind | "upload">("prior_auth");
  const [denial, setDenial] = useState<Denial>({ ...SAMPLE_DENIALS.prior_auth, selfFunded: planSelfFunded });
  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const deadline = appealDeadline(denial.noticeDate);
  const left = daysLeft(deadline);
  const today = useMemo(() => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), []);
  const letter = appealLetter(denial, { name: "", memberId: "", today });
  const winPct = Math.round(pct(funnel.won, funnel.appealed));

  const notes = [
    { jargon: denial.codes.join(", ") || "Remark code", plain: `Insurer code for "${KIND_LABEL[denial.kind].toLowerCase()}". Every denial carries one.` },
    { jargon: denial.reasonQuote ?? "Reason", plain: PLAIN_REASON[denial.kind] },
    { jargon: denial.denied !== null ? `Member responsibility: ${usd(denial.denied)}` : "Member responsibility", plain: "They'd like you to pay this. You don't have to yet." },
    {
      jargon: denial.deadlineQuote ?? "Appeal rights",
      plain: `${deadline ? `You have until ${fmtDate(deadline)} to push back.` : "You usually have 180 days to push back."} In ${APPEALS_SOURCE.year}, ${winPct}% of appeals to ${shortName(funnel.label)} won.`,
    },
  ];

  useEffect(() => {
    setStep(0);
    const timers = notes.map((_, i) => setTimeout(() => setStep(i + 1), 700 + i * 1000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [denial]);

  const pickKind = (k: Exclude<DenialKind, "unclear">) => {
    setKind(k);
    setError("");
    setDenial({ ...SAMPLE_DENIALS[k], selfFunded: planSelfFunded });
  };

  async function upload(file: File) {
    if (file.size > 4 * 1024 * 1024) return setError("That file is over 4 MB. Try a photo of just the first page.");
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/decode-denial", { method: "POST", body });
      const json = await res.json();
      if (json.ok) {
        setKind("upload");
        setDenial({ ...(json.denial as Denial), selfFunded: json.denial.selfFunded ?? planSelfFunded });
      } else setError(json.code === "not_denial" ? "That doesn't look like a denial letter. Lucky you, maybe." : json.code === "rate_limited" ? json.error : "I couldn't read that one. The samples still work.");
    } catch {
      setError("I couldn't reach the reader. The samples still work offline.");
    }
    setUploading(false);
  }

  const appealOdds = oneIn(funnel.appealed, funnel.denied);
  const lines = [
    `${shortName(funnel.label)} denied ${n(funnel.denied)} claims in ${APPEALS_SOURCE.year}.`,
    `Only ${n(funnel.appealed)} appeals were filed. ${n(funnel.won)} of them won.`,
  ];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={step < notes.length ? "thinking" : "calm"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic key={lines.join("|")} lines={lines} size="lg" voice />
        </div>
      </div>

      <FunnelCard funnel={funnel} mine={mine} appealOdds={appealOdds} winPct={winPct} onPick={setFunnel} />

      {/* Pick a letter. */}
      <div className="space-y-3">
        <p className="text-[17px]">
          <span className="font-medium">Pick a denial.</span> <span className="text-dim">Five sample letters, one for each common reason. Or bring your own.</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <motion.button
              key={k}
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => pickKind(k)}
              aria-pressed={kind === k}
              className={`rounded-full px-4 h-10 text-[14px] border ${kind === k ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-surface"}`}
            >
              {KIND_LABEL[k]}
            </motion.button>
          ))}
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => input.current?.click()}
            disabled={uploading}
            aria-pressed={kind === "upload"}
            className={`rounded-full px-4 h-10 text-[14px] border inline-flex items-center gap-2 ${kind === "upload" ? "border-ink bg-ink text-paper" : "border-dashed border-line-strong hover:bg-surface"}`}
          >
            <Icon name="upload" className="size-4" />
            {uploading ? "Reading your letter..." : "My own letter"}
          </motion.button>
          <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
        <p className="text-[12.5px] text-faint">
          {kind === "upload" ? "Your letter, read once and never kept." : "Sample letter from a made-up insurer. The codes are the real standard codes for each reason."}
          {error && (
            <span role="alert" className="text-breach ml-2">
              {error}
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        {/* The letter. */}
        <div className="relative rounded-[6px] bg-[#fffdf6] text-[#1c2420] p-7 sm:p-9 shadow-[0_30px_70px_-30px_rgb(0_0_0/0.45)] font-serif">
          <div className="flex justify-between text-[12px] font-sans opacity-60">
            <span>{denial.insurer ?? "Your insurer"}</span>
            <span>{denial.noticeDate ? fmtDate(denial.noticeDate) : ""}</span>
          </div>
          <div className="text-[22px] mt-4">Explanation of Benefits</div>
          <div className="font-sans text-[12.5px] opacity-70 mt-1">
            Claim {denial.claimNumber ?? "number not found"} · {denial.provider ?? "Provider"} · {denial.serviceDate ? fmtDate(denial.serviceDate) : ""}
          </div>
          <div className="mt-5 font-sans text-[14px] space-y-2">
            <Row k="Service" v={denial.service ?? "Not listed"} />
            <Row k="Amount billed" v={denial.billed !== null ? usd(denial.billed) : "Not listed"} />
            <Row k="Not paid" v={denial.denied !== null ? usd(denial.denied) : "Not listed"} />
          </div>
          <div className="mt-6 space-y-4 text-[16px] leading-relaxed">
            {notes.map((note, i) => (
              <p key={`${denial.claimNumber}-${i}`} className="relative">
                <motion.span
                  className="box-decoration-clone px-0.5"
                  style={{ backgroundImage: "linear-gradient(transparent 55%, rgb(255 139 110 / 0.45) 55%)", backgroundRepeat: "no-repeat" }}
                  initial={{ backgroundSize: "0% 100%" }}
                  animate={{ backgroundSize: step > i ? "100% 100%" : "0% 100%" }}
                  transition={{ duration: 0.7, ease: [0.77, 0, 0.175, 1] }}
                >
                  <span className={step > i ? "line-through decoration-[#e2603d]/70 decoration-2" : ""}>{note.jargon}</span>
                </motion.span>
              </p>
            ))}
          </div>
          <div className="mt-6 font-sans text-[11px] opacity-50">This is not a bill.</div>
        </div>

        {/* The translation. */}
        <div className="space-y-3">
          {notes.map((note, i) => (
            <AnimatePresence key={`${denial.claimNumber}-${i}`}>
              {step > i && (
                <motion.div
                  initial={{ opacity: 0, x: -16, filter: "blur(6px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                  className="card-quiet p-4 flex gap-3"
                >
                  <span className="font-mono text-[12px] text-coral pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-[15.5px] text-pretty">{note.plain}</p>
                </motion.div>
              )}
            </AnimatePresence>
          ))}
          {step >= notes.length && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
              <div className="eyebrow">Do this first</div>
              <ol className="mt-3 space-y-2 text-[15px] list-decimal pl-5">
                {FIRST_MOVE[denial.kind].map((s) => (
                  <li key={s} className="text-pretty">
                    {s}
                  </li>
                ))}
              </ol>
              {left !== null && (
                <div className="mt-4 flex items-baseline gap-3">
                  <span className="font-serif text-5xl leading-none tabular-nums">{left}</span>
                  <span className="text-[14px] text-dim">days left to appeal</span>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {step >= notes.length && <TypedLetter text={letter} />}

      <Handoff person={whoToCall(denial)[0]} line="Before you appeal, one call often fixes it." />
    </section>
  );
}

/** Denied, appealed, won: three real counts for one insurer, and who else to compare. */
function FunnelCard({ funnel, mine, appealOdds, winPct, onPick }: { funnel: Funnel; mine: Funnel | null; appealOdds: number | null; winPct: number; onPick: (f: Funnel) => void }) {
  const reduce = useReducedMotion();
  const others = useMemo(() => insurersIn("MO"), []);
  const steps = [
    { label: "Claims denied", value: funnel.denied, tone: "text-coral", note: "in network, in one year" },
    { label: "Appealed", value: funnel.appealed, tone: "text-ink", note: appealOdds ? `1 in ${n(appealOdds)} denials` : "" },
    { label: "Won on appeal", value: funnel.won, tone: "text-moss", note: `${winPct}% of appeals` },
  ];
  return (
    <div className="card p-5 sm:p-7">
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <motion.div
            key={`${funnel.label}-${s.label}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: i * 0.06, ease: [0.23, 1, 0.32, 1] }}
            className={`relative ${i ? "sm:pl-5 sm:border-l border-line" : ""}`}
          >
            <div className="text-[12.5px] text-dim">{s.label}</div>
            <div className={`font-serif text-5xl sm:text-6xl leading-none mt-2 tracking-[-0.03em] tabular-nums ${s.tone}`}>{n(s.value)}</div>
            <div className="text-[12.5px] text-dim mt-2">{s.note}</div>
          </motion.div>
        ))}
      </div>
      <p className="text-[15px] mt-6 text-pretty">
        <span className="font-medium">Appealing is rare, and it works.</span>{" "}
        <span className="text-dim">
          Across every HealthCare.gov insurer, {pct(NATIONAL.appealed, NATIONAL.denied).toFixed(2)}% of denials were appealed and {Math.round(pct(NATIONAL.won, NATIONAL.appealed))}% of appeals won.
        </span>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {[NATIONAL, ...others].map((f) => {
          const on = f.label === funnel.label && f.state === funnel.state;
          return (
            <button
              key={`${f.state}-${f.label}`}
              type="button"
              onClick={() => onPick(f)}
              aria-pressed={on}
              className={`rounded-full px-3 h-9 text-[13px] border ${on ? "border-moss bg-sage" : "border-line text-dim hover:bg-surface"}`}
            >
              {f === NATIONAL ? "Everyone" : shortName(f.label)}
              {mine && f.label === mine.label ? " (yours)" : ""}
            </button>
          );
        })}
      </div>
      <p className="text-[11.5px] text-faint mt-4">
        {APPEALS_SOURCE.name}, {APPEALS_SOURCE.year} claims. Individual marketplace plans only; job-based plans don&rsquo;t report these numbers.
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-black/10 pb-1.5">
      <span className="opacity-60">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function TypedLetter({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const t = setInterval(() => setShown((x) => (x >= text.length ? x : x + 7)), 16);
    return () => clearInterval(t);
  }, [text]);
  const done = shown >= text.length;
  return (
    <div className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[17px]">
          <span className="font-medium">Your appeal letter.</span> <span className="text-dim">Add your name and member ID, sign it, send it.</span>
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => navigator.clipboard?.writeText(text)} className="rounded-full border border-line h-10 px-4 text-[14px] hover:bg-surface">
            Copy
          </button>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="appeal-letter.txt" className="rounded-full bg-ink text-paper h-10 px-4 text-[14px] inline-flex items-center">
            Download
          </a>
        </div>
      </div>
      <pre className="mt-4 whitespace-pre-wrap font-mono text-[13px] leading-relaxed max-h-[420px] overflow-y-auto">
        {text.slice(0, shown)}
        {!done && <span className="inline-block w-2 h-4 bg-moss align-middle animate-[caret_1s_steps(1)_infinite] will-change-[opacity]" />}
      </pre>
    </div>
  );
}
