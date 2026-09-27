import { createHash } from "node:crypto";
/**
 * Minimal Gemini client for server routes. Plain fetch, no SDK dependency.
 *
 * Server only: this reads GEMINI_API_KEY, which must never reach a browser.
 * Every call asks for JSON that matches a schema, and every caller validates
 * the result again, so a model that ignores the schema produces blanks, not
 * wrong numbers.
 */

const STUDIO = "https://generativelanguage.googleapis.com/v1beta";
const VERTEX = "https://aiplatform.googleapis.com/v1/publishers/google";

export class NoKey extends Error {}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function key(): string {
  // PLAINLY_GEMINI_KEY first: a GEMINI_API_KEY set in the Windows environment
  // (Gemini CLI and other tools set one) silently overrides .env.local.
  const k = (process.env.PLAINLY_GEMINI_KEY || process.env.GEMINI_API_KEY)?.trim().replace(/^["']|["']$/g, "");
  if (!k) throw new NoKey("PLAINLY_GEMINI_KEY is not set in app/.env.local");
  return k;
}

/**
 * How the key is sent. The ?key= query parameter works for every key shape we
 * have seen, including the newer AQ. keys that the x-goog-api-key header
 * rejects, so it goes first. The header stays as a fallback.
 */
type Auth = "query" | "header";

const headers = (auth: Auth): Record<string, string> =>
  auth === "header" ? { "x-goog-api-key": key(), "content-type": "application/json" } : { "content-type": "application/json" };

/** Newest first. The first one this key can use wins. */
const PREFERRED = [
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
];

/**
 * Google issues Gemini keys for two hosts: AI Studio and Vertex AI (express
 * mode, common with Google Cloud credits). A key only works on its own host,
 * and the key's shape does not say which. GEMINI_SURFACE pins it; otherwise we
 * try AI Studio first and fall back to Vertex.
 */
type Surface = "studio" | "vertex";
type Target = { surface: Surface; model: string; auth: Auth };
let cached: Target | null = null;
/** The last probe failure, key-free, for diagnosing a rejected key. */
export let lastProbe = "";

const endpoint = (surface: Surface, m: string, auth: Auth) => {
  const base = `${surface === "studio" ? STUDIO : VERTEX}/models/${m}:generateContent`;
  return auth === "query" ? `${base}?key=${encodeURIComponent(key())}` : base;
};

const PING = JSON.stringify({
  contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
  generationConfig: { maxOutputTokens: 5 },
});

/**
 * Probe generateContent directly: some keys can generate but cannot list
 * models. A 404 means that model name is not available to this key, so try
 * the next one. Anything that says the key itself is bad stops that auth mode.
 */
async function probe(surface: Surface, prefer?: string): Promise<Target | null> {
  const models = prefer ? [prefer, ...PREFERRED.filter((m) => m !== prefer)] : PREFERRED;
  for (const auth of ["query", "header"] as Auth[]) {
    for (const m of models) {
      let res: Response;
      try {
        res = await fetch(endpoint(surface, m, auth), { method: "POST", headers: headers(auth), body: PING, signal: AbortSignal.timeout(15000) });
      } catch {
        continue; // offline or slow; the caller falls back to the example path
      }
      if (res.ok) return { surface, model: m, auth };
      const body = await res.text();
      lastProbe = (lastProbe + ` | ${surface}/${m}/${auth}: ${res.status} ${body.replace(/[A-Za-z0-9_.-]{30,}/g, "<redacted>").replace(/\s+/g, " ").slice(0, 160)}`).slice(-1500);
      if (/API_KEY_INVALID|UNAUTHENTICATED|PERMISSION_DENIED|not supported by this API/.test(body)) break;
    }
  }
  return null;
}

/** A key-free fingerprint (length and a short sha256 prefix) so we can tell which key the server loaded. */
export function keyFingerprint(): string {
  try {
    const k = key();
    const h = createHash("sha256").update(k).digest("hex").slice(0, 8);
    return `${k.slice(0, 3)}... length ${k.length}, sha256 ${h}`;
  } catch {
    return "not set";
  }
}

/**
 * Flash models get "high demand" 503s that come and go by the minute, and not
 * all at once. When the chosen model is busy, a request moves down this list
 * (tried in order, after the working model) instead of failing.
 */
const FALLBACK = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.7-flash", "gemini-3.8-flash"];
/** One model gets this long before the request moves on; the whole route has 60 seconds on Vercel. */
const ATTEMPT_MS = 25_000;
/** Busy, rate limited, a server hiccup, or a model name this key cannot use. */
const RETRYABLE = new Set([404, 429, 500, 502, 503, 504]);
/** A model that just rescued a request stays first for a minute, so one conversation stays on one model. */
let sticky: { model: string; until: number } | null = null;

async function withFallback(send: (model: string) => Promise<Response>): Promise<Response> {
  const t = await target();
  const first = sticky && sticky.until > Date.now() ? sticky.model : t.model;
  const chain = [first, t.model, ...FALLBACK].filter((m, i, a) => a.indexOf(m) === i);
  for (let i = 0; ; i++) {
    let res: Response;
    try {
      res = await send(chain[i]);
    } catch (e) {
      // A timeout or dropped connection on one model is a reason to try the next.
      if (i === chain.length - 1) throw e;
      continue;
    }
    if (!RETRYABLE.has(res.status) || i === chain.length - 1) {
      if (res.ok) sticky = chain[i] === t.model ? null : { model: chain[i], until: Date.now() + 60_000 };
      return res;
    }
    await res.body?.cancel().catch(() => {});
  }
}

/** Which host, model and auth mode to call, worked out once per server start. */
export async function target(): Promise<Target> {
  if (cached) return cached;
  lastProbe = "";
  const pinned = process.env.GEMINI_SURFACE as Surface | undefined;
  const pinnedModel = process.env.GEMINI_MODEL?.trim() || undefined;

  if (pinned !== "vertex") {
    const t = await probe("studio", pinnedModel);
    if (t) return (cached = t);
  }
  if (pinned !== "studio") {
    const t = await probe("vertex", pinnedModel);
    if (t) return (cached = t);
  }
  throw new ApiError(`This Gemini key (${keyFingerprint()}) was rejected. Last answer: ${lastProbe}`, 401);
}

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/**
 * One request in, one JSON object out. Tries native schema-constrained output
 * first; if the model or endpoint rejects the schema, retries with the schema
 * written into the prompt instead.
 */
export async function extractJson(opts: {
  system: string;
  parts: Part[];
  schema: unknown;
  maxTokens?: number;
}): Promise<unknown> {
  const { surface, auth } = await target();
  const base = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: opts.parts }],
  };

  const attempt = async (m: string, generationConfig: Record<string, unknown>, extraText?: string) => {
    const body = extraText
      ? { ...base, contents: [{ role: "user", parts: [...opts.parts, { text: extraText }] }] }
      : base;
    return fetch(endpoint(surface, m, auth), {
      method: "POST",
      headers: headers(auth),
      body: JSON.stringify({ ...body, generationConfig }),
      signal: AbortSignal.timeout(ATTEMPT_MS),
    });
  };

  const config = {
    responseMimeType: "application/json",
    maxOutputTokens: opts.maxTokens ?? 4000,
    temperature: 0,
  };

  const res = await withFallback(async (m) => {
    const r = await attempt(m, { ...config, responseJsonSchema: opts.schema });
    if (r.status !== 400) return r;
    await r.body?.cancel().catch(() => {});
    return attempt(m, config, `Answer with only a JSON object matching this JSON Schema:\n${JSON.stringify(opts.schema)}`);
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(`Gemini ${res.status}: ${text.slice(0, 300)}`, res.status);
  }

  const out = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ApiError("Gemini did not return valid JSON", 502);
  }
}

/**
 * One raw generateContent call on whichever host and model this key works
 * with. Used by the agent, which needs function calling and multi-turn
 * contents; the caller shapes the body and validates everything that comes
 * back.
 */
export async function generateRaw(body: Record<string, unknown>, timeoutMs = 60000): Promise<GeminiResponse> {
  const { surface, auth } = await target();
  const res = await withFallback((m) =>
    fetch(endpoint(surface, m, auth), {
      method: "POST",
      headers: headers(auth),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(timeoutMs, ATTEMPT_MS)),
    })
  );
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(`Gemini ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as GeminiResponse;
}

export type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
};
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type GeminiResponse = { candidates?: { content?: GeminiContent; finishReason?: string }[] };
