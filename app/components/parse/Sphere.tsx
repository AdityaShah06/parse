"use client";

import { GrainGradient } from "@paper-design/shaders-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { onLevel } from "./voice";

export type Mood = "calm" | "happy" | "thinking" | "worried" | "sad" | "shocked";

/**
 * The single line that is the sphere's whole face. Every path has the same
 * command structure so framer-motion can morph between them.
 */
const FACE: Record<Mood, string> = {
  calm: "M 30 56 C 40 56, 60 56, 70 56",
  happy: "M 30 54 C 40 62, 60 62, 70 54",
  thinking: "M 32 56 C 42 53, 58 59, 68 56",
  worried: "M 30 58 C 40 53, 60 61, 70 55",
  sad: "M 30 60 C 40 52, 60 52, 70 60",
  shocked: "M 40 56 C 45 50, 55 50, 60 56",
};

/**
 * The guide. A film-grain WebGL sphere (Paper shaders) with one drawn line
 * for a face. Deadpan by design: the line barely moves until money does.
 */
export default function Sphere({
  size = 240,
  mood = "calm",
  night = false,
  className = "",
}: {
  size?: number;
  mood?: Mood;
  night?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  // WebGL only after mount, so server HTML and first paint stay light.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Freeze the shader while the sphere is off screen: no frames, no GPU work.
  const box = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // While the guide talks, the line becomes a mouth that moves with the audio.
  // Written straight to the DOM: no React render per frame.
  const talk = useRef<SVGPathElement>(null);
  const still = useRef<SVGGElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let smooth = 0;
    return onLevel((level) => {
      // A hard zero means the line finished: close the mouth at once.
      smooth = level === 0 ? 0 : smooth * 0.55 + level * 0.45;
      const open = smooth > 0.03;
      const dip = 56 + 2 + smooth * 13;
      const lift = 56 - smooth * 3;
      talk.current?.setAttribute("d", `M 34 ${lift} C 42 ${dip}, 58 ${dip}, 66 ${lift}`);
      if (talk.current) talk.current.style.opacity = open ? "0.85" : "0";
      if (still.current) still.current.style.opacity = open ? "0" : "1";
      if (body.current) body.current.style.transform = `scale(${1 + smooth * 0.035})`;
    });
  }, []);

  const colors = night
    ? ["#1f6b4a", "#f5b6c7", "#7fe0ab", "#0d2a1f"]
    : ["#155c3a", "#8fdcb4", "#f6e6bd", "#2e8f5d"];
  const speed = reduce || !onScreen ? 0 : mood === "thinking" ? 2.4 : mood === "shocked" || mood === "sad" ? 1.6 : 0.8;
  const stroke = night ? "#0b1310" : "#0e2419";

  return (
    <div ref={box} className={`relative select-none ${className}`} style={{ width: size, height: size }} aria-hidden>
      {/* Glow on the floor and around the body. */}
      <div
        className="absolute inset-[-18%] rounded-full blur-3xl opacity-60 pointer-events-none transform-gpu"
        style={{ background: night ? "radial-gradient(circle, rgb(127 224 171 / 0.35), rgb(245 182 199 / 0.18) 45%, transparent 70%)" : "radial-gradient(circle, rgb(143 220 180 / 0.55), rgb(243 227 184 / 0.35) 45%, transparent 70%)" }}
      />
      <div ref={body} className="absolute inset-0 transition-transform duration-75 will-change-transform">
      <div
        className={`absolute inset-0 rounded-full overflow-hidden will-change-transform ${reduce ? "" : "sphere-breathe"}`}
        style={{ boxShadow: night ? "inset 0 -20px 40px rgb(0 0 0 / 0.35), 0 30px 60px -20px rgb(0 0 0 / 0.6)" : "inset 0 -18px 36px rgb(17 40 29 / 0.18), 0 30px 60px -24px rgb(17 40 29 / 0.35)" }}
      >
        {ready ? (
          <GrainGradient
            style={{ width: "100%", height: "100%" }}
            colorBack={night ? "#0b1310" : "#dcebdd"}
            colors={colors}
            softness={0.8}
            intensity={0.35}
            noise={0.28}
            shape="sphere"
            speed={speed}
            scale={1.02}
            minPixelRatio={2}
            webGlContextAttributes={{ powerPreference: "high-performance", antialias: true }}
          />
        ) : (
          <div className="w-full h-full" style={{ background: "radial-gradient(circle at 35% 30%, #cfe8d6, #1e7a4e 70%)" }} />
        )}
        {/* Specular highlight, the thing that makes it read as glass. */}
        <div className="absolute left-[18%] top-[12%] w-[38%] h-[26%] rounded-full bg-white/50 blur-xl transform-gpu" />
      </div>
      </div>
      {/* The face, on its own layer so the moving sphere never repaints it. */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full will-change-transform" style={{ transform: "translateZ(0)" }}>
        <path ref={talk} d="M 34 56 C 42 58, 58 58, 66 56" fill="none" stroke={stroke} strokeWidth={2.2} strokeLinecap="round" style={{ opacity: 0 }} />
        <g ref={still}>
        <motion.path
          d={FACE[mood]}
          initial={{ d: FACE[mood] }}
          animate={{ d: FACE[mood] }}
          transition={{ type: "spring", duration: 0.6, bounce: 0.2 }}
          fill="none"
          stroke={stroke}
          strokeWidth={2.2}
          strokeLinecap="round"
          opacity={0.82}
        />
        </g>
      </svg>
    </div>
  );
}
