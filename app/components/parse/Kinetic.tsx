"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { onVoice, prefetch, speak, stop, voiceOn } from "./voice";

/**
 * The guide does not chat. It writes on the page. Lines arrive one at a time
 * down a staircase: each new line steps in from the left, finished lines fade
 * back so the eye always lands on the newest thought. Click anywhere in the
 * block to finish the current line instantly.
 */
export default function Kinetic({
  lines,
  onDone,
  size = "xl",
  voice = false,
  stair = true,
  className = "",
}: {
  lines: string[];
  onDone?: () => void;
  size?: "xl" | "lg" | "md";
  voice?: boolean;
  stair?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? lines.length : 1);
  const [skipped, setSkipped] = useState(false);
  const done = useRef(false);
  const key = lines.join("|");

  useEffect(() => {
    setShown(reduce ? lines.length : 1);
    setSkipped(false);
    done.current = false;
  }, [key, reduce, lines.length]);

  // Ask for every line's audio up front so each one plays the instant it's due.
  useEffect(() => {
    prefetch(lines);
    return onVoice((on) => on && prefetch(lines));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Time each line by its length (reading pace, not typing pace). With the
  // voice on, the next line also waits for the current one to be spoken.
  useEffect(() => {
    if (shown > lines.length) return;
    const line = lines[shown - 1] ?? "";
    let alive = true;
    let timerDone = false;
    let spoken = skipped;
    const next = () => {
      if (!alive || !timerDone || !spoken) return;
      if (shown < lines.length) setShown((n) => n + 1);
      else if (!done.current) {
        done.current = true;
        onDone?.();
      }
    };
    if (!skipped) {
      speak(line).then(() => {
        spoken = true;
        // A short breath between spoken lines.
        setTimeout(next, voiceOn() ? 220 : 0);
      });
    }
    const words = line.split(" ").length;
    const ms = skipped ? 60 : Math.min(2600, 420 + words * 95);
    const t = setTimeout(() => {
      timerDone = true;
      next();
    }, ms);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, key, skipped]);

  const text = size === "xl" ? "text-[2.4rem] sm:text-[3.4rem] leading-[1.02]" : size === "lg" ? "text-[1.9rem] sm:text-[2.5rem] leading-[1.05]" : "text-[1.45rem] sm:text-[1.8rem] leading-[1.12]";

  return (
    <div
      className={`font-serif tracking-[-0.02em] ${text} ${className}`}
      onClick={() => {
        setSkipped(true);
        stop();
      }}
      aria-live="polite"
    >
      <span className="sr-only">{lines.join(" ")}</span>
      {lines.slice(0, shown).map((line, i) => {
        const current = i === shown - 1;
        return (
          <motion.p
            key={`${key}-${i}`}
            aria-hidden
            className="mb-[0.28em]"
            animate={{ opacity: current || !stair ? 1 : 0.34 }}
            transition={{ duration: 0.5 }}
            style={{ paddingLeft: stair ? `${Math.min(i, 3) * 6}%` : 0 }}
          >
            {line.split(" ").map((w, j) => (
              <motion.span
                key={j}
                className="inline-block mr-[0.24em]"
                initial={skipped || reduce ? false : { opacity: 0, y: "0.35em", filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
                transition={{ delay: j * 0.045, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              >
                {w}
              </motion.span>
            ))}
            {current && !reduce && (
              <span className="inline-block w-[3px] h-[0.8em] translate-y-[0.08em] rounded-full bg-moss align-baseline animate-[caret_1s_steps(1)_infinite] will-change-[opacity]" />
            )}
          </motion.p>
        );
      })}
    </div>
  );
}
