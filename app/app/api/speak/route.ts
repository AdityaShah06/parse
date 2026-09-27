import { NextResponse } from "next/server";
import { blobGet, blobSet, envLimit, spend } from "@/lib/server-cache";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Gemini and the CMS API can take tens of seconds; 60 is the ceiling on every Vercel plan.
export const maxDuration = 60;

/**
 * GET /api/speak?t=<line>
 * Reads one of the guide's lines aloud with ElevenLabs and returns MP3.
 *
 * The key stays on the server (ELEVENLABS_API_KEY in .env.local). The client
 * only ever sees audio. Responses are marked immutable so the browser and
 * Vercel's CDN cache every line: a rehearsed demo costs credits once.
 *
 * Optional: ELEVENLABS_VOICE_ID (default Lily, a velvety British premade:
 * the free plan can't use Voice Library or designed voices over the API),
 * ELEVENLABS_MODEL (default eleven_multilingual_v2, the most expressive
 * model that still answers fast; about one credit per character), and
 * ELEVENLABS_STABILITY / ELEVENLABS_STYLE to tune the delivery.
 * With no key the route answers 503 and the page falls back to the
 * browser's own speech engine.
 */

const DEFAULT_VOICE = "pFZP5JQG7iQjIQuC4Bku";
const DEFAULT_MODEL = "eleven_multilingual_v2";
// Low stability and a strong style push: playful and a little smoky, not a newsreader.
const DEFAULT_STABILITY = 0.3;
const DEFAULT_STYLE = 0.55;

function setting(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}
const MAX_CHARS = 280;

// Per-instance memory: identical lines are never paid for twice while warm.
const cache = new Map<string, ArrayBuffer>();
const CACHE_LIMIT = 200;

function clean(v: string | undefined) {
  return v?.trim().replace(/^["']|["']$/g, "") || undefined;
}

export async function GET(req: Request) {
  const text = (new URL(req.url).searchParams.get("t") ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_CHARS) {
    return NextResponse.json({ ok: false, code: "bad_text" }, { status: 400 });
  }

  const key = clean(process.env.ELEVENLABS_API_KEY);
  if (!key) return NextResponse.json({ ok: false, code: "no_key" }, { status: 503 });

  const voice = clean(process.env.ELEVENLABS_VOICE_ID) ?? DEFAULT_VOICE;
  const model = clean(process.env.ELEVENLABS_MODEL) ?? DEFAULT_MODEL;
  // eleven_v3 only accepts stability 0, 0.5 or 1.
  const rawStability = setting("ELEVENLABS_STABILITY", DEFAULT_STABILITY);
  const stability = model === "eleven_v3" ? Math.round(rawStability * 2) / 2 : rawStability;
  const style = setting("ELEVENLABS_STYLE", DEFAULT_STYLE);
  const id = `${voice}|${model}|${stability}|${style}|${text}`;

  const headers = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
  };

  const hit = cache.get(id);
  if (hit) return new Response(hit, { headers });
  // Disk copy survives dev-server restarts: a rehearsed line is paid for once, ever.
  const disk = await blobGet("voice", id);
  if (disk) {
    const ab = disk.buffer.slice(disk.byteOffset, disk.byteOffset + disk.byteLength) as ArrayBuffer;
    cache.set(id, ab);
    return new Response(ab, { headers });
  }

  // Only lines that cost credits count against the visitor; cached audio is free.
  const limited = await rateLimit(req, "speak");
  if (limited) return limited;
  // Hard daily character cap (Multilingual v2 costs about one credit per character).
  if (!(await spend("elevenlabs-chars", envLimit("ELEVENLABS_DAILY_CHARS", 2500), text.length))) {
    return NextResponse.json({ ok: false, code: "budget" }, { status: 429 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability, similarity_boost: 0.8, style, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return NextResponse.json({ ok: false, code: "unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    // Never echo the upstream body: it can include account details.
    console.warn(`[speak] ElevenLabs answered ${upstream.status}`);
    const code = upstream.status === 401 ? "bad_key" : upstream.status === 429 ? "quota" : "upstream";
    return NextResponse.json({ ok: false, code }, { status: 502 });
  }

  const audio = await upstream.arrayBuffer();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(id, audio);
  await blobSet("voice", id, audio);
  return new Response(audio, { headers });
}
