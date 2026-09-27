"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { CareEvent, Plan } from "@/lib/engine";
import { usd } from "@/lib/catalog";
import {
  HOME,
  KIND_LABEL,
  KIND_VISIT,
  PROVIDERS,
  SETTINGS,
  milesFromHome,
  visitCost,
  visitDate,
  type CareKind,
  type Provider,
} from "@/lib/care";
import { PEOPLE } from "@/lib/kb/people";
import Money from "./Money";
import { CallCard, Icon, RoomHeader, Rise, Stars } from "./ui";

const FILTERS: { id: CareKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "primary", label: "Primary care" },
  { id: "urgent", label: "Urgent care" },
  { id: "er", label: "Emergency" },
  { id: "mental", label: "Mental health" },
  { id: "specialist", label: "Orthopedics" },
  { id: "imaging", label: "Imaging" },
  { id: "pharmacy", label: "Pharmacy" },
];

const spring = { type: "spring" as const, stiffness: 110, damping: 20 };

export default function CareRoom({
  plan,
  baseEvents,
  uninsured,
  medicaid,
}: {
  plan: Plan;
  baseEvents: CareEvent[];
  uninsured: boolean;
  medicaid: boolean;
}) {
  const [places, setPlaces] = useState<Provider[]>(PROVIDERS);
  const [filter, setFilter] = useState<CareKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string>("stadium-uc");
  const [run, setRun] = useState(0);
  const date = useMemo(() => visitDate(), []);
  const opts = { preventiveIsFree: !uninsured };

  // Same shape from the route; the bundled list stays if the route is unreachable.
  useEffect(() => {
    let alive = true;
    fetch("/api/places")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.ok && Array.isArray(j.places) && j.places.length) setPlaces(j.places);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const settings = useMemo(
    () => SETTINGS.map((s) => ({ ...s, cost: visitCost(plan, baseEvents, s.key, date, opts) })),
    [plan, baseEvents, date, uninsured]
  );
  const widest = Math.max(1, ...settings.map((s) => s.cost.allowed)); // layout ratio only

  const shown = places.filter((p) => filter === "all" || p.kind === filter);
  const selected = places.find((p) => p.id === selectedId) ?? shown[0] ?? places[0];
  const cost = useMemo(
    () => visitCost(plan, baseEvents, KIND_VISIT[selected.kind], date, opts),
    [plan, baseEvents, selected.kind, date, uninsured]
  );
  const costs = useMemo(() => {
    const m = new Map<CareKind, number>();
    for (const p of places) if (!m.has(p.kind)) m.set(p.kind, visitCost(plan, baseEvents, KIND_VISIT[p.kind], date, opts).you);
    return m;
  }, [places, plan, baseEvents, date, uninsured]);

  return (
    <section>
      <RoomHeader
        eyebrow="Find care"
        title="Where to go, and what it costs you there."
        lede="Every price below is a visit today on your plan, after the care you have already had this year. We never tell you where to go for a symptom."
      />

      <Rise className="mb-5 flex items-center gap-3 rounded-2xl border border-red/30 bg-red/[0.06] px-4 py-3 text-[14px]">
        <span className="grid place-items-center size-8 shrink-0 rounded-full bg-red/15 text-red">
          <Icon name="shield" className="size-4" />
        </span>
        <span>
          If you think it is an emergency, <a href="tel:911" className="underline underline-offset-4">call 911</a> or go to the nearest ER.
          Cost questions can wait.
        </span>
      </Rise>

      {/* One visit, three doors. */}
      <Rise i={1} className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">One visit, three doors</div>
            <h3 className="font-serif text-[1.7rem] leading-tight mt-2">The same kind of visit costs wildly different amounts.</h3>
          </div>
          <button
            type="button"
            onClick={() => setRun((n) => n + 1)}
            className="inline-flex items-center gap-2 min-h-9 px-3.5 rounded-full border border-line text-[13px] text-dim hover:text-ink hover:border-line-strong"
          >
            <Icon name="spark" className="size-4" />
            Replay
          </button>
        </div>

        <div key={run} className="mt-7 space-y-6">
          {settings.map((s, i) => {
            const total = s.cost.you + s.cost.plan; // layout ratio only
            const w = (s.cost.allowed / widest) * 100;
            const youShare = total > 0 ? (s.cost.you / total) * 100 : 0;
            return (
              <div key={s.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className={`grid place-items-center size-8 rounded-full ${s.key === "er" ? "bg-red/15 text-red" : "bg-blue/15 text-blue"}`}>
                      <Icon name={s.icon} className="size-4" />
                    </span>
                    <span className="text-[16px]">{s.title}</span>
                    <span className="text-[12px] text-faint hidden sm:inline">· {s.wait}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-serif text-3xl text-red leading-none">
                      <Money value={s.cost.you} />
                    </span>
                    <span className="text-[12px] text-dim ml-2">you pay</span>
                  </div>
                </div>
                <div className="relative mt-3 h-3 rounded-full bg-white/[0.04] overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0 flex rounded-full overflow-hidden"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(w, 1.5)}%` }}
                    transition={{ ...spring, delay: 0.15 + i * 0.18 }}
                  >
                    <div className="h-full bg-red shadow-[0_0_14px] shadow-red/60" style={{ width: `${youShare}%` }} />
                    <div className="h-full flex-1 bg-blue/80" />
                  </motion.div>
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-[12.5px] text-dim">
                  <span>{s.when}</span>
                  <span className="font-mono tabular">
                    plan pays <span className="text-blue">{usd(s.cost.plan)}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-[12px] text-faint">
          Typical allowed amounts for each kind of visit, run through {uninsured ? "full price" : medicaid ? "MO HealthNet" : "your plan's rules"}. Bar length is the full price.
        </p>
      </Rise>

      {/* Map and places. */}
      <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setFilter(f.id);
              const first = places.find((p) => f.id === "all" || p.kind === f.id);
              if (first) setSelectedId(first.id);
            }}
            aria-pressed={filter === f.id}
            className={`relative shrink-0 min-h-9 px-4 rounded-full text-[13px] border transition-colors ${
              filter === f.id ? "border-transparent text-paper" : "border-line text-dim hover:text-ink"
            }`}
          >
            {filter === f.id && <motion.span layoutId="care-filter" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative">{f.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Rise i={2} className="card overflow-hidden min-w-0">
          <CareMap places={places} shown={shown} selected={selected} onSelect={setSelectedId} />
          <AnimatePresence mode="wait">
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="p-5 sm:p-6 border-t border-line"
            >
              <Detail p={selected} cost={cost} uninsured={uninsured} />
            </motion.div>
          </AnimatePresence>
        </Rise>

        <Rise i={3} className="min-w-0">
          <ul className="space-y-2.5">
            <AnimatePresence initial={false}>
              {shown.map((p) => {
                const on = p.id === selected.id;
                return (
                  <motion.li key={p.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      aria-pressed={on}
                      className={`w-full text-left rounded-2xl border px-4 py-3.5 transition-colors ${
                        on ? "border-moss/60 bg-sage" : "border-line bg-surface/60 hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[15px] truncate">{p.name}</div>
                          <div className="text-[12.5px] text-dim mt-0.5 flex flex-wrap items-center gap-x-2">
                            <span>{KIND_LABEL[p.kind]}</span>
                            <span className="text-faint">·</span>
                            <span>{milesFromHome(p)} mi</span>
                            {p.rating ? (
                              <>
                                <span className="text-faint">·</span>
                                <Stars rating={p.rating} />
                                <span>{p.rating.toFixed(1)}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {p.network === "out" ? (
                            <span className="text-[12px] text-red">Out of network</span>
                          ) : (
                            <>
                              <div className="font-mono text-[14px] tabular">{usd(costs.get(p.kind) ?? 0)}</div>
                              <div className="text-[11px] text-dim">{p.network === "in" ? "in network" : p.kind === "er" ? "emergency" : "call to confirm"}</div>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>

          <div className="card p-5 mt-5">
            <div className="eyebrow">Can&rsquo;t afford the bill?</div>
            <p className="text-[14px] text-dim mt-2 leading-relaxed">
              Nonprofit hospitals must have a written financial assistance policy and limit what they charge people who
              qualify. Each hospital sets its own income rules, so ask for the policy before you pay.
            </p>
            <div className="mt-4">
              <CallCard person={PEOPLE.assistance} compact />
            </div>
          </div>
        </Rise>
      </div>
    </section>
  );
}

function Detail({ p, cost, uninsured }: { p: Provider; cost: { you: number; plan: number }; uninsured: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-dim">{KIND_LABEL[p.kind]} · {p.address}</div>
          <h3 className="font-serif text-[1.9rem] leading-tight mt-1">{p.name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-dim">
            {p.rating ? (
              <>
                <Stars rating={p.rating} />
                <span className="text-ink">{p.rating.toFixed(1)}</span>
                <span>({p.reviews} reviews)</span>
                <span className="text-faint">·</span>
              </>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Icon name="clock" className="size-3.5" />
              {p.hours}
            </span>
          </div>
        </div>
        <NetworkBadge p={p} />
      </div>

      {p.summary && (
        <div className="mt-4 rounded-2xl bg-white/[0.03] border border-line px-4 py-3">
          <div className="text-[11px] tracking-[0.14em] uppercase text-gold/90">What reviewers mention</div>
          <p className="text-[14px] mt-1.5 leading-relaxed">{p.summary}</p>
        </div>
      )}

      {p.highlights?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.highlights.map((h) => (
            <span key={h} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-dim">
              {h}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line px-4 py-3">
          <div className="text-[12px] text-dim">
            {p.network === "out" ? "If your plan covered it in network" : p.kind === "er" ? "Emergency visit today" : "A visit here today"}
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-serif text-3xl text-red leading-none">
              <Money value={cost.you} />
            </span>
            <span className="text-[12.5px] text-dim">
              you · <span className="text-blue">{usd(cost.plan)}</span> plan
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-line px-4 py-3 text-[13px] text-dim leading-snug">
          {p.network === "out"
            ? "Out of network, your plan may pay little or nothing and the clinic can bill you the difference. Call your plan first."
            : p.kind === "er"
              ? "For emergencies, federal law holds you to your in-network cost sharing even if this hospital is out of network."
              : uninsured
                ? "No insurance: ask for the self-pay price before they register you. It is often lower."
                : "Confirm with the office that they take your exact plan, not just the insurance company."}
        </div>
      </div>

      {p.open24 && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.address}`)}`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-2 min-h-10 px-4 rounded-full bg-ink text-paper text-[14px] hover:bg-white"
        >
          Directions
          <Icon name="arrow" className="size-4" />
        </a>
      )}
    </div>
  );
}

function NetworkBadge({ p }: { p: Provider }) {
  const look =
    p.network === "in"
      ? { cls: "border-good/40 bg-good/10 text-good", text: "In network", icon: "check" }
      : p.network === "out"
        ? { cls: "border-red/40 bg-red/10 text-red", text: "Out of network", icon: "close" }
        : { cls: "border-line-strong bg-white/[0.04] text-ink", text: p.kind === "er" ? "Emergency protected" : "Call to confirm", icon: "shield" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] ${look.cls}`}>
      <Icon name={look.icon} className="size-3.5" />
      {look.text}
    </span>
  );
}

/** A drawn map of Columbia: the roads people navigate by, and the places. */
function CareMap({
  places,
  shown,
  selected,
  onSelect,
}: {
  places: Provider[];
  shown: Provider[];
  selected: Provider;
  onSelect: (id: string) => void;
}) {
  const visible = new Set(shown.map((p) => p.id));
  const road = "var(--line-strong)";
  const label = { fill: "var(--faint)", fontSize: 15, fontFamily: "var(--font-sans)", letterSpacing: "0.08em" };
  const route = `M${HOME.x} ${HOME.y} Q ${(HOME.x + selected.x) / 2 + 40} ${(HOME.y + selected.y) / 2 - 60} ${selected.x} ${selected.y}`;

  return (
    <div className="relative">
      <svg viewBox="0 0 1000 680" className="block w-full h-auto" role="img" aria-label="Map of care near Columbia, Missouri">
        <defs>
          <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--line-strong)" />
          </pattern>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--mint)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--mint)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1000" height="680" fill="var(--surface)" />
        <rect width="1000" height="680" fill="url(#dots)" />
        <circle cx={HOME.x} cy={HOME.y} r="260" fill="url(#glow)" />

        {/* Parks and districts. */}
        <ellipse cx="712" cy="300" rx="62" ry="40" fill="var(--sage)" />
        <text x="668" y="304" {...label} fontSize={12}>STEPHENS LAKE</text>
        <rect x="470" y="368" width="128" height="80" rx="14" fill="var(--sage)" stroke="var(--line)" />
        <text x="488" y="414" {...label} fontSize={13}>MIZZOU</text>
        <rect x="400" y="292" width="92" height="50" rx="10" fill="var(--line)" />
        <text x="408" y="286" {...label} fontSize={12}>DOWNTOWN</text>

        {/* Creek. */}
        <path d="M860 0 C 780 90, 700 170, 650 250 S 560 420, 470 520 S 330 640, 250 680" stroke="var(--mint)" strokeWidth="4" fill="none" />
        <text x="598" y="490" {...label} fontSize={11} fill="var(--moss)">HINKSON CREEK</text>

        {/* Roads. */}
        <path d="M0 150 C 250 138, 520 162, 1000 140" stroke={road} strokeWidth="14" fill="none" />
        <text x="24" y="130" {...label}>I-70</text>
        <path d="M770 0 C 752 180, 790 360, 772 680" stroke={road} strokeWidth="11" fill="none" />
        <text x="792" y="628" {...label}>US 63</text>
        <path d="M0 222 C 300 214, 600 230, 1000 216" stroke="var(--line)" strokeWidth="6" fill="none" />
        <text x="24" y="206" {...label} fontSize={12}>BUSINESS LOOP 70</text>
        <path d="M60 332 L 1000 326" stroke="var(--line-strong)" strokeWidth="7" fill="none" />
        <text x="70" y="318" {...label} fontSize={12}>BROADWAY</text>
        <path d="M424 0 L 432 680" stroke="var(--line-strong)" strokeWidth="7" fill="none" />
        <text x="440" y="660" {...label} fontSize={12}>PROVIDENCE</text>
        <path d="M120 500 C 300 470, 520 452, 780 474" stroke="var(--line-strong)" strokeWidth="8" fill="none" />
        <text x="130" y="530" {...label} fontSize={12}>STADIUM BLVD</text>
        <path d="M560 600 C 640 560, 720 540, 800 520" stroke="var(--line)" strokeWidth="6" fill="none" />

        {/* Route to the selected place. */}
        <motion.path
          key={selected.id}
          d={route}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2.5"
          strokeDasharray="2 9"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* You. */}
        <motion.circle
          cx={HOME.x}
          cy={HOME.y}
          r={22}
          fill="var(--moss)"
          animate={{ scale: [0.5, 1.6], opacity: [0.6, 0] }}
          transition={{ duration: 2.2, repeat: Infinity }}
          style={{ transformOrigin: `${HOME.x}px ${HOME.y}px` }}
        />
        <circle cx={HOME.x} cy={HOME.y} r={8} fill="var(--ink)" stroke="var(--surface)" strokeWidth="3" />

        {/* Places. */}
        {places.map((p) => {
          const on = p.id === selected.id;
          const faded = !visible.has(p.id);
          const color = p.kind === "er" ? "var(--coral)" : p.network === "out" ? "var(--faint)" : "var(--moss)";
          return (
            <g
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{ cursor: "pointer" }}
              opacity={faded ? 0.18 : 1}
              role="button"
              aria-label={p.name}
            >
              {on && (
                <motion.circle
                  cx={p.x}
                  cy={p.y}
                  r={30}
                  fill={color}
                  initial={{ opacity: 0.4, scale: 0.4 }}
                  animate={{ opacity: [0.4, 0], scale: [0.4, 1.5] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                  style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                />
              )}
              <motion.circle
                cx={p.x}
                cy={p.y}
                fill={color}
                stroke="var(--surface)"
                strokeWidth={3}
                animate={{ r: on ? 13 : 8.5 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
              />
              {p.kind === "er" && (
                <path d={`M${p.x - 4} ${p.y}h8M${p.x} ${p.y - 4}v8`} stroke="var(--surface)" strokeWidth={2.2} strokeLinecap="round" />
              )}
            </g>
          );
        })}

        {/* Label for the selected place. */}
        <motion.g key={`label-${selected.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <rect
            x={Math.min(Math.max(selected.x - 120, 8), 752)}
            y={selected.y - 64}
            width={240}
            height={38}
            rx={19}
            fill="var(--surface)"
            stroke="var(--line-strong)"
          />
          <text
            x={Math.min(Math.max(selected.x, 128), 872)}
            y={selected.y - 39}
            textAnchor="middle"
            fill="var(--ink)"
            fontSize={16}
            fontFamily="var(--font-sans)"
          >
            {selected.name.length > 26 ? `${selected.name.slice(0, 25)}…` : selected.name}
          </text>
        </motion.g>
      </svg>
      <div className="absolute left-4 bottom-4 flex flex-wrap gap-3 text-[11.5px] text-dim bg-paper/70 backdrop-blur rounded-full px-3 py-1.5 border border-line">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-blue" />In network</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-dim" />Out of network</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-red" />Emergency</span>
      </div>
    </div>
  );
}
