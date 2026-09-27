/**
 * Counters shared by every server instance, for budgets and rate limits.
 *
 * On Vercel each function instance has its own /tmp, so a file ledger counts
 * per instance and a daily cap stops meaning anything. When Upstash Redis is
 * connected (Vercel Marketplace sets KV_REST_API_URL and KV_REST_API_TOKEN;
 * a direct Upstash database sets UPSTASH_REDIS_REST_URL and _TOKEN), counters
 * live there instead. Plain fetch against its REST API, no SDK.
 *
 * Server only. Returns null whenever the store is missing or unreachable, and
 * the caller falls back to its local count.
 */

function config(): { url: string; token: string } | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export const hasSharedStore = () => config() !== null;

/**
 * INCRBY key amount, and set the key to expire (only the first time) so old
 * windows clean themselves up. Returns the new total, or null on any failure.
 */
export async function incr(key: string, amount: number, ttlSeconds: number): Promise<number | null> {
  const c = config();
  if (!c) return null;
  try {
    const res = await fetch(`${c.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCRBY", key, String(amount)],
        ["EXPIRE", key, String(ttlSeconds), "NX"],
      ]),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const n = Number(out?.[0]?.result);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
