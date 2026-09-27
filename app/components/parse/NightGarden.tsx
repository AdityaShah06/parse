"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import BlossomTree from "./BlossomTree";

/**
 * The night theme's world: a slow, dark, living gradient in forest greens
 * and plum, and a blossom tree glowing in the corner, shedding petals.
 */
export default function NightGarden({ tree = true }: { tree?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <motion.div
      aria-hidden
      className="fixed inset-0 z-0 pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.2 }}
    >
      {ready && (
        <MeshGradient
          style={{ width: "100%", height: "100%", opacity: 0.55 }}
          colors={["#07120e", "#0f2a20", "#1b1726", "#0b1b16", "#2a1c2a"]}
          distortion={0.8}
          swirl={0.35}
          speed={0.12}
          minPixelRatio={2}
          webGlContextAttributes={{ powerPreference: "high-performance", antialias: true }}
        />
      )}
      <div className="absolute inset-0" style={{ background: "radial-gradient(80% 60% at 50% 0%, transparent, rgb(7 14 11 / 0.6))" }} />
      {tree && (
      <div className="absolute right-[-4%] bottom-0 w-[46vw] max-w-[720px] h-[80vh] opacity-60">
        <BlossomTree bloom={0.85} night seed={11} />
      </div>
      )}
    </motion.div>
  );
}
