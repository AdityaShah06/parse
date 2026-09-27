"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

export type Theme = "day" | "night";

/** Current theme, read from <html data-theme>, kept in sync across components. */
export function useTheme(): [Theme, (t: Theme, from?: { x: number; y: number }) => void] {
  const [theme, set] = useState<Theme>("day");
  useEffect(() => {
    const el = document.documentElement;
    const read = () => set((el.dataset.theme as Theme) === "night" ? "night" : "day");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return [theme, setTheme];
}

/**
 * Switch theme with a circle that grows from the point you clicked (or the
 * center). Uses the View Transitions API where it exists; elsewhere the colors
 * simply cross-fade.
 */
export function setTheme(t: Theme, from?: { x: number; y: number }) {
  const el = document.documentElement;
  if (el.dataset.theme === t) return;
  const apply = () => {
    el.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", t === "night" ? "#0b1310" : "#f5f1e8");
  };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || reduce) return apply();
  el.style.setProperty("--vt-x", `${from?.x ?? window.innerWidth / 2}px`);
  el.style.setProperty("--vt-y", `${from?.y ?? window.innerHeight / 2}px`);
  doc.startViewTransition(() => flushSync(apply));
}
