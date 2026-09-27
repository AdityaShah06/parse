import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { incr } from "./shared-store";

/**
 * Per-visitor limits for the routes that spend money (Gemini, ElevenLabs,
 * Google Places, CMS). The daily budgets in server-cache cap the whole app;
 * these stop one visitor, or one bot, from using the whole day in a minute.
 *
 * Counted in the shared store when one is connected, so limits hold across
 * Vercel instances; otherwise in this instance's memory, which still stops a
 * runaway loop. Visitors are a hash of the IP, never the IP itself.
 */

export type Limit = { perMinute: number; perDay: number };

/** Defaults per route group. Override any with RATE_<NAME>_MIN / RATE_<NAME>_DAY. */
export const LIMITS = {
  agent: { perMinute: 8, perDay: 80 },
  speak: { perMinute: 20, perDay: 150 },
  decode: { perMinute: 4, perDay: 20 },
  explain: { perMinute: 20, perDay: 200 },
  places: { perMinute: 20, perDay: 150 },
  lookup: { perMinute: 60, perDay: 600 },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

function visitor(req: Request): string {
  const h = req.headers;
  const ip = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const local = new Map<string, { n: number; until: number }>();

function bumpLocal(key: string, ttlMs: number): number {
  const now = Date.now();
  if (local.size > 5000) for (const [k, v] of local) if (v.until < now) local.delete(k);
  const row = local.get(key);
  if (!row || row.until < now) {
    local.set(key, { n: 1, until: now + ttlMs });
    return 1;
  }
  row.n += 1;
  return row.n;
}

async function bump(key: string, ttlSeconds: number): Promise<number> {
  return (await incr(key, 1, ttlSeconds)) ?? bumpLocal(key, ttlSeconds * 1000);
}

/**
 * Count one request. Returns a 429 response to send back when the visitor is
 * over a limit, or null to carry on.
 */
export async function rateLimit(req: Request, name: LimitName): Promise<NextResponse | null> {
  const upper = name.toUpperCase();
  const perMinute = envInt(`RATE_${upper}_MIN`, LIMITS[name].perMinute);
  const perDay = envInt(`RATE_${upper}_DAY`, LIMITS[name].perDay);
  const who = visitor(req);
  const minute = Math.floor(Date.now() / 60_000);
  const day = new Date().toISOString().slice(0, 10);

  const [m, d] = await Promise.all([bump(`rl:${name}:${who}:m${minute}`, 120), bump(`rl:${name}:${who}:${day}`, 2 * 86_400)]);
  if (m <= perMinute && d <= perDay) return null;

  const retry = m > perMinute ? 60 - (Math.floor(Date.now() / 1000) % 60) : 3600;
  return NextResponse.json(
    { ok: false, code: "rate_limited", error: m > perMinute ? "Slow down a little. Try again in a minute." : "That's today's limit for this feature." },
    { status: 429, headers: { "retry-after": String(retry) } }
  );
}
