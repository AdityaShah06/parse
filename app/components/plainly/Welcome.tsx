"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { Door } from "@/lib/app-state";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import { onVoice, setVoice, voiceOn } from "./voice";
import { Icon } from "../ui";

const INTRO = [
  "Hello. I'm Plainly.",
  "I read health insurance so you don't have to.",
  "I don't check your pulse. I check your plan.",
  "Then I tell you what a year of being a person costs.",
];

const FACTS = [
  "43 Missouri plans loaded",
  "23 states protect you from surprise ambulance bills. Missouri is not one of them",
  "1 in 5 in-network marketplace claims denied in 2024 (KFF)",
  "Under 1% of those were appealed",
  "About a third of appeals win",
  "0 dollar figures made up by an AI",
];

/** Room 1: the guide introduces itself, then asks the only question that matters. */
export default function Welcome({ onDoor, stage, onIntroDone }: { onDoor: (d: Door) => void; stage: "intro" | "doors"; onIntroDone: () => void }) {
  const [mood, setMood] = useState<"calm" | "happy">("calm");
  const [voice, setVoiceState] = useState(false);
  const [take, setTake] = useState(0);
  useEffect(() => {
    setVoiceState(voiceOn());
    return onVoice(setVoiceState);
  }, []);
  const toggleVoice = () => {
    const on = !voice;
    setVoice(on);
    // Turning the voice on mid-introduction starts it over, out loud.
    if (on && stage === "intro") setTake((t) => t + 1);
  };

  return (
    <main className="garden relative min-h-screen overflow-hidden">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-10 pt-10 sm:pt-16 pb-28 grid gap-10 lg:grid-cols-[360px_1fr] items-start">
        <div className="justify-self-center lg:justify-self-start lg:sticky lg:top-24 flex flex-col items-center">
          <motion.div layoutId="sphere" transition={{ type: "spring", duration: 0.8, bounce: 0 }}>
            <Sphere size={300} mood={mood} className="max-sm:!w-[220px] max-sm:!h-[220px]" />
          </motion.div>
          <motion.button
            type="button"
            onClick={toggleVoice}
            aria-pressed={voice}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className={`mt-6 flex items-center gap-2 rounded-full border h-10 px-4 text-[13.5px] transition-colors ${voice ? "border-moss/50 bg-sage text-ink" : "border-line text-dim hover:text-ink"}`}
          >
            <Icon name={voice ? "speaker" : "mute"} className="size-4" />
            {voice ? "Voice on" : "Hear me say it"}
          </motion.button>
        </div>

        <div className="min-w-0 lg:pt-10">
          <AnimatePresence mode="wait">
            {stage === "intro" ? (
              <motion.div key="intro" exit={{ opacity: 0, y: -12, filter: "blur(6px)" }} transition={{ duration: 0.35 }}>
                <Kinetic key={take} lines={INTRO} onDone={() => { setMood("happy"); setTimeout(onIntroDone, 700); }} />
                <button type="button" onClick={onIntroDone} className="mt-8 text-[13px] text-faint hover:text-ink transition-colors">
                  Skip the introduction
                </button>
              </motion.div>
            ) : (
              <motion.div key="doors" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Kinetic lines={["One question.", "Do you get to pick your plan?"]} size="xl" />
                <div className="mt-10 grid gap-4 md:grid-cols-2">
                  <DoorCard
                    i={0}
                    title="Someone else picks it."
                    line="A parent, a job, or your school. Hand me the paperwork and I'll translate it."
                    onClick={() => onDoor("fixed")}
                    art={<ScanArt />}
                  />
                  <DoorCard
                    i={1}
                    title="I pick it."
                    line="Shopping, turning 26, or changing jobs. I'll find the plan that fits your life, not just your wallet."
                    onClick={() => onDoor("switch")}
                    art={<ShuffleArt />}
                  />
                </div>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-dim">
                  <button type="button" onClick={() => onDoor("medicaid")} className="hover:text-ink underline decoration-line-strong underline-offset-4">I&rsquo;m on MO HealthNet</button>
                  <button type="button" onClick={() => onDoor("uninsured")} className="hover:text-ink underline decoration-line-strong underline-offset-4">I don&rsquo;t have insurance</button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <FactStrip />
      <p className="lg:fixed lg:bottom-14 lg:left-0 lg:right-0 text-center text-[12px] text-faint px-8 -mt-16 pb-24 lg:m-0 lg:p-0">I do math, not medicine. If something hurts, call 911 or your plan&rsquo;s nurse line.</p>
    </main>
  );
}

function DoorCard({ title, line, onClick, art, i }: { title: string; line: string; onClick: () => void; art: React.ReactNode; i: number }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 + i * 0.08, duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      className="card group text-left p-2 overflow-hidden"
    >
      <div className="relative h-[190px] rounded-[20px] overflow-hidden bg-paper">{art}</div>
      <div className="px-4 pt-4 pb-3 flex items-end justify-between gap-4">
        <p className="text-[17px] leading-snug">
          <span className="text-ink font-medium">{title}</span> <span className="text-dim">{line}</span>
        </p>
        <span className="shrink-0 grid place-items-center size-9 rounded-full bg-ink text-paper transition-transform group-hover:translate-x-1">→</span>
      </div>
    </motion.button>
  );
}

/** A benefits PDF with a scan line sweeping it: the "someone else picks" door. */
function ScanArt() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="relative w-[150px] h-[170px] rounded-md bg-surface shadow-[0_18px_40px_-18px_rgb(0_0_0/0.35)] border border-line p-3 rotate-[-4deg]">
        <div className="text-[7px] tracking-[0.12em] uppercase text-faint">Summary of Benefits</div>
        {[70, 90, 55, 80, 62, 88, 40, 76, 58].map((w, k) => (
          <div key={k} className="h-[5px] rounded-full bg-line-strong mt-2" style={{ width: `${w}%` }} />
        ))}
        <motion.div
          className="absolute inset-x-0 h-8 bg-gradient-to-b from-transparent via-mint/60 to-transparent"
          animate={{ y: [0, 140, 0] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          style={{ top: 0 }}
        />
      </div>
      <div className="absolute right-[18%] bottom-[18%] rotate-[6deg] rounded-md bg-moss text-paper text-[10px] px-2 py-1 shadow-lg">Deductible $7,500</div>
    </div>
  );
}

/** Three plan cards shuffling: the "I pick it" door. */
function ShuffleArt() {
  const cards = [
    { c: "var(--moss)", t: "Gold PPO" },
    { c: "var(--gold)", t: "Silver EPO" },
    { c: "var(--coral)", t: "Bronze HMO" },
  ];
  return (
    <div className="absolute inset-0 grid place-items-center">
      {cards.map((k, i) => (
        <motion.div
          key={k.t}
          className="absolute w-[150px] h-[92px] rounded-[14px] p-3 text-paper shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)]"
          style={{ background: k.c }}
          animate={{ x: [(i - 1) * 46, (i - 1) * 46 + (i === 1 ? 0 : i === 0 ? 30 : -30), (i - 1) * 46], rotate: [(i - 1) * 7, (i - 1) * -3, (i - 1) * 7], zIndex: [i, 3 - i, i] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
        >
          <div className="text-[11px] opacity-80">Plan</div>
          <div className="text-[14px] font-medium">{k.t}</div>
        </motion.div>
      ))}
    </div>
  );
}

/** Ramp's live strip, with only true numbers in it. */
function FactStrip() {
  const row = [...FACTS, ...FACTS];
  return (
    <div className="fixed bottom-0 inset-x-0 border-t border-line glass overflow-hidden">
      <motion.div
        className="flex gap-10 whitespace-nowrap py-2.5 text-[12px] text-dim w-max will-change-transform"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
      >
        {row.map((f, i) => (
          <span key={i} className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-moss" />
            {f}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
