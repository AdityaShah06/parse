"use client";

import { useEffect, useRef } from "react";

/**
 * A procedural blossom tree on a canvas. `bloom` (0 to 1) is how many of its
 * blossoms are still on the branches. Lower it and the difference lets go and
 * falls as petals, which settle in a drift at the foot of the trunk. Raise it
 * and blossoms grow back. At night the blossoms glow.
 *
 * Purely decorative: no number on screen is derived from it.
 */

type Node = {
  angle: number; // relative to parent
  length: number;
  width: number;
  depth: number;
  phase: number;
  children: Node[];
  blossoms: Blossom[];
};
type Blossom = { dx: number; dy: number; r: number; color: string; id: number; on: number };
type Petal = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; r: number; color: string; life: number; landed: boolean };

const DAY_PINKS = ["#f7c9d4", "#efa3b6", "#fbe4ea", "#f4b3c3", "#ffffff"];
const NIGHT_PINKS = ["#ffd3de", "#f5b6c7", "#ffe9ef", "#f0a0b7", "#fff6f8"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function grow(r: () => number, depth: number, length: number, width: number, all: Blossom[], night: boolean): Node {
  const node: Node = { angle: 0, length, width, depth, phase: r() * Math.PI * 2, children: [], blossoms: [] };
  if (depth >= 5) {
    const n = depth >= 7 ? 5 + Math.floor(r() * 5) : 2 + Math.floor(r() * 3);
    const pinks = night ? NIGHT_PINKS : DAY_PINKS;
    for (let i = 0; i < n; i++) {
      const b: Blossom = {
        dx: (r() - 0.5) * 26,
        dy: (r() - 0.5) * 22,
        r: 2.2 + r() * 3.6,
        color: pinks[Math.floor(r() * pinks.length)],
        id: all.length,
        on: 1,
      };
      node.blossoms.push(b);
      all.push(b);
    }
  }
  if (depth < 8) {
    const kids = depth < 2 ? 2 : r() < 0.3 ? 3 : 2;
    for (let i = 0; i < kids; i++) {
      const spread = (0.28 + r() * 0.34) * (i % 2 === 0 ? -1 : 1) + (kids === 3 && i === 2 ? 0 : 0);
      const child = grow(r, depth + 1, length * (0.7 + r() * 0.12), width * 0.68, all, night);
      child.angle = spread + (r() - 0.5) * 0.15;
      node.children.push(child);
    }
  }
  return node;
}

export default function BlossomTree({
  bloom = 1,
  night = false,
  seed = 7,
  className = "",
}: {
  bloom?: number;
  night?: boolean;
  seed?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bloomRef = useRef(bloom);
  const nightRef = useRef(night);
  bloomRef.current = Math.max(0, Math.min(1, bloom));
  nightRef.current = night;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const r = rng(seed);
    const blossoms: Blossom[] = [];
    const root = grow(r, 0, 1, 1, blossoms, nightRef.current);
    // Blossoms leave in a fixed, shuffled order so the same bloom always looks the same.
    const order = blossoms.map((b) => b.id).sort(() => r() - 0.5);
    const rank = new Map(order.map((id, i) => [id, i]));
    const petals: Petal[] = [];
    const tips = new Map<number, { x: number; y: number }>();

    let w = 0;
    let h = 0;
    const resize = () => {
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(c);

    let raf = 0;
    let t = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduce) t += dt;
      raf = requestAnimationFrame(draw);
      if (!visible || w === 0) return;

      const isNight = nightRef.current;
      const target = Math.round(blossoms.length * bloomRef.current);
      ctx.clearRect(0, 0, w, h);

      const scale = Math.min(w * 0.19, h * 0.21);
      const baseX = w * 0.5;
      const baseY = h * 0.93;

      // Ground shadow.
      ctx.fillStyle = isNight ? "rgba(0,0,0,0.35)" : "rgba(17,40,29,0.08)";
      ctx.beginPath();
      ctx.ellipse(baseX, baseY + 4, w * 0.3, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      const bark = isNight ? "#1c2a23" : "#4a3a31";
      const walk = (n: Node, x: number, y: number, ang: number) => {
        const sway = reduce ? 0 : Math.sin(t * 0.9 + n.phase) * 0.012 * n.depth;
        const a = ang + n.angle + sway;
        const len = n.length * scale;
        const x2 = x + Math.cos(a) * len;
        const y2 = y + Math.sin(a) * len;
        ctx.strokeStyle = bark;
        ctx.lineWidth = Math.max(0.8, n.width * scale * 0.16);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
        const cx = (x + x2) / 2 + Math.sin(n.phase) * len * 0.12;
        const cy = (y + y2) / 2;
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
        for (const b of n.blossoms) tips.set(b.id, { x: x2 + b.dx * (scale / 110), y: y2 + b.dy * (scale / 110) });
        for (const k of n.children) walk(k, x2, y2, a);
      };
      walk(root, baseX, baseY, -Math.PI / 2);

      // Blossoms: detach or regrow toward the target count.
      if (isNight) {
        ctx.shadowColor = "rgba(245,182,199,0.9)";
        ctx.shadowBlur = 10;
      }
      for (const b of blossoms) {
        const keep = rank.get(b.id)! < target;
        const p = tips.get(b.id);
        if (!p) continue;
        if (!keep && b.on > 0.5) {
          b.on = 0;
          petals.push({
            x: p.x,
            y: p.y,
            vx: (Math.random() - 0.3) * 40,
            vy: -10 + Math.random() * 10,
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 4,
            r: b.r,
            color: b.color,
            life: 1,
            landed: false,
          });
        } else if (keep && b.on < 1) {
          b.on = Math.min(1, b.on + dt * 1.5);
        }
        if (b.on <= 0) continue;
        ctx.globalAlpha = b.on * (isNight ? 0.95 : 0.9);
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, b.r * (scale / 110) * (0.6 + 0.4 * b.on), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // An occasional petal drifts off even when nothing happened: the tree is alive.
      if (!reduce && Math.random() < dt * 0.6 && target > 0) {
        const id = order[Math.floor(Math.random() * target)];
        const p = tips.get(id);
        const b = blossoms[id];
        if (p && b) petals.push({ x: p.x, y: p.y, vx: 8 + Math.random() * 12, vy: 0, rot: 0, vr: 1.5, r: b.r * 0.7, color: b.color, life: 1, landed: false });
      }

      // Falling and fallen petals.
      const ground = baseY + 2;
      for (let i = petals.length - 1; i >= 0; i--) {
        const q = petals[i];
        if (!q.landed) {
          q.vy += 150 * dt;
          q.vy = Math.min(q.vy, 190);
          q.vx += Math.sin(t * 2 + i) * 14 * dt;
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.rot += q.vr * dt;
          if (q.y >= ground - Math.random() * 8) {
            q.landed = true;
            q.y = ground - Math.random() * 7;
          }
        } else {
          q.life -= dt * 0.02;
        }
        if (q.life <= 0 || q.x < -20 || q.x > w + 20) {
          petals.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.globalAlpha = Math.max(0, q.life) * 0.95;
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, q.r * (scale / 110) * 1.1, q.r * (scale / 110) * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (petals.length > 900) petals.splice(0, petals.length - 900);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [seed]);

  return <canvas ref={canvas} className={`block w-full h-full ${className}`} aria-hidden />;
}
