"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { Person } from "@/lib/kb/people";

/* Icons: one stroke weight, drawn on a 24 grid. No icon package needed. */
const PATHS: Record<string, ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  year: (
    <>
      <path d="M4 19h16" />
      <path d="M7 16V11M12 16V7M17 16v-3" />
    </>
  ),
  rx: (
    <>
      <rect x="3.5" y="9" width="17" height="6" rx="3" transform="rotate(-40 12 12)" />
      <path d="m10.1 9.8 4.1 4.9" />
    </>
  ),
  care: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <path d="M12 7.5v5M9.5 10h5" />
    </>
  ),
  ambulance: (
    <>
      <path d="M3 16V8.5a1 1 0 0 1 1-1h9v8.5M13 10h3.8l3.2 3.4V16" />
      <circle cx="7" cy="17" r="1.8" />
      <circle cx="17" cy="17" r="1.8" />
      <path d="M8 9.5v3M6.5 11h3" />
    </>
  ),
  denied: (
    <>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" />
      <path d="m10 12 4 4M14 12l-4 4" />
    </>
  ),
  ask: <path d="M5 5.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-7l-4.5 3.5V16H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" />,
  compare: (
    <>
      <path d="M4 7h11M4 12h16M4 17h7" />
    </>
  ),
  phone: <path d="M6.5 4h3l1.5 4-2 1.2a10 10 0 0 0 5.8 5.8L16 13l4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A15 15 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4z" />,
  arrow: <path d="M5 12h13M13 6l6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18" cy="12" r="1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  shield: <path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  video: (
    <>
      <rect x="3.5" y="6.5" width="12" height="11" rx="2" />
      <path d="m15.5 10.5 5-3v9l-5-3" />
    </>
  ),
  guide: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  reset: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7" />,
  upload: (
    <>
      <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  plan: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M3.5 10h17M7 14.5h4" />
    </>
  ),
};

export function Icon({ name, className = "size-[18px]" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name] ?? null}
    </svg>
  );
}

export function Stars({ rating }: { rating: number }) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <span className="relative inline-block leading-none text-[12px] tracking-[1px]" aria-label={`${rating} out of 5`}>
      <span className="text-line-strong">★★★★★</span>
      <span className="absolute inset-0 overflow-hidden text-gold" style={{ width: `${pct}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

/**
 * Rooms no longer open with a header stack: the guide's sentence is the
 * heading. This keeps only the small aside (a badge) when a room passes one.
 */
export function RoomHeader({ aside }: { eyebrow?: string; title?: ReactNode; lede?: ReactNode; aside?: ReactNode }) {
  if (!aside) return null;
  return <div className="flex justify-end mb-4">{aside}</div>;
}

export function Button({
  children,
  onClick,
  kind = "primary",
  className = "",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "quiet" | "ghost";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const look =
    kind === "primary"
      ? "bg-ink text-paper hover:bg-white shadow-[0_8px_24px_-10px_rgb(255_255_255/0.35)]"
      : kind === "quiet"
        ? "border border-line bg-white/[0.03] text-ink hover:border-line-strong hover:bg-white/[0.06]"
        : "text-dim hover:text-ink";
  return (
    <motion.button
      type={type}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-full text-[14.5px] transition-colors disabled:opacity-40 ${look} ${className}`}
    >
      {children}
    </motion.button>
  );
}

/** A real person to call. Every path ends at one of these. */
export function CallCard({ person, compact = false }: { person: Person; compact?: boolean }) {
  const tel = person.phone ? `tel:${person.phone.replace(/\D/g, "")}` : null;
  return (
    <div className={`card-quiet flex items-start gap-3 ${compact ? "p-3" : "p-4"}`}>
      <span className="mt-0.5 grid place-items-center size-8 shrink-0 rounded-full bg-good/10 text-good">
        <Icon name="phone" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[14.5px]">{person.name}</span>
          {tel ? (
            <a href={tel} className="font-mono text-[13px] text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              {person.phone}
            </a>
          ) : null}
        </div>
        {!compact && <p className="text-[13px] text-dim mt-1 leading-snug">{person.when}</p>}
      </div>
    </div>
  );
}

/** Fades and lifts children in, staggered by index. */
export function Rise({ children, i = 0, className = "" }: { children: ReactNode; i?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
