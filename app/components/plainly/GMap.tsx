"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A real Google Map (Google's terms require Places results to be shown on
 * one). Loaded with a plain script tag, no npm package. The browser key is
 * NEXT_PUBLIC_GOOGLE_MAPS_KEY: restrict it in Cloud Console to the Maps
 * JavaScript API and to your own domains.
 *
 * Styled to match the theme, markers colored by network status.
 */

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";

export type Pin = { id: string; lat: number; lng: number; label: string; tone: "in" | "out" | "unknown"; selected?: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    __plainlyMaps?: Promise<void>;
  }
}

function loadMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject();
  if (window.google?.maps?.Map) return Promise.resolve();
  if (!window.__plainlyMaps) {
    window.__plainlyMaps = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("maps"));
      document.head.appendChild(s);
    });
  }
  return window.__plainlyMaps;
}

const DAY = [
  { elementType: "geometry", stylers: [{ color: "#f1ede3" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5f6f66" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f1e8" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e2ecdf" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfe3ea" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#e6eedf" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];
const NIGHT = [
  { elementType: "geometry", stylers: [{ color: "#0f1a15" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8fa398" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1310" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1b2a23" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#24372e" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1c22" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

const TONE = { in: "#1e7a4e", out: "#e2603d", unknown: "#93a097" };

function pinSvg(tone: Pin["tone"], selected: boolean) {
  const c = TONE[tone];
  const s = selected ? 44 : 34;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}' viewBox='0 0 40 40'><circle cx='20' cy='20' r='${selected ? 17 : 14}' fill='${c}' fill-opacity='0.18'/><circle cx='20' cy='20' r='${selected ? 9 : 7}' fill='${c}' stroke='white' stroke-width='3'/></svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, size: s };
}

export default function GMap({
  center,
  pins,
  night,
  onSelect,
  className = "",
}: {
  center: { lat: number; lng: number } | null;
  pins: Pin[];
  night: boolean;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [failed, setFailed] = useState(!MAPS_KEY);

  useEffect(() => {
    if (!MAPS_KEY) return;
    let alive = true;
    loadMaps()
      .then(() => {
        if (!alive || !el.current || map.current) return;
        const g = window.google.maps;
        map.current = new g.Map(el.current, {
          center: center ?? { lat: 38.9517, lng: -92.3341 },
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          styles: night ? NIGHT : DAY,
          backgroundColor: night ? "#0b1310" : "#f5f1e8",
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setOptions({ styles: night ? NIGHT : DAY, backgroundColor: night ? "#0b1310" : "#f5f1e8" });
  }, [night]);

  useEffect(() => {
    const g = window.google?.maps;
    if (!g || !map.current) return;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = pins.map((p) => {
      const icon = pinSvg(p.tone, !!p.selected);
      const m = new g.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: map.current,
        title: p.label,
        icon: { url: icon.url, scaledSize: new g.Size(icon.size, icon.size), anchor: new g.Point(icon.size / 2, icon.size / 2) },
        zIndex: p.selected ? 10 : 1,
      });
      m.addListener("click", () => onSelect(p.id));
      return m;
    });
    if (pins.length) {
      const b = new g.LatLngBounds();
      pins.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
      if (center) b.extend(center);
      map.current.fitBounds(b, 48);
    } else if (center) map.current.setCenter(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, center]);

  if (failed) {
    return (
      <div className={`grid place-items-center text-center text-dim text-[14px] p-6 ${className}`}>
        <p className="max-w-xs">The map needs a Google Maps browser key. Results are listed alongside.</p>
      </div>
    );
  }
  return <div ref={el} className={className} />;
}
