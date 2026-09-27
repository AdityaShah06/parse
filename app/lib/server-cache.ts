/**
 * Server-side caching and spend guards for every paid or rate-limited API
 * (Google Places, ElevenLabs, CMS Marketplace, RxNav, Cost Plus, NADAC).
 *
 * Two layers:
 *  - memory: instant, lives as long as the server process
 *  - disk: survives restarts, so rehearsing the demo never pays twice.
 *    Written to .cache/ in the app folder (gitignored). On read-only hosts
 *    (Vercel functions) it falls back to the OS temp dir, and if that fails
 *    too, memory only. Caching is best effort and never throws.
 *
 * Budgets are daily counters persisted the same way. A route asks
 * `spend(name, limit)` before calling a paid API and refuses when the day's
 * allowance is used up, independent of any quota set in the provider console.
 *
 * Server only. Never import from a client component.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { incr } from "./shared-store";

type Entry = { at: number; ttl: number; value: unknown };

const memory = new Map<string, Entry>();
const MEMORY_LIMIT = 2000;

let dirPromise: Promise<string | null> | null = null;

async function cacheDir(): Promise<string | null> {
  if (!dirPromise) {
    dirPromise = (async () => {
      // The ignore hints stop the bundler from tracing the whole project into every function.
      for (const base of [path.join(/*turbopackIgnore: true*/ process.cwd(), ".cache"), path.join(/*turbopackIgnore: true*/ os.tmpdir(), "plainly-cache")]) {
        try {
          await fs.mkdir(base, { recursive: true });
          const probe = path.join(base, ".probe");
          await fs.writeFile(probe, "ok");
          return base;
        } catch {
          // try the next location
        }
      }
      return null;
    })();
  }
  return dirPromise;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

function fileFor(dir: string, namespace: string, key: string, ext = "json") {
  return path.join(/*turbopackIgnore: true*/ dir, namespace.replace(/[^a-z0-9-]/gi, "_"), `${hash(key)}.${ext}`);
}

/** Read a cached JSON value, or undefined when missing or expired. */
export async function cacheGet<T>(namespace: string, key: string): Promise<T | undefined> {
  const id = `${namespace}:${key}`;
  const m = memory.get(id);
  const now = Date.now();
  if (m && now - m.at < m.ttl) return m.value as T;
  const dir = await cacheDir();
  if (!dir) return undefined;
  try {
    const raw = JSON.parse(await fs.readFile(fileFor(dir, namespace, key), "utf8")) as Entry;
    if (now - raw.at >= raw.ttl) return undefined;
    remember(id, raw);
    return raw.value as T;
  } catch {
    return undefined;
  }
}

/** Store a JSON value for `ttlMs`. */
export async function cacheSet(namespace: string, key: string, value: unknown, ttlMs: number): Promise<void> {
  const entry: Entry = { at: Date.now(), ttl: ttlMs, value };
  remember(`${namespace}:${key}`, entry);
  const dir = await cacheDir();
  if (!dir) return;
  try {
    const file = fileFor(dir, namespace, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(entry));
  } catch {
    // memory still has it
  }
}

/** Binary variant for audio. No expiry: a spoken line never changes. */
export async function blobGet(namespace: string, key: string): Promise<Buffer | undefined> {
  const dir = await cacheDir();
  if (!dir) return undefined;
  try {
    return await fs.readFile(fileFor(dir, namespace, key, "bin"));
  } catch {
    return undefined;
  }
}

export async function blobSet(namespace: string, key: string, data: ArrayBuffer | Buffer): Promise<void> {
  const dir = await cacheDir();
  if (!dir) return;
  try {
    const file = fileFor(dir, namespace, key, "bin");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(data as ArrayBuffer));
  } catch {
    // not fatal
  }
}

function remember(id: string, entry: Entry) {
  if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
  memory.set(id, entry);
}

/**
 * Cache-through helper: return the cached value or compute, store and return.
 * Failures are not cached.
 */
export async function cached<T>(namespace: string, key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(namespace, key);
  if (hit !== undefined) return hit;
  const value = await compute();
  await cacheSet(namespace, key, value, ttlMs);
  return value;
}

// ---------------------------------------------------------------------------
// Daily budgets

type Ledger = Record<string, { day: string; used: number }>;
let ledger: Ledger | null = null;
let ledgerWrite: Promise<void> = Promise.resolve();

const today = () => new Date().toISOString().slice(0, 10);

async function loadLedger(): Promise<Ledger> {
  if (ledger) return ledger;
  const dir = await cacheDir();
  if (dir) {
    try {
      ledger = JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ dir, "budgets.json"), "utf8")) as Ledger;
      return ledger;
    } catch {
      // first run
    }
  }
  ledger = {};
  return ledger;
}

function saveLedger() {
  ledgerWrite = ledgerWrite.then(async () => {
    const dir = await cacheDir();
    if (!dir || !ledger) return;
    try {
      await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, "budgets.json"), JSON.stringify(ledger, null, 2));
    } catch {
      // not fatal
    }
  });
}

/**
 * Try to spend `amount` units of a named daily budget. Returns false (and
 * spends nothing) when that would exceed `limit` for today.
 */
export async function spend(name: string, limit: number, amount = 1): Promise<boolean> {
  // Shared across instances when a store is connected; see lib/shared-store.ts.
  const key = `budget:${name}:${today()}`;
  const total = await incr(key, amount, 2 * 86_400);
  if (total !== null) {
    if (total <= limit) return true;
    await incr(key, -amount, 2 * 86_400);
    return false;
  }
  const l = await loadLedger();
  const d = today();
  const row = l[name]?.day === d ? l[name] : { day: d, used: 0 };
  if (row.used + amount > limit) return false;
  row.used += amount;
  l[name] = row;
  saveLedger();
  return true;
}

/** How much of a daily budget is used today. */
export async function budgetUsed(name: string): Promise<number> {
  const l = await loadLedger();
  return l[name]?.day === today() ? l[name].used : 0;
}

/** Read a positive integer from env with a default. */
export function envLimit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** fetch with a timeout that never throws on HTTP errors; the caller checks .ok. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 12_000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
