import { NextResponse } from "next/server";
import { blobGet, blobSet, envLimit, spend } from "@/lib/server-cache";

export const runtime = "nodejs";

/**
 * GET /api/speak?t=<line>
 * Reads one of the guide's lines aloud with ElevenLabs and returns MP3.
 *
 * The key stays on the server (ELEVENLABS_API_KEY in .env.local). The client
 * only ever sees audio. Responses are marked immutable so the browser and
 * Vercel's CDN cache every line: a rehearsed demo costs credits once.
 *
 * Optional: ELEVENLABS_VOICE_ID (default George, a calm narrator) and
 * ELEVENLABS_MODEL (default eleven_flash_v2_5, the lowest-latency model).
 * With no key the route answers 503 and the page falls back to the
 * browser's own speech engine.
 */

const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL = "eleven_flash_v2_5";
const MAX_CHARS = 280;

// Per-instance memory: identical lines are never paid for twice while warm.
const cache = new Map<string, ArrayBuffer>();
const CACHE_LIMIT = 200;

// A light fence so a public deploy can't be used to drain the account.
const hits = new Map<string, { n: number; at: number }>();
function limited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) {
    hits.set(ip, { n: 1, at: now });
    return false;
  }
  h.n += 1;
  return h.n > 40;
}

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
  const id = `${voice}|${model}|${text}`;

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

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return NextResponse.json({ ok: false, code: "slow_down" }, { status: 429 });
  // Hard daily character cap (Flash v2.5 costs about half a credit per character).
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
        // Steady and a little dry. Deadpan needs consistency more than range.
        voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
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
