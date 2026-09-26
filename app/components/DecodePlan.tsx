"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type Dispatch } from "react";
import type { Action } from "@/lib/profile";
import { COPAY_KEYS, SAMPLE_CITATION, decodedToCard, sampleDecoded, type Decoded, type NumField } from "@/lib/decode";
import { COPAY_LABELS } from "@/lib/card";

// ---------------------------------------------------------------------------
// Step 1: hand over the PDF
// ---------------------------------------------------------------------------

const READING_LINES = [
  "Opening your plan summary",
  "Finding the deductible",
  "Reading the cost table",
  "Checking every copay",
  "Matching numbers to quotes",
];

const ERRORS: Record<string, string> = {
  no_key: "My reading key isn't set up on this computer yet. Try an example plan, or type the numbers from your card.",
  not_sbc: "That doesn't look like a Summary of Benefits. It's the one with a big cost table and the question 'What is the overall deductible?' near the top.",
  not_pdf: "That file isn't a PDF. The Summary of Benefits is almost always a PDF.",
  too_big: "That PDF is over 10 MB. The Summary of Benefits is usually under 1 MB, so this might be a different document.",
};

export function Scanner({ lines = READING_LINES }: { lines?: string[] }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLine((l) => (l + 1) % lines.length), 1400);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <div className="flex items-center gap-5" role="status" aria-live="polite">
      <div className="relative w-[74px] h-[96px] rounded-[6px] border border-ink/70 bg-surface overflow-hidden shrink-0">
        {Array.from({ length: 9 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute left-2 h-[3px] rounded-full bg-line"
            style={{ top: 10 + i * 9, width: i % 3 === 0 ? 40 : 54 }}
            initial={{ opacity: 0.35 }}
            animate={{ opacity: [0.35, 1, 0.35], backgroundColor: ["#c4d4de", "#17688e", "#c4d4de"] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.22 }}
          />
        ))}
        <motion.div
          className="absolute inset-x-0 h-6 bg-linear-to-b from-transparent via-blue/25 to-transparent"
          animate={{ top: ["-20%", "100%"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <div>
        <AnimatePresence mode="wait">
          <motion.p
            key={line}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="font-serif text-2xl"
          >
            {lines[line]}
          </motion.p>
        </AnimatePresence>
        <p className="text-[13px] text-dim mt-1">Usually 10 to 20 seconds. Nothing is saved.</p>
      </div>
    </div>
  );
}

export function DecodeAsk({ dispatch }: { dispatch: Dispatch<Action> }) {
  const [state, setState] = useState<"idle" | "reading" | "error">("idle");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state === "error") alertRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state]);

  async function send(file: File) {
    setState("reading");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/decode-plan", { method: "POST", body });
      const json = await res.json();
      if (json.ok) {
        dispatch({ type: "decoded", decoded: json.decoded as Decoded, label: `Read ${file.name}` });
      } else {
        setError(ERRORS[json.code] ?? "Something went wrong reading that file. Try again, or type your card numbers.");
        setState("error");
      }
    } catch {
      setError("I couldn't reach the reader. If the wifi is down, the example plan still works.");
      setState("error");
    }
  }

  if (state === "reading") return <Scanner />;

  return (
    <div className="space-y-3">
      <motion.button
        type="button"
        whileTap={{ scale: 0.99 }}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) send(f);
        }}
        className={`w-full rounded-[18px] border-2 border-dashed px-5 py-6 text-left transition-colors ${
          drag ? "border-blue bg-blue/5" : "border-line bg-surface hover:border-ink"
        }`}
      >
        <span className="font-serif text-2xl block">Drop your plan&rsquo;s PDF here</span>
        <span className="text-[13px] text-dim">or tap to choose it. Read once, never stored.</span>
      </motion.button>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f);
        }}
      />

      {state === "error" && (
        <p ref={alertRef} role="alert" className="text-[14px] text-breach">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => dispatch({ type: "typeCard" })}
          className="min-h-11 px-4 rounded-full border border-line bg-surface hover:border-ink text-[15px]"
        >
          I&rsquo;ll type my card numbers
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => dispatch({ type: "decoded", decoded: sampleDecoded(), label: "Show me an example plan" })}
          className="min-h-11 px-4 rounded-full border border-line bg-surface hover:border-ink text-[15px]"
        >
          Use an example plan
        </motion.button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: confirm every number against its quote
// ---------------------------------------------------------------------------

type Row = { key: string; label: string; field: NumField; unit: "$" | "%"; after?: boolean };

function rowsOf(d: Decoded): Row[] {
  return [
    { key: "deductible", label: "Deductible", field: d.deductible, unit: "$" },
    { key: "coinsurancePct", label: "Your share after it", field: d.coinsurancePct, unit: "%" },
    { key: "outOfPocketMax", label: "Out-of-pocket max", field: d.outOfPocketMax, unit: "$" },
    ...COPAY_KEYS.map((k) => ({
      key: k,
      label: `${COPAY_LABELS[k]} copay`,
      field: d.copays[k],
      unit: "$" as const,
      after: d.copays[k].afterDeductible,
    })),
  ];
}

export function ConfirmDecoded({ decoded, dispatch }: { decoded: Decoded; dispatch: Dispatch<Action> }) {
  const rows = rowsOf(decoded);
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.field.value === null ? "" : String(r.field.value)]))
  );

  function confirm() {
    const read = (k: string): number | null => {
      const v = (vals[k] ?? "").replace(/[$,%\s]/g, "");
      const n = Number(v);
      return v === "" || !Number.isFinite(n) || n < 0 ? null : n;
    };
    const base = decodedToCard(decoded);
    const copays: typeof base.copays = {};
    for (const k of COPAY_KEYS) {
      const n = read(k);
      if (n !== null) copays[k] = n;
    }
    dispatch({
      type: "confirmDecoded",
      card: {
        ...base,
        deductible: read("deductible"),
        coinsurancePct: read("coinsurancePct"),
        outOfPocketMax: read("outOfPocketMax"),
        copays,
      },
      info: {
        planName: decoded.planName,
        insurer: decoded.insurer,
        network: decoded.network,
        planType: decoded.planType,
        memberPhone: decoded.memberPhone,
        nurseLine: decoded.nurseLine,
        website: decoded.website,
        selfFunded: decoded.selfFunded,
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[16px] bg-ink text-surface px-4 py-3">
        <div className="font-serif text-xl leading-tight">{decoded.planName ?? "Your plan"}</div>
        <div className="text-[13px] text-surface/70 mt-1">
          {[decoded.insurer, decoded.planType, decoded.network].filter(Boolean).join(" · ") || "Insurer not printed"}
        </div>
        {decoded.nurseLine && <div className="text-[13px] mt-2">Nurse line {decoded.nurseLine}</div>}
        {decoded.source === "sample" && <div className="text-[12px] text-surface/60 mt-2">{SAMPLE_CITATION}</div>}
      </div>

      <ul className="divide-y divide-line rounded-[16px] border border-line bg-surface">
        {rows.map((r, i) => (
          <motion.li
            key={r.key}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 * i }}
            className="px-4 py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`f-${r.key}`} className="text-[14px]">
                {r.label}
                {r.after && <span className="ml-2 text-[11px] text-dim">after deductible</span>}
              </label>
              <span className="flex items-center font-serif text-xl tabular">
                {r.unit === "$" && <span className="text-dim mr-0.5">$</span>}
                <input
                  id={`f-${r.key}`}
                  inputMode="decimal"
                  value={vals[r.key]}
                  placeholder="none"
                  onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })}
                  size={Math.max(4, (vals[r.key] ?? "").length + 1)}
                  className="bg-transparent text-right outline-none border-b border-transparent focus:border-blue placeholder:text-line placeholder:text-base"
                />
                {r.unit === "%" && <span className="text-dim ml-0.5">%</span>}
              </span>
            </div>
            {r.field.quote && (
              <div className="text-[12px] text-dim mt-0.5 truncate" title={r.field.quote}>
                &ldquo;{r.field.quote}&rdquo;{r.field.page ? `, page ${r.field.page}` : ""}
              </div>
            )}
          </motion.li>
        ))}
      </ul>
      <p className="text-[12px] text-dim">
        Blank means your plan charges its regular share for that service instead of a flat copay.
      </p>

      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={confirm}
        className="min-h-11 px-5 rounded-full bg-ink text-surface text-[15px]"
      >
        Looks right, run my year
      </motion.button>
    </div>
  );
}
