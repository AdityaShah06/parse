"use client";

import { motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import {
  FIRST_MOVE,
  KIND_LABEL,
  SAMPLE_DENIAL,
  appealDeadline,
  appealLetter,
  daysLeft,
  fmtDate,
  whoToCall,
  type Denial,
} from "@/lib/denial";
import { usd } from "@/lib/catalog";
import { Scanner } from "./DecodePlan";
import SampleBadge from "./SampleBadge";

const READING = ["Reading the denial", "Finding the reason", "Looking for codes", "Finding the deadline"];

const ERRORS: Record<string, string> = {
  no_key: "The reader's AI key isn't set up on this computer yet. Try the example letter.",
  not_denial: "That doesn't look like a denial letter or an explanation of benefits.",
  bad_type: "Send a PDF or a photo of the letter.",
  too_big: "That file is over 10 MB.",
};

function Upload({ onDenial }: { onDenial: (d: Denial) => void }) {
  const [state, setState] = useState<"idle" | "reading">("idle");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    setState("reading");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/decode-denial", { method: "POST", body });
      const json = await res.json();
      if (json.ok) onDenial(json.denial as Denial);
      else setError(ERRORS[json.code] ?? "Something went wrong reading that file.");
    } catch {
      setError("I couldn't reach the reader. The example letter works offline.");
    }
    setState("idle");
  }

  if (state === "reading") return <Scanner lines={READING} />;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) send(f);
        }}
        className="w-full rounded-[18px] border-2 border-dashed border-line bg-surface px-5 py-7 text-left hover:border-ink transition-colors"
      >
        <span className="font-serif text-2xl block">Drop the denial letter or explanation of benefits</span>
        <span className="text-[13px] text-dim">PDF or a photo. Read once, never stored.</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f);
        }}
      />
      {error && (
        <p role="alert" className="text-[14px] text-breach">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => onDenial(SAMPLE_DENIAL)}
        className="min-h-11 px-5 rounded-full bg-ink text-surface text-[15px]"
      >
        See an example denial
      </button>
    </div>
  );
}

function Card({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: "easeOut" }}
      className="rounded-[20px] border border-line bg-surface/80 p-5"
    >
      <h3 className="text-[13px] text-dim mb-3">{title}</h3>
      {children}
    </motion.section>
  );
}

export default function DeniedRoom({ planSelfFunded = null }: { planSelfFunded?: boolean | null }) {
  const [denial, setDenial] = useState<Denial | null>(null);
  const [name, setName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [edited, setEdited] = useState<string | null>(null);

  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    []
  );
  const deadline = denial ? appealDeadline(denial.noticeDate) : null;
  const left = daysLeft(deadline);
  const generated = denial ? appealLetter(denial, { name, memberId, today }) : "";
  const letter = edited ?? generated;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-3xl">Claim denied?</h2>
          <p className="text-sm text-dim mt-1 max-w-xl">
            Marketplace insurers denied 19% of in-network claims in 2024, and fewer than 1% of those
            denials were appealed. About a third of appeals won (KFF). Here is what to do with yours.
          </p>
        </div>
        {denial?.source === "sample" && <SampleBadge label="Example letter" />}
      </div>

      {!denial ? (
        <Upload
          onDenial={(d) => {
            // The plan summary may already say who pays claims; the letter often does not.
            setDenial({ ...d, selfFunded: d.selfFunded ?? planSelfFunded });
            setEdited(null);
          }}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="What they said">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="rounded-full bg-ink text-surface text-[13px] px-3 py-1">{KIND_LABEL[denial.kind]}</span>
              {denial.codes.map((c) => (
                <span key={c} className="rounded-full border border-line font-mono text-[12px] px-2.5 py-1">{c}</span>
              ))}
            </div>
            <div className="font-serif text-2xl leading-tight">{denial.service ?? "Service not named"}</div>
            <div className="text-[13px] text-dim mt-1">
              {[denial.provider, denial.serviceDate && fmtDate(denial.serviceDate), denial.insurer].filter(Boolean).join(" · ")}
            </div>
            {denial.denied !== null && (
              <div className="mt-3 text-[14px]">
                Denied: <span className="font-serif text-2xl text-red">{usd(denial.denied)}</span>
                {denial.billed !== null && <span className="text-dim"> of {usd(denial.billed)} billed</span>}
              </div>
            )}
            {denial.reasonQuote && <p className="mt-3 text-[14px] text-dim">&ldquo;{denial.reasonQuote}&rdquo;</p>}
          </Card>

          <Card title="Your deadline" delay={0.08}>
            {deadline ? (
              <>
                <div className="font-serif text-4xl leading-none">{fmtDate(deadline)}</div>
                <div className="mt-2 text-[15px]">
                  {left !== null && left > 0 ? `${left} days left to file the appeal.` : "This deadline has passed. Call your insurer and ask about options anyway."}
                </div>
                <p className="mt-2 text-[12px] text-dim">
                  180 days from the notice date, the federal minimum for ACA plans.
                  {denial.deadlineQuote ? ` Your letter says: "${denial.deadlineQuote}"` : ""}
                </p>
              </>
            ) : (
              <p className="text-[15px]">The notice date wasn&rsquo;t readable. Look for it on the letter: you usually have 180 days from that date.</p>
            )}
          </Card>

          <Card title="Do this first" delay={0.16}>
            <ol className="space-y-2 text-[15px] list-decimal pl-5">
              {FIRST_MOVE[denial.kind].map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Card>

          <Card title="Who to call" delay={0.24}>
            <ul className="space-y-3">
              {whoToCall(denial).map((p) => (
                <li key={p.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[15px]">{p.name}</span>
                    {p.phone && (
                      <a href={`tel:${p.phone.replace(/\D/g, "")}`} className="font-mono text-[14px] underline underline-offset-4">
                        {p.phone}
                      </a>
                    )}
                  </div>
                  <p className="text-[13px] text-dim">{p.when}</p>
                </li>
              ))}
            </ul>
          </Card>

          <div className="xl:col-span-2">
            <Card title="Your appeal letter" delay={0.32}>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setEdited(null); }}
                  placeholder="Your name"
                  aria-label="Your name"
                  className="min-h-11 rounded-full border border-line bg-surface px-4 outline-none focus:border-ink"
                />
                <input
                  value={memberId}
                  onChange={(e) => { setMemberId(e.target.value); setEdited(null); }}
                  placeholder="Member ID from your card"
                  aria-label="Member ID"
                  className="min-h-11 rounded-full border border-line bg-surface px-4 outline-none focus:border-ink"
                />
              </div>
              <textarea
                value={letter}
                onChange={(e) => setEdited(e.target.value)}
                rows={16}
                aria-label="Appeal letter"
                className="w-full rounded-[14px] border border-line bg-paper p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-ink"
              />
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(letter)}
                  className="min-h-10 px-4 rounded-full border border-line bg-surface hover:border-ink text-[14px]"
                >
                  Copy letter
                </button>
                <a
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(letter)}`}
                  download="appeal-letter.txt"
                  className="min-h-10 px-4 inline-flex items-center rounded-full border border-line bg-surface hover:border-ink text-[14px]"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => { setDenial(null); setEdited(null); }}
                  className="min-h-10 px-4 rounded-full text-dim hover:text-ink text-[14px]"
                >
                  Start with a different letter
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
