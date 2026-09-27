"use client";

import { PulsingBorder } from "@paper-design/shaders-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { decodedToCard, sampleDecoded, type Decoded } from "@/lib/decode";
import { COPAY_LABELS, type CardInput } from "@/lib/card";
import { usd } from "@/lib/catalog";
import Sphere, { type Mood } from "./Sphere";
import Kinetic from "./Kinetic";
import { Icon } from "../ui";

const ERRORS: Record<string, string> = {
  no_key: "My reader isn't plugged in on this computer. The example plan works offline.",
  not_sbc: "That's a PDF, but not a Summary of Benefits. I admire the confidence.",
  not_pdf: "That's not a PDF. I only read PDFs. It's a personal thing.",
  too_big: "That file is over 4 MB. Summaries are usually under 1.",
};

const STATUS = [
  "Finding the deductible. It's always on page 1, in the smallest font.",
  "Reading the fine print. Then the finer print.",
  "Translating 'coinsurance' into English.",
  "Checking who actually pays your claims.",
  "Looking for the out-of-pocket maximum. It was hiding.",
];

/** Room 2: hand over the Summary of Benefits, watch it get read, confirm the card. */
export default function Decode({
  stage,
  decoded,
  onDecoded,
  onConfirm,
}: {
  stage: "decode" | "card";
  decoded: Decoded | null;
  onDecoded: (d: Decoded) => void;
  onConfirm: (card: CardInput, info: Decoded) => void;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  async function read(file: File | "sample") {
    setError("");
    setReading(true);
    const started = Date.now();
    // Even the example takes a beat: the scan is part of the story.
    const minimum = new Promise((r) => setTimeout(r, 4200));
    try {
      let d: Decoded;
      if (file === "sample") d = sampleDecoded();
      else {
        // Hosted functions reject request bodies over 4.5 MB before the route runs.
        if (file.size > 4 * 1024 * 1024) throw new Error(ERRORS.too_big);
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/decode-plan", { method: "POST", body });
        const json = await res.json();
        if (!json.ok) throw new Error(ERRORS[json.code] ?? "Something went wrong reading that. The example plan still works.");
        d = json.decoded as Decoded;
      }
      await minimum;
      void started;
      setReading(false);
      onDecoded(d);
    } catch (e) {
      await minimum;
      setReading(false);
      setError(e instanceof Error && e.message ? e.message : "I couldn't reach the reader. If the wifi is down, the example plan still works.");
    }
  }

  const mood: Mood = reading ? "thinking" : stage === "card" ? "happy" : error ? "worried" : "calm";

  return (
    <main className="garden relative min-h-screen overflow-hidden">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-10 pt-10 sm:pt-14 pb-24">
        <div className="flex items-start gap-6 sm:gap-8">
          <motion.div layoutId="sphere" transition={{ type: "spring", duration: 0.8, bounce: 0 }} className="shrink-0">
            <Sphere size={112} mood={mood} className="max-sm:!w-[76px] max-sm:!h-[76px]" />
          </motion.div>
          <div className="min-w-0 pt-2">
            <AnimatePresence mode="wait">
              <motion.div key={stage + String(reading)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Kinetic
                  size="lg"
                  lines={
                    stage === "card"
                      ? ["Found it. Here's your plan, on one card.", "Check the numbers. I marked the one that hurts."]
                      : reading
                        ? ["Reading. Don't watch, it makes me nervous."]
                        : ["Somewhere in your insurer's app is a PDF called a Summary of Benefits.", "Nobody has ever opened it. Let's be the first."]
                  }
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="mt-10">
          <AnimatePresence mode="wait">
            {stage === "card" && decoded ? (
              <motion.div key="card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <CardReveal decoded={decoded} onConfirm={onConfirm} />
              </motion.div>
            ) : reading ? (
              <motion.div key="scan" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Scanning />
              </motion.div>
            ) : (
              <motion.div key="drop" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
                <Dropzone onFile={read} error={error} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

function Dropzone({ onFile, error }: { onFile: (f: File | "sample") => void; error: string }) {
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDrag(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDrag(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) onFile(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onFile]);

  return (
    <div className="max-w-4xl">
      <motion.button
        type="button"
        onClick={() => input.current?.click()}
        animate={{ scale: drag ? 1.015 : 1 }}
        transition={{ type: "spring", duration: 0.4, bounce: 0 }}
        className="relative w-full rounded-[34px] p-2 text-left"
      >
        {/* The living border only wakes up while a file hovers. */}
        <AnimatePresence>
          {drag && (
            <motion.div className="absolute inset-0 rounded-[34px] overflow-hidden pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <PulsingBorder
                style={{ width: "100%", height: "100%" }}
                webGlContextAttributes={{ powerPreference: "high-performance", antialias: true }}
                colorBack="#00000000"
                colors={["#1e7a4e", "#8fdcb4", "#efa3b6", "#f3e3b8"]}
                roundness={0.18}
                thickness={0.06}
                softness={0.8}
                intensity={0.35}
                bloom={0.4}
                spots={5}
                spotSize={0.4}
                pulse={0.3}
                smoke={0.4}
                smokeSize={0.5}
                speed={1.2}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className={`relative card overflow-hidden px-8 sm:px-12 py-14 sm:py-16 flex flex-col sm:flex-row items-center gap-10 transition-colors ${drag ? "bg-surface" : ""}`}>
          <PaperStack lifted={drag} />
          <div className="min-w-0 text-center sm:text-left">
            <AnimatePresence mode="wait">
              <motion.div
                key={drag ? "drop" : "idle"}
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                transition={{ duration: 0.2 }}
              >
                <div className="font-serif text-[2.2rem] sm:text-[2.8rem] leading-none tracking-[-0.02em]">{drag ? "Let go. I've got it." : "Drop your plan here."}</div>
                <div className="mt-3 text-[15px] text-dim">
                  {drag ? "Reading starts the moment it lands." : "Summary of Benefits, PDF. Or tap to choose it. Read once, never kept."}
                </div>
              </motion.div>
            </AnimatePresence>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink text-paper px-5 h-11 text-[14.5px]">
              <Icon name="upload" className="size-4" />
              Choose a PDF
            </div>
          </div>
        </div>
      </motion.button>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {error && (
        <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 3, 0] }} role="alert" className="mt-4 text-[15px] text-breach">
          {error}
        </motion.p>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[14.5px]">
        <button type="button" onClick={() => onFile("sample")} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-5 h-11 hover:bg-surface transition-colors">
          No PDF handy? Use a real Missouri plan
        </button>
        <span className="text-faint text-[13px]">Where to find it: your insurer&rsquo;s app, under Documents, Plan details, or Benefits.</span>
      </div>
    </div>
  );
}

function PaperStack({ lifted }: { lifted: boolean }) {
  return (
    <div className="relative w-[150px] h-[176px] shrink-0">
      <motion.div className="absolute inset-0 rounded-lg bg-sage border border-line" animate={{ rotate: lifted ? -14 : -7, x: lifted ? -14 : -6 }} transition={{ type: "spring", duration: 0.5, bounce: 0 }} />
      <motion.div
        className="absolute inset-0 rounded-lg bg-surface border border-line p-3 shadow-[0_20px_40px_-20px_rgb(0_0_0/0.35)]"
        animate={{ y: lifted ? -14 : [0, -4, 0], rotate: lifted ? 3 : 0 }}
        transition={lifted ? { type: "spring", duration: 0.5, bounce: 0 } : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="text-[7px] uppercase tracking-[0.14em] text-faint">Summary of Benefits and Coverage</div>
        <div className="mt-2 font-mono text-[9px] text-ink">PDF</div>
        {[80, 60, 92, 50, 74, 66, 84].map((w, k) => (
          <div key={k} className="h-[5px] rounded-full bg-line-strong mt-2" style={{ width: `${w}%` }} />
        ))}
      </motion.div>
    </div>
  );
}

/** The scan: a page on the left, a beam reading it, findings flying across to a card. */
function Scanning() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % STATUS.length), 1700);
    return () => clearInterval(t);
  }, []);
  const found = ["Deductible", "Coinsurance", "Out-of-pocket max", "Copays", "Who pays claims"];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr] items-center max-w-5xl">
      <div className="relative mx-auto w-full max-w-[380px] aspect-[8.5/11] card overflow-hidden p-7">
        <div className="text-[9px] uppercase tracking-[0.16em] text-faint">Summary of Benefits and Coverage</div>
        <div className="font-serif text-[20px] mt-1">Coverage period: 01/01/2026 to 12/31/2026</div>
        {Array.from({ length: 16 }).map((_, k) => (
          <motion.div
            key={k}
            className="h-[6px] rounded-full mt-3"
            style={{ width: `${45 + ((k * 37) % 50)}%` }}
            animate={{ backgroundColor: ["var(--line-strong)", "var(--mint)", "var(--line-strong)"] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: k * 0.15, ease: "easeInOut" }}
          />
        ))}
        {/* The beam. */}
        <motion.div
          className="absolute inset-x-0 h-24 pointer-events-none"
          style={{ top: 0, background: "linear-gradient(to bottom, transparent, color-mix(in oklab, var(--mint) 45%, transparent) 70%, var(--moss) 72%, transparent 74%)" }}
          animate={{ y: ["-20%", "520%", "-20%"] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: [0.77, 0, 0.175, 1] }}
        />
      </div>

      <div>
        <ul className="space-y-3">
          {found.map((f, k) => (
            <motion.li
              key={f}
              initial={{ opacity: 0, x: -30, filter: "blur(6px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.6 + k * 0.65, duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
              className="card-quiet flex items-center gap-3 px-4 py-3 max-w-md"
            >
              <motion.span
                className="grid place-items-center size-6 rounded-full bg-moss text-paper"
                initial={{ scale: 0.6 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.9 + k * 0.65, type: "spring", duration: 0.4, bounce: 0.3 }}
              >
                <Icon name="check" className="size-3.5" />
              </motion.span>
              <span className="text-[15px]">{f}</span>
              <span className="ml-auto font-mono text-[12px] text-faint">found</span>
            </motion.li>
          ))}
        </ul>
        <div className="mt-6 h-6 overflow-hidden text-[14.5px] text-dim flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-moss animate-pulse" />
          <AnimatePresence mode="wait">
            <motion.span key={i} initial={{ y: 12, opacity: 0, filter: "blur(4px)" }} animate={{ y: 0, opacity: 1, filter: "blur(0px)" }} exit={{ y: -12, opacity: 0, filter: "blur(4px)" }} transition={{ duration: 0.3 }}>
              {STATUS[i]}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** The plan as a physical card: it flips in, the numbers roll, the deductible is flagged. */
const ROW_LABEL: Record<string, string> = {
  preventive: "Checkups",
  primary: "Sick visit",
  specialist: "Specialist",
  mental: "Therapy",
  urgent: "Urgent care",
  er: "ER",
  ambulance: "Ambulance",
  labs: "Labs",
  xray: "X-ray",
  imaging: "MRI/CT",
  generic: "Generic Rx",
  brand: "Brand Rx",
  specialty: "Specialty Rx",
  outpatient_surgery: "Outpatient surgery",
  inpatient: "Hospital stay",
};

function CardReveal({ decoded, onConfirm }: { decoded: Decoded; onConfirm: (card: CardInput, info: Decoded) => void }) {
  const [card, setCard] = useState<CardInput>(() => decodedToCard(decoded));
  const [editing, setEditing] = useState(false);
  const fields: { key: "deductible" | "coinsurancePct" | "outOfPocketMax"; label: string; unit: "$" | "%"; hint: string }[] = [
    { key: "deductible", label: "Deductible", unit: "$", hint: "You pay everything until you've spent this" },
    { key: "coinsurancePct", label: "Your share after that", unit: "%", hint: "Of every bill, until the ceiling" },
    { key: "outOfPocketMax", label: "Out-of-pocket max", unit: "$", hint: "The most you can pay in a year. Then it's free" },
  ];
  const fmt = (v: number | null, unit: "$" | "%") => (v === null ? "Not listed" : unit === "$" ? usd(v) : `${v}%`);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,520px)_1fr] items-start max-w-6xl">
      <motion.div
        initial={{ rotateY: 110, rotateX: 8, y: 30, opacity: 0 }}
        animate={{ rotateY: 0, rotateX: 0, y: 0, opacity: 1 }}
        transition={{ type: "spring", duration: 1.1, bounce: 0.15 }}
        style={{ transformPerspective: 1200 }}
        className="relative aspect-[1.586] w-full rounded-[26px] p-6 sm:p-7 text-[#f5f1e8] overflow-hidden shadow-[0_40px_80px_-30px_rgb(17_40_29/0.6)]"
      >
        <div className="absolute inset-0" style={{ background: "radial-gradient(120% 100% at 0% 0%, #2e8f5d, #11281d 60%), #11281d" }} />
        <div className="absolute inset-0 opacity-30 mix-blend-overlay garden" />
        <motion.div
          className="absolute -inset-x-1/2 inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent skew-x-[-20deg]"
          initial={{ x: "-60%" }}
          animate={{ x: "320%" }}
          transition={{ delay: 1, duration: 1.4, ease: [0.23, 1, 0.32, 1] }}
        />
        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">{decoded.insurer ?? "Your insurer"}</div>
            <div className="font-serif text-[22px] sm:text-[26px] leading-tight mt-1 max-w-[20ch]">{decoded.planName ?? "Your plan"}</div>
          </div>
          <div className="rounded-md bg-gradient-to-br from-[#f0d9a8] to-[#c09a52] w-11 h-8 opacity-90" />
        </div>
        <div className="relative mt-6 grid grid-cols-3 gap-3">
          {fields.map((f, k) => (
            <motion.div key={f.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 + k * 0.15 }}>
              <div className="text-[10.5px] uppercase tracking-[0.12em] opacity-65">{f.label.split(" ")[0]}</div>
              <div className="font-mono tabular text-[18px] sm:text-[22px] mt-1">{fmt(card[f.key], f.unit)}</div>
              {k === 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, rotate: -6 }}
                  animate={{ opacity: 1, scale: 1, rotate: -4 }}
                  transition={{ delay: 1.8, type: "spring", duration: 0.5, bounce: 0.35 }}
                  className="inline-block mt-2 rounded-full bg-[#ff8b6e] text-[#11281d] text-[10.5px] font-medium px-2 py-0.5"
                >
                  this one hurts
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
        <div className="absolute bottom-5 left-6 right-6 flex justify-between text-[11px] opacity-60">
          <span>{decoded.planType ?? "Plan"}{decoded.selfFunded ? " · paid by your employer" : ""}</span>
          <span>{decoded.source === "sample" ? "2026 · CMS public plan data" : "Read from your PDF"}</span>
        </div>
      </motion.div>

      <div>
        <div className="grid gap-3 max-w-lg">
          {fields.map((f) => (
            <label key={f.key} className="card-quiet flex items-center justify-between gap-4 px-5 py-4">
              <span>
                <span className="block text-[15px]">{f.label}</span>
                <span className="block text-[12.5px] text-faint">{f.hint}</span>
              </span>
              {editing ? (
                <input
                  inputMode="decimal"
                  defaultValue={card[f.key] ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/[,$%\s]/g, ""));
                    setCard((c) => ({ ...c, [f.key]: e.target.value.trim() === "" || !Number.isFinite(n) ? null : n }));
                  }}
                  className="w-28 bg-transparent text-right font-mono text-[18px] border-b border-line-strong outline-none focus:border-moss"
                />
              ) : (
                <span className="font-mono tabular text-[18px]">{fmt(card[f.key], f.unit)}</span>
              )}
            </label>
          ))}
          {Object.keys(card.copays).length > 0 && (
            <div className="card-quiet px-5 py-4">
              <div className="text-[12.5px] text-faint mb-2">Flat copays</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(card.copays).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-sage px-3 py-1 text-[13px]">
                    {COPAY_LABELS[k as keyof typeof COPAY_LABELS]} <span className="font-mono">{usd(v as number)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {(decoded.rows?.length ?? 0) > 0 && (
            <div className="card-quiet px-5 py-4">
              <div className="text-[12.5px] text-faint mb-2">Also read from your document</div>
              <div className="flex flex-wrap gap-2">
                {decoded.rows!.map((r) => (
                  <span key={r.key} title={r.text} className="rounded-full border border-line px-3 py-1 text-[12.5px]">
                    {ROW_LABEL[r.key]} <span className="font-mono text-dim">{r.kind === "free" ? "free" : r.kind === "copay" ? `$${r.amount}` : r.kind === "coinsurance" ? `${r.percent}%` : "see plan"}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {decoded.referralRequired !== null && decoded.referralRequired !== undefined && (
            <div className="text-[13px] text-dim px-1">{decoded.referralRequired ? "Specialists need a referral from your regular doctor." : "No referral needed to see a specialist."}</div>
          )}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={() => onConfirm(card, decoded)} className="rounded-full bg-ink text-paper h-12 px-6 text-[15px]">
            Looks right. Show me my plan
          </motion.button>
          <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-full border border-line-strong h-12 px-6 text-[15px] hover:bg-surface">
            {editing ? "Done fixing" : "Fix a number"}
          </button>
        </div>
      </div>
    </div>
  );
}
