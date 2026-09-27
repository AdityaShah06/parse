"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { Room } from "@/lib/app-state";
import { Icon } from "../ui";
import { setTheme, useTheme } from "./theme";
import { onVoice, setVoice, voiceOn } from "./voice";
import { BRAND } from "@/lib/brand";

export const ROOMS: { id: Room; label: string; line: string; icon: string }[] = [
  { id: "plan", label: "Your plan", line: "What you actually have", icon: "plan" },
  { id: "year", label: "Stress test", line: "Break your year on purpose", icon: "receipt" },
  { id: "plans", label: "Better plan", line: "If you get to choose", icon: "compare" },
  { id: "rx", label: "Pharmacy", line: "Card or coupon", icon: "rx" },
  { id: "care", label: "Find care", line: "Where, and for how much", icon: "care" },
  { id: "ambulance", label: "Ambulance", line: "The ride nobody covers", icon: "ambulance" },
  { id: "denied", label: "Denied", line: "Translate the letter", icon: "denied" },
  { id: "ask", label: "Ask", line: "Anything but symptoms", icon: "ask" },
];

/**
 * The wall. A slim med-tech light panel on the left edge: a column of lit
 * cells with a heartbeat trace running down its seam. Hover and it slides
 * open to show names. On phones it becomes a dock at the bottom.
 */
export default function Wall({ room, go, restart }: { room: Room; go: (r: Room) => void; restart: () => void }) {
  const [open, setOpen] = useState(false);
  const [theme] = useTheme();
  const [voice, setVoiceState] = useState(false);
  useEffect(() => {
    setVoiceState(voiceOn());
    return onVoice(setVoiceState);
  }, []);

  const controls = (
    <>
      <WallButton
        icon={theme === "night" ? "sun" : "moon"}
        label={theme === "night" ? "Daylight" : "Night mode"}
        open={open}
        onClick={(e) => setTheme(theme === "night" ? "day" : "night", { x: e.clientX, y: e.clientY })}
      />
      <WallButton icon={voice ? "speaker" : "mute"} label={voice ? "Voice on" : "Voice off"} open={open} onClick={() => setVoice(!voice)} />
      <WallButton icon="reset" label="Start over" open={open} onClick={restart} />
    </>
  );

  return (
    <>
      <motion.nav
        aria-label="Rooms"
        onHoverStart={() => setOpen(true)}
        onHoverEnd={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
        }}
        animate={{ width: open ? 248 : 76 }}
        transition={{ type: "spring", duration: 0.45, bounce: 0 }}
        className="glass fixed left-3 top-3 bottom-3 z-50 hidden lg:flex flex-col rounded-[28px] overflow-hidden"
        style={{ boxShadow: "var(--shadow)" }}
      >
        {/* Lightbox grid behind the cells. */}
        <div className="absolute inset-0 pointer-events-none opacity-60 garden" />
        <Heartbeat />

        <div className="relative flex items-center gap-3 px-[18px] pt-5 pb-4">
          <span className="grid place-items-center size-10 shrink-0 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, var(--mint), var(--moss) 75%)" }}>
            <span className="w-4 h-[2px] rounded-full bg-paper/90" />
          </span>
          <AnimatePresence>
            {open && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4, transition: { duration: 0.1 } }}
                className="font-serif text-[22px] whitespace-nowrap"
              >
                {BRAND.name}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <ul className="relative flex-1 flex flex-col gap-1 px-3">
          {ROOMS.map((r) => {
            const on = r.id === room;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={(e) => {
                    go(r.id);
                    setOpen(false);
                    e.currentTarget.blur();
                  }}
                  aria-label={r.label}
                  title={open ? undefined : r.label}
                  aria-current={on ? "page" : undefined}
                  className={`relative w-full flex items-center gap-3 h-[52px] rounded-[18px] px-[14px] text-left transition-colors ${on ? "text-ink" : "text-dim hover:text-ink"}`}
                >
                  {on && (
                    <motion.span
                      layoutId="wall-cell"
                      className="absolute inset-0 rounded-[18px] bg-surface"
                      style={{ boxShadow: "0 0 0 1px var(--line), 0 8px 20px -12px rgb(0 0 0 / 0.3)" }}
                      transition={{ type: "spring", duration: 0.4, bounce: 0 }}
                    />
                  )}
                  {on && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-moss" />}
                  <span className="relative grid place-items-center size-6 shrink-0">
                    <Icon name={r.icon} className="size-[20px]" />
                  </span>
                  <AnimatePresence>
                    {open && (
                      <motion.span
                        className="relative min-w-0"
                        initial={{ opacity: 0, x: -8, filter: "blur(4px)" }}
                        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, transition: { duration: 0.08 } }}
                        transition={{ type: "spring", duration: 0.35, bounce: 0 }}
                      >
                        <span className="block text-[14px] leading-tight whitespace-nowrap">{r.label}</span>
                        <span className="block text-[11.5px] text-faint whitespace-nowrap">{r.line}</span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="relative flex flex-col gap-1 px-3 pb-4 pt-3 border-t border-line">{controls}</div>
      </motion.nav>

      {/* Phone dock. */}
      <nav aria-label="Rooms" className="lg:hidden glass fixed inset-x-3 bottom-3 z-50 rounded-[24px] px-1.5 py-1.5 flex items-center justify-between" style={{ boxShadow: "var(--shadow)", background: "color-mix(in oklab, var(--surface) 88%, transparent)" }}>
        {ROOMS.map((r) => {
          const on = r.id === room;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => go(r.id)}
              aria-label={r.label}
              aria-current={on ? "page" : undefined}
              className={`relative flex-1 flex flex-col items-center justify-center h-12 rounded-2xl ${on ? "text-moss" : "text-dim"}`}
            >
              {on && <motion.span layoutId="dock-cell" className="absolute inset-0 rounded-2xl bg-sage" transition={{ type: "spring", duration: 0.4, bounce: 0 }} />}
              <span className="relative"><Icon name={r.icon} className="size-5" /></span>
              {on && <motion.span layoutId="dock-dot" className="absolute bottom-1.5 size-1 rounded-full bg-moss" />}
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Switch theme"
          onClick={(e) => setTheme(theme === "night" ? "day" : "night", { x: e.clientX, y: e.clientY })}
          className="flex-1 flex flex-col items-center justify-center h-12 text-dim border-l border-line"
        >
          <Icon name={theme === "night" ? "sun" : "moon"} className="size-5" />
        </button>
      </nav>
    </>
  );
}

function WallButton({ icon, label, open, onClick }: { icon: string; label: string; open: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex items-center gap-3 h-10 rounded-[14px] px-[14px] text-dim hover:text-ink hover:bg-surface/60 transition-colors">
      <span className="grid place-items-center size-6 shrink-0"><Icon name={icon} className="size-[18px]" /></span>
      <AnimatePresence>
        {open && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} className="text-[13px] whitespace-nowrap">
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/** A heartbeat trace running down the wall's right seam. Decoration. */
function Heartbeat() {
  const d = "M6 0 V120 L2 128 L10 136 L3 146 L6 152 V300 L2 306 L11 316 L4 326 L6 332 V520 L2 526 L10 536 L3 546 L6 552 V800";
  return (
    <svg className="absolute right-0 top-0 h-full w-3 pointer-events-none" viewBox="0 0 12 800" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <motion.path
        d={d}
        fill="none"
        stroke="var(--moss)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeDasharray="60 1400"
        animate={{ strokeDashoffset: [1460, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
      />
    </svg>
  );
}
