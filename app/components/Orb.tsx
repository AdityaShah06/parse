"use client";

import { motion } from "framer-motion";

/**
 * The concierge's face: a small X-ray light box. Three rings breathe slowly;
 * while the concierge is "thinking" they ripple outward faster.
 */
export default function Orb({ thinking = false, size = 44 }: { thinking?: boolean; size?: number }) {
  const dur = thinking ? 1.1 : 3.2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute inset-0 rounded-full border border-blue/50"
          initial={{ scale: 0.55, opacity: 0.9 }}
          animate={{ scale: [0.55, 1.05], opacity: [0.9, 0] }}
          transition={{ duration: dur, repeat: Infinity, delay: (i * dur) / 3, ease: "easeOut" }}
        />
      ))}
      <motion.span
        className="absolute rounded-full bg-blue"
        style={{ inset: size * 0.3 }}
        animate={{ scale: thinking ? [1, 0.82, 1] : [1, 0.94, 1] }}
        transition={{ duration: thinking ? 0.6 : 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <span
        className="absolute rounded-full bg-surface/80"
        style={{ width: size * 0.12, height: size * 0.12, left: size * 0.4, top: size * 0.36 }}
      />
    </div>
  );
}
