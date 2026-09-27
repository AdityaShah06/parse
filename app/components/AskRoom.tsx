"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { FAQ, STARTERS } from "@/lib/kb/faq";
import { PEOPLE } from "@/lib/kb/people";
import { FALLBACK_ANSWER, screen, type GuideAnswer } from "@/lib/guide";
import type { RoomId } from "./Planner";
import Orb from "./Orb";
import { CallCard, Icon, RoomHeader } from "./ui";

type Msg = { id: number; who: "you" | "guide"; text: string; answer?: GuideAnswer };

const ROOM_LABEL: Record<string, string> = {
  rx: "Rx and tests",
  denied: "Denied?",
  ambulance: "Ambulance",
  care: "Find care",
  compare: "Compare",
  year: "Your year",
};

const INTRO: Msg = {
  id: 0,
  who: "guide",
  text: "Ask me anything about your coverage: bills, denials, deductibles, taxes. I won't give medical advice, and every answer ends with someone you can call.",
};

export default function AskRoom({ selfFunded, go }: { selfFunded: boolean | null; go: (r: RoomId) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([INTRO]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs.length, busy]);

  async function ask(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setQ("");
    const id = Date.now();
    setMsgs((m) => [...m, { id, who: "you", text: t }]);

    // Checked answers and safety rules first: instant, and they work offline.
    const local = screen(t);
    if (local) {
      setBusy(true);
      await new Promise((r) => setTimeout(r, 450));
      setMsgs((m) => [...m, { id: id + 1, who: "guide", text: local.text, answer: local }]);
      setBusy(false);
      return;
    }

    setBusy(true);
    let answer: GuideAnswer = FALLBACK_ANSWER;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: t, selfFunded }),
      });
      const j = await res.json();
      if (j?.ok && j.answer?.text) answer = j.answer as GuideAnswer;
    } catch {
      // Offline: the fallback still ends at a person.
    }
    setMsgs((m) => [...m, { id: id + 1, who: "guide", text: answer.text, answer }]);
    setBusy(false);
  }

  const starters = STARTERS.map((id) => FAQ.find((f) => f.id === id)!).filter(Boolean);

  return (
    <section>
      <RoomHeader
        eyebrow="Ask"
        title="Plain answers. Then a person."
        lede="Checked answers come first and work offline. Anything new goes to Gemini with strict rules: no medical advice, no made-up prices."
      />

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
          <Orb thinking={busy} size={38} />
          <div>
            <div className="font-serif text-xl leading-none">Your guide</div>
            <div className="text-[12px] text-dim mt-1">Insurance questions only. For symptoms, call your nurse line or 911.</div>
          </div>
        </div>

        <div className="px-5 py-6 space-y-5 min-h-[320px]" aria-live="polite">
          <AnimatePresence initial={false}>
            {msgs.map((m) =>
              m.who === "you" ? (
                <motion.p
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-[6px] bg-white/[0.08] border border-line px-4 py-2.5 text-[15px]"
                >
                  {m.text}
                </motion.p>
              ) : (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="max-w-[640px]"
                >
                  {m.answer?.kind === "medical" || m.answer?.kind === "crisis" ? (
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-red/40 bg-red/10 px-2.5 py-0.5 text-[11.5px] text-red">
                      <Icon name="shield" className="size-3.5" />
                      {m.answer.kind === "crisis" ? "You are not alone" : "Not medical advice"}
                    </div>
                  ) : m.answer?.kind === "faq" ? (
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-2.5 py-0.5 text-[11.5px] text-good">
                      <Icon name="check" className="size-3.5" />
                      Checked answer
                    </div>
                  ) : null}
                  <p className="text-[16px] leading-relaxed">{m.text}</p>
                  {m.answer?.source && <p className="text-[11.5px] text-faint mt-1.5">Source: {m.answer.source}</p>}
                  {m.answer && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {m.answer.people
                        .map((id) => (id === "moDci" && selfFunded === true ? "ebsa" : id))
                        .filter((id, i, a) => PEOPLE[id] && a.indexOf(id) === i)
                        .map((id) => (
                          <CallCard key={id} person={PEOPLE[id]} compact />
                        ))}
                    </div>
                  )}
                  {m.answer?.room && (
                    <button
                      type="button"
                      onClick={() => go(m.answer!.room as RoomId)}
                      className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] text-blue hover:text-ink transition-colors"
                    >
                      Open {ROOM_LABEL[m.answer.room]}
                      <Icon name="arrow" className="size-3.5" />
                    </button>
                  )}
                </motion.div>
              )
            )}
          </AnimatePresence>
          {busy && (
            <div className="flex gap-1.5 py-1" aria-label="Thinking">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1.5 rounded-full bg-blue"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          )}
          <div ref={end} />
        </div>

        <div className="border-t border-line px-5 py-4 space-y-3">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {starters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => ask(f.q)}
                className="shrink-0 rounded-full border border-line bg-white/[0.02] px-3.5 py-2 text-[13px] text-dim hover:text-ink hover:border-line-strong transition-colors"
              >
                {f.q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(q);
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask about a bill, a denial, a deductible..."
              aria-label="Your question"
              className="min-h-12 flex-1 rounded-full border border-line-strong bg-white/[0.04] px-5 text-[15px] outline-none focus:border-blue/70"
            />
            <button
              type="submit"
              disabled={busy || !q.trim()}
              className="grid place-items-center size-12 shrink-0 rounded-full bg-ink text-paper disabled:opacity-40"
              aria-label="Ask"
            >
              <Icon name="arrow" className="size-5" />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
