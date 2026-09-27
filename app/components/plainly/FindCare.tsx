"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { CareEvent } from "@/lib/engine";
import type { MyPlan } from "@/lib/my-plan";
import type { CareCategory } from "@/lib/benefits";
import type { PriceKey } from "@/lib/prices";
import { visitCost, visitDate } from "@/lib/care";
import { usd } from "@/lib/catalog";
import Sphere from "./Sphere";
import Kinetic from "./Kinetic";
import GMap, { MAPS_KEY, type Pin } from "./GMap";
import { useTheme } from "./theme";
import { Icon } from "../ui";

type Place = {
  id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number };
  rating: number | null;
  ratingCount: number | null;
  openNow: boolean | null;
  phone: string | null;
  website: string | null;
  mapsUri: string | null;
  distanceMiles: number | null;
  reviewSummary?: { text: string; disclosure: string; reviewsUri: string | null; flagUri: string | null };
};
type Coverage = "Covered" | "NotCovered" | "DataNotProvided" | "GenericCovered" | "NoMatch";
type Net = { coverage: Coverage; npi?: string; matchedName?: string; confidence?: number };
type DirProvider = { npi: string; name: string; addressText: string; specialties: string[]; distance: number | null; coverage: Coverage | null; accepting: string | null };

const CATS: { key: CareCategory; label: string; price: PriceKey; dirQuery: string; dirType: "Individual" | "Facility" }[] = [
  { key: "primary", label: "Primary care", price: "sickVisit", dirQuery: "family medicine", dirType: "Individual" },
  { key: "urgent", label: "Urgent care", price: "urgentCare", dirQuery: "urgent care", dirType: "Facility" },
  { key: "mental", label: "Therapy", price: "therapy", dirQuery: "counselor", dirType: "Individual" },
  { key: "orthopedics", label: "Specialists", price: "specialist", dirQuery: "orthopedic", dirType: "Individual" },
  { key: "imaging", label: "Imaging", price: "mri", dirQuery: "imaging", dirType: "Facility" },
  { key: "lab", label: "Labs", price: "labs", dirQuery: "laboratory", dirType: "Facility" },
  { key: "er", label: "Emergency", price: "er", dirQuery: "hospital", dirType: "Facility" },
];

const EASE = [0.23, 1, 0.32, 1] as const;

/**
 * Room: find care for a benefit. Google supplies the places, ratings and its
 * own Gemini review summary; CMS's provider directory says whether each one
 * is in your plan's network; the engine says what a visit costs you there.
 */
export default function FindCare({ my, events, zip: initialZip, category: initialCat }: { my: MyPlan; events: CareEvent[]; zip: string; category: CareCategory | null }) {
  const [theme] = useTheme();
  const night = theme === "night";
  const [cat, setCat] = useState<CareCategory>(initialCat ?? "primary");
  const [zip, setZip] = useState(initialZip);
  const [zipDraft, setZipDraft] = useState(initialZip);
  const [places, setPlaces] = useState<Place[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [net, setNet] = useState<Record<string, Net>>({});
  const [dir, setDir] = useState<DirProvider[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "no_key" | "budget" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [netState, setNetState] = useState<"idle" | "checking" | "done" | "unavailable">("idle");

  const conf = CATS.find((c) => c.key === cat)!;
  const cost = useMemo(() => visitCost(my.plan, events, conf.price, visitDate(), { preventiveIsFree: my.kind !== "uninsured" }), [my.plan, events, conf.price, my.kind]);
  const canCheck = !!my.hiosId;

  useEffect(() => {
    if (initialCat) setCat(initialCat);
  }, [initialCat]);

  // Google places for this benefit near the ZIP.
  useEffect(() => {
    let alive = true;
    setState("loading");
    setPlaces([]);
    setNet({});
    setDir(null);
    setSelected(null);
    fetch(`/api/places?category=${cat}&zip=${zip}&detail=full`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok) {
          setPlaces(j.places ?? []);
          setCenter(j.center ?? null);
          setState("ok");
        } else setState(j.code === "no_key" ? "no_key" : j.code === "budget" ? "budget" : "error");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [cat, zip]);

  // Network status from the CMS directory, once places arrive.
  useEffect(() => {
    if (!canCheck || state !== "ok" || places.length === 0) return;
    let alive = true;
    setNetState("checking");
    fetch("/api/network", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: my.hiosId, zip, places: places.slice(0, 12).map((p) => ({ id: p.id, name: p.name, address: p.address })) }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok) {
          setNet(Object.fromEntries((j.results as (Net & { id: string })[]).map((r) => [r.id, r])));
          setNetState("done");
        } else setNetState("unavailable");
      })
      .catch(() => alive && setNetState("unavailable"));
    return () => {
      alive = false;
    };
  }, [places, state, canCheck, my.hiosId, zip]);

  // No Google key: fall back to the CMS directory itself (real providers, real network status, no ratings).
  useEffect(() => {
    if (state !== "no_key" && state !== "budget") return;
    let alive = true;
    fetch(`/api/network?zip=${zip}&q=${encodeURIComponent(conf.dirQuery)}&type=${conf.dirType}${my.hiosId ? `&planId=${my.hiosId}` : ""}`)
      .then((r) => r.json())
      .then((j) => alive && setDir(j.ok ? j.providers : []))
      .catch(() => alive && setDir([]));
    return () => {
      alive = false;
    };
  }, [state, zip, conf.dirQuery, conf.dirType, my.hiosId]);

  const ranked = useMemo(() => {
    const rank = (p: Place) => {
      const c = net[p.id]?.coverage;
      const inNet = c === "Covered" ? 2 : c === "NotCovered" ? -2 : 0;
      const quality = p.rating ? p.rating * Math.log10((p.ratingCount ?? 0) + 10) : 0;
      return inNet * 10 + quality - (p.distanceMiles ?? 5) * 0.3;
    };
    return [...places].sort((a, b) => rank(b) - rank(a));
  }, [places, net]);

  const pins: Pin[] = ranked.map((p) => {
    const c = net[p.id]?.coverage;
    return { id: p.id, lat: p.location.lat, lng: p.location.lng, label: p.name, tone: c === "Covered" ? "in" : c === "NotCovered" ? "out" : "unknown", selected: p.id === selected };
  });

  const inCount = Object.values(net).filter((n) => n.coverage === "Covered").length;
  const lines =
    state === "loading"
      ? [`Looking for ${conf.label.toLowerCase()} near ${zip}.`]
      : state !== "ok"
        ? ["Straight from the federal provider directory.", canCheck ? "Each one checked against your plan's network." : "Real providers near you. Confirm your network by phone."]
        : canCheck
        ? netState === "done"
          ? [`${inCount} of these take your plan, per the federal directory.`, `A visit costs you about ${usd(cost.you)} on your plan.`]
          : ["Checking each one against your plan's network.", "That's the part nobody else does."]
        : ["Here's who's nearby, and who reviews them kindly.", "Your plan's network isn't public, so confirm by phone before you go."];

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-5">
        <Sphere size={92} mood={state === "loading" || netState === "checking" ? "thinking" : "calm"} night={night} className="shrink-0 max-sm:!w-16 max-sm:!h-16" />
        <div className="min-w-0 pt-1">
          <Kinetic key={lines.join("|")} lines={lines} size="lg" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CATS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCat(c.key)}
            className={`relative rounded-full h-10 px-4 text-[14px] border transition-colors ${cat === c.key ? "border-transparent text-paper" : "border-line text-dim hover:text-ink"}`}
          >
            {cat === c.key && <motion.span layoutId="care-cat" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", duration: 0.4, bounce: 0 }} />}
            <span className="relative">{c.label}</span>
          </button>
        ))}
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{5}$/.test(zipDraft)) setZip(zipDraft);
          }}
        >
          <label className="text-[13px] text-faint" htmlFor="zip">
            ZIP
          </label>
          <input id="zip" value={zipDraft} onChange={(e) => setZipDraft(e.target.value.replace(/\D/g, "").slice(0, 5))} className="w-[88px] h-10 rounded-full border border-line bg-surface px-4 font-mono text-[14px]" inputMode="numeric" />
        </form>
      </div>

      {cat === "er" && (
        <div className="rounded-[18px] border border-coral/40 bg-coral/10 px-5 py-3 text-[14px]">
          If you think it is an emergency, call 911 or go to the nearest ER. Cost questions can wait.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
        <div className="card p-0 overflow-hidden xl:sticky xl:top-6">
          {state === "ok" && MAPS_KEY ? (
            <GMap center={center} pins={pins} night={night} onSelect={setSelected} className="h-[460px] w-full" />
          ) : (
            <div className="h-[460px] grid place-items-center text-center p-8">
              <div className="max-w-sm">
                <div className="font-serif text-[1.6rem] leading-tight">{state === "loading" ? "Finding places..." : state === "ok" ? "Map key missing" : "Google isn't connected yet"}</div>
                <p className="text-dim text-[14px] mt-2">
                  {state === "ok"
                    ? "Add NEXT_PUBLIC_GOOGLE_MAPS_KEY to show these on a Google map."
                    : state === "loading"
                      ? ""
                      : "Showing providers straight from the federal directory instead: real names and network status, no ratings."}
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-line text-[12.5px]">
            <div className="flex items-center gap-4">
              <Legend tone="in" text="In network" />
              <Legend tone="out" text="Not in network" />
              <Legend tone="unknown" text="Not confirmed" />
            </div>
            <div className="text-faint">
              Your cost, one visit: <span className="font-mono text-ink">{usd(cost.you)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {state === "loading" &&
            [0, 1, 2].map((i) => <motion.div key={i} className="card-quiet h-[132px]" animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }} />)}

          {state === "ok" && (
            <>
              {ranked.map((p, i) => (
                <PlaceCard key={p.id} p={p} i={i} net={net[p.id]} checking={netState === "checking"} canCheck={canCheck} selected={selected === p.id} onSelect={() => setSelected(p.id)} you={cost.you} />
              ))}
              <div className="text-[11.5px] text-faint leading-relaxed pt-1">
                Places and review summaries: Google Maps. Network status: CMS Marketplace provider directory, built from each insurer&rsquo;s own filings; it can lag, so confirm when you book. Cost: your plan&rsquo;s rules applied to a typical price.
              </div>
            </>
          )}

          {(state === "no_key" || state === "budget" || state === "error") && (
            <DirectoryList providers={dir} canCheck={canCheck} you={cost.you} />
          )}

          {!canCheck && my.memberPhone && (
            <div className="card-quiet p-4 text-[14px]">
              To confirm a place takes your plan, call member services at <a className="font-mono underline" href={`tel:${my.memberPhone.replace(/\D/g, "")}`}>{my.memberPhone}</a>.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Legend({ tone, text }: { tone: "in" | "out" | "unknown"; text: string }) {
  const c = tone === "in" ? "bg-moss" : tone === "out" ? "bg-coral" : "bg-faint";
  return (
    <span className="inline-flex items-center gap-1.5 text-dim">
      <span className={`size-2 rounded-full ${c}`} />
      {text}
    </span>
  );
}

function NetBadge({ net, checking, canCheck }: { net?: Net; checking: boolean; canCheck: boolean }) {
  if (!canCheck) return <span className="rounded-full border border-line text-faint text-[11.5px] px-2.5 py-1">Network: call to confirm</span>;
  if (checking && !net) return <span className="rounded-full border border-line text-faint text-[11.5px] px-2.5 py-1 animate-pulse">Checking network</span>;
  const c = net?.coverage;
  if (c === "Covered") return <span className="rounded-full bg-sage text-moss text-[11.5px] px-2.5 py-1">In your network</span>;
  if (c === "NotCovered") return <span className="rounded-full bg-coral/15 text-coral text-[11.5px] px-2.5 py-1">Not in your network</span>;
  if (c === "NoMatch") return <span className="rounded-full border border-line text-faint text-[11.5px] px-2.5 py-1">Not in the directory</span>;
  return <span className="rounded-full border border-line text-faint text-[11.5px] px-2.5 py-1">Insurer didn&rsquo;t say</span>;
}

function Stars({ rating, count }: { rating: number | null; count: number | null }) {
  if (rating === null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span className="text-gold">{"★".repeat(Math.round(rating))}</span>
      <span className="font-mono">{rating.toFixed(1)}</span>
      {count !== null && <span className="text-faint">({count.toLocaleString()})</span>}
    </span>
  );
}

function PlaceCard({ p, i, net, checking, canCheck, selected, onSelect, you }: { p: Place; i: number; net?: Net; checking: boolean; canCheck: boolean; selected: boolean; onSelect: () => void; you: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: i * 0.04, ease: EASE }}
      onClick={onSelect}
      className={`card-quiet p-5 cursor-pointer transition-colors ${selected ? "ring-2 ring-moss/50" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-medium">{p.name}</div>
          <div className="text-[12.5px] text-faint mt-0.5 truncate">
            {p.address}
            {p.distanceMiles !== null ? ` · ${p.distanceMiles.toFixed(1)} mi` : ""}
          </div>
        </div>
        <NetBadge net={net} checking={checking} canCheck={canCheck} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Stars rating={p.rating} count={p.ratingCount} />
        {p.openNow !== null && <span className={`text-[12.5px] ${p.openNow ? "text-moss" : "text-faint"}`}>{p.openNow ? "Open now" : "Closed now"}</span>}
        <span className="text-[12.5px] text-dim">
          {net?.coverage === "NotCovered" ? (
            <>Out of network: likely the full bill</>
          ) : (
            <>
              You pay about <span className="font-mono text-ink">{usd(you)}</span>
            </>
          )}
        </span>
      </div>
      {p.reviewSummary && (
        <div className="mt-3 text-[13.5px] leading-snug">
          <p>{p.reviewSummary.text}</p>
          <div className="mt-1.5 text-[11px] text-faint">
            {p.reviewSummary.disclosure}
            {p.reviewSummary.reviewsUri && (
              <>
                {" · "}
                <a href={p.reviewSummary.reviewsUri} target="_blank" rel="noreferrer" className="underline">
                  Reviews on Google Maps
                </a>
              </>
            )}
          </div>
        </div>
      )}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="pt-4 flex flex-wrap gap-2">
              {p.phone && (
                <a href={`tel:${p.phone.replace(/\D/g, "")}`} className="rounded-full bg-ink text-paper h-9 px-4 text-[13px] inline-flex items-center gap-2">
                  <Icon name="phone" className="size-3.5" /> {p.phone}
                </a>
              )}
              {p.mapsUri && (
                <a href={p.mapsUri} target="_blank" rel="noreferrer" className="rounded-full border border-line h-9 px-4 text-[13px] inline-flex items-center">
                  Directions
                </a>
              )}
              {p.website && (
                <a href={p.website} target="_blank" rel="noreferrer" className="rounded-full border border-line h-9 px-4 text-[13px] inline-flex items-center">
                  Website
                </a>
              )}
            </div>
            {net?.matchedName && (
              <div className="text-[11.5px] text-faint mt-3">
                Matched to {net.matchedName} (NPI {net.npi}) in the federal directory.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DirectoryList({ providers, canCheck, you }: { providers: DirProvider[] | null; canCheck: boolean; you: number }) {
  if (providers === null) return <div className="card-quiet h-[132px] animate-pulse" />;
  if (providers.length === 0) return <div className="card-quiet p-5 text-[14px] text-dim">No providers found in the federal directory for this search. Try another ZIP.</div>;
  return (
    <>
      {providers.map((p, i) => (
        <motion.div key={p.npi} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: i * 0.03, ease: EASE }} className="card-quiet p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[16px] font-medium capitalize">{p.name.toLowerCase()}</div>
              <div className="text-[12.5px] text-faint mt-0.5">
                {p.addressText}
                {p.distance !== null ? ` · ${p.distance.toFixed(1)} mi` : ""}
              </div>
              {p.specialties.length > 0 && <div className="text-[12.5px] text-dim mt-1">{p.specialties.slice(0, 2).join(", ")}</div>}
            </div>
            <NetBadge net={p.coverage ? { coverage: p.coverage } : undefined} checking={false} canCheck={canCheck} />
          </div>
          <div className="mt-2 text-[12.5px] text-dim">
            You pay about <span className="font-mono text-ink">{usd(you)}</span> in network{p.accepting ? ` · ${p.accepting}` : ""}
          </div>
        </motion.div>
      ))}
      <div className="text-[11.5px] text-faint">Source: CMS Marketplace provider directory. NPI {"= "}National Provider Identifier.</div>
    </>
  );
}
