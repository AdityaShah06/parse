"use client";

import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { usd } from "@/lib/catalog";

/**
 * A dollar figure that rolls to its new value. The value it lands on is the
 * engine's number; the frames in between are only the animation.
 */
export default function Money({ value, className = "" }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(mv, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
    });
    return () => controls.stop();
  }, [value, reduce, mv]);

  return (
    <span className={`tabular ${className}`} aria-label={usd(value)}>
      <span aria-hidden>{usd(shown)}</span>
    </span>
  );
}
