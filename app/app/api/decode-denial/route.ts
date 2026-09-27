import { NextResponse } from "next/server";
import { ApiError, NoKey, extractJson } from "@/lib/llm";
import { DENIAL_SCHEMA, DENIAL_SYSTEM, NotADenial, sanitizeDenial } from "@/lib/denial";

export const runtime = "nodejs";
// Gemini and the CMS API can take tens of seconds; 60 is the ceiling on every Vercel plan.
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

function sniff(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.subarray(0, 4).toString("latin1") === "\u0089PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** POST a denial letter or EOB (PDF, PNG or JPEG) as form field "file". Nothing is stored. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, code: "bad_request", error: "No file received." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, code: "too_big", error: "That file is over 10 MB." }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) return NextResponse.json({ ok: false, code: "bad_type", error: "Send a PDF or a photo (PNG or JPEG)." }, { status: 415 });

  try {
    const raw = await extractJson({
      system: DENIAL_SYSTEM,
      schema: DENIAL_SCHEMA,
      parts: [{ inline_data: { mime_type: mime, data: bytes.toString("base64") } }, { text: "Record what this denial says." }],
    });
    return NextResponse.json({ ok: true, denial: sanitizeDenial(raw) });
  } catch (e) {
    if (e instanceof NoKey) return NextResponse.json({ ok: false, code: "no_key", error: e.message }, { status: 503 });
    if (e instanceof NotADenial) return NextResponse.json({ ok: false, code: "not_denial", error: e.message }, { status: 422 });
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ ok: false, code: "api", error: e instanceof Error ? e.message : "Unknown error" }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
