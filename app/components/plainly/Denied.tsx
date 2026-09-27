"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { FIRST_MOVE, KIND_LABEL, SAMPLE_DENIAL, appealDeadline, appealLetter, daysLeft, fmtDate, whoToCall, type Denial } from "@/lib/denial";
import { usd } from "@/lib/catalog";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import Handoff from "./Handoff";
import { useTheme } from "./theme";
import { Icon } from "../ui";

/**
 * Room: translate the letter. The insurer's sentences get highlighted and
 * struck through one by one, a plain-English note appears beside each, and
 * then the appeal letter writes itself.
 */
export default function Denied({ planSelfFunded }: { planSelfFunded: boolean | null }) {
  const [theme] = useTheme();
  const night = theme === "night";
  const [denial, setDenial] = useState<Denial>({ ...SAMPLE_DENIAL, selfFunded: SAMPLE_DENIAL.selfFunded ?? planSelfFunded });
  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const deadline = appealDeadline(denial.noticeDate);
  const left = daysLeft(deadline);
  const today = useMemo(() => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), []);
  const letter = appealLetter(denial, { name: "", memberId: "", today });

  const notes = [
    { jargon: denial.codes[0] ?? "Remark code", plain: `Insurer code for "${KIND_LABEL[denial.kind].toLowerCase()}".` },
    { jargon: denial.reasonQuote ?? "Reason", plain: denial.kind === "prior_auth" ? "Nobody asked the plan for permission before your scan. That's usually the office's job, not yours." : "This is their reason. It's often fixable." },
    { jargon: denial.denied !== null ? `Member responsibility: ${usd(denial.denied)}` : "Member responsibility", plain: "They'd like you to pay this. You don't have to yet." },
    { jargon: denial.deadlineQuote ?? "Appeal rights", plain: deadline ? `You have until ${fmtDate(deadline)} to push back. Under 1% of people do. About a third of those who do, win.` : "You usually have 180 days to push back." },
  ];

  useEffect(() => {
    setStep(0);
    const timers = notes.map((_, i) => setTimeout(() => setStep(i + 1), 900 + i * 1100));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [denial]);

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/decode-denial", { method: "POST", body });
      const json = await res.json();
      if (json.ok) setDenial({ ...(json.denial as Denial), selfFunded: json.denial.selfFunded ?? planSelfFunded });
      else setError(json.code === "not_denial" ? "That doesn't look like a denial letter. Lucky you, maybe." : "I couldn't read that one. The example still works.");
    } catch {
      setError("I couldn't reach the reader. The example still works offline.");
    }
    setUploading(false);
  }

  const lines = step < notes.length ? ["Denied. Let's read what they actually said."] : ["Translated. It's a paperwork problem wearing a scary costume.", "I wrote your appeal. You just sign it."];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={step < notes.length ? "thinking" : "calm"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic key={lines.join()} lines={lines} size="lg" />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        {/* The letter. */}
        <div className="relative rounded-[6px] bg-[#fffdf6] text-[#1c2420] p-7 sm:p-9 shadow-[0_30px_70px_-30px_rgb(0_0_0/0.45)] font-serif">
          <div className="flex justify-between text-[12px] font-sans opacity-60">
            <span>{denial.insurer ?? "Your insurer"}</span>
            <span>{denial.noticeDate ? fmtDate(denial.noticeDate) : ""}</span>
          </div>
          <div className="text-[22px] mt-4">Explanation of Benefits</div>
          <div className="font-sans text-[12.5px] opacity-70 mt-1">Claim {denial.claimNumber ?? "number not found"} · {denial.provider ?? "Provider"} · {denial.serviceDate ? fmtDate(denial.serviceDate) : ""}</div>
          <div className="mt-5 font-sans text-[14px] space-y-2">
            <Row k="Service" v={denial.service ?? "Not listed"} />
            <Row k="Amount billed" v={denial.billed !== null ? usd(denial.billed) : "Not listed"} />
            <Row k="Not paid" v={denial.denied !== null ? usd(denial.denied) : "Not listed"} />
          </div>
          <div className="mt-6 space-y-4 text-[16px] leading-relaxed">
            {notes.map((n, i) => (
              <p key={i} className="relative">
                <motion.span
                  className="box-decoration-clone px-0.5"
                  style={{ backgroundImage: "linear-gradient(transparent 55%, rgb(255 139 110 / 0.45) 55%)", backgroundRepeat: "no-repeat" }}
                  initial={{ backgroundSize: "0% 100%" }}
                  animate={{ backgroundSize: step > i ? "100% 100%" : "0% 100%" }}
                  transition={{ duration: 0.7, ease: [0.77, 0, 0.175, 1] }}
                >
                  <span className={step > i ? "line-through decoration-[#e2603d]/70 decoration-2" : ""}>{n.jargon}</span>
                </motion.span>
              </p>
            ))}
          </div>
          <div className="mt-6 font-sans text-[11px] opacity-50">This is not a bill.</div>
        </div>

        {/* The translation. */}
        <div className="space-y-3">
          {notes.map((n, i) => (
            <AnimatePresence key={i}>
              {step > i && (
                <motion.div
                  initial={{ opacity: 0, x: -16, filter: "blur(6px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                  className="card-quiet p-4 flex gap-3"
                >
                  <span className="font-mono text-[12px] text-coral pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-[15.5px]">{n.plain}</p>
                </motion.div>
              )}
            </AnimatePresence>
          ))}
          {step >= notes.length && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
              <div className="eyebrow">Do this first</div>
              <ol className="mt-3 space-y-2 text-[15px] list-decimal pl-5">
                {FIRST_MOVE[denial.kind].map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {left !== null && (
                <div className="mt-4 flex items-baseline gap-3">
                  <span className="font-serif text-5xl leading-none">{left}</span>
                  <span className="text-[14px] text-dim">days left to appeal</span>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {step >= notes.length && <TypedLetter text={letter} />}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => input.current?.click()} disabled={uploading} className="rounded-full border border-line-strong h-11 px-5 text-[14.5px] inline-flex items-center gap-2 hover:bg-surface">
          <Icon name="upload" className="size-4" />
          {uploading ? "Reading your letter..." : "Translate my own letter"}
        </button>
        <span className="text-[13px] text-faint">PDF or a photo. Read once, never kept.</span>
        <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        {error && <span role="alert" className="text-[14px] text-breach">{error}</span>}
      </div>

      <Handoff person={whoToCall(denial)[0]} line="Before you appeal, one call often fixes it." />
    </section>
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
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const t = setInterval(() => setN((x) => (x >= text.length ? x : x + 7)), 16);
    return () => clearInterval(t);
  }, [text]);
  const done = n >= text.length;
  return (
    <div className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[17px]">
          <span className="font-medium">Your appeal letter.</span> <span className="text-dim">Add your name and member ID, sign it, send it.</span>
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => navigator.clipboard?.writeText(text)} className="rounded-full border border-line h-10 px-4 text-[14px] hover:bg-surface">Copy</button>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="appeal-letter.txt" className="rounded-full bg-ink text-paper h-10 px-4 text-[14px] inline-flex items-center">Download</a>
        </div>
      </div>
      <pre className="mt-4 whitespace-pre-wrap font-mono text-[13px] leading-relaxed max-h-[420px] overflow-y-auto">
        {text.slice(0, n)}
        {!done && <span className="inline-block w-2 h-4 bg-moss align-middle animate-[caret_1s_steps(1)_infinite] will-change-[opacity]" />}
      </pre>
    </div>
  );
}
