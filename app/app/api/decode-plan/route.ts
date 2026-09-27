import { NextResponse } from "next/server";
import { ApiError, NoKey, extractJson } from "@/lib/llm";
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, NotAnSbc, sanitize } from "@/lib/decode";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Gemini and the CMS API can take tens of seconds; 60 is the ceiling on every Vercel plan.
export const maxDuration = 60;

// Vercel functions reject request bodies over 4.5 MB, so stay under that everywhere.
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST a PDF as multipart form field "file". Returns the decoded plan for the
 * visitor to confirm. Nothing is stored: the file lives only in this request.
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, "decode");
  if (limited) return limited;
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ ok: false, code: "bad_request", error: "Send the PDF as form field 'file'." }, { status: 400 });
  }

  if (!file) return NextResponse.json({ ok: false, code: "bad_request", error: "No file received." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, code: "too_big", error: "That PDF is over 4 MB." }, { status: 413 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-") {
    return NextResponse.json({ ok: false, code: "not_pdf", error: "That file is not a PDF." }, { status: 415 });
  }

  try {
    const raw = await extractJson({
      system: EXTRACT_SYSTEM,
      schema: EXTRACT_SCHEMA,
      maxTokens: 8000,
      parts: [
        { inline_data: { mime_type: "application/pdf", data: bytes.toString("base64") } },
        { text: "Record this plan's in-network costs for one person." },
      ],
    });
    return NextResponse.json({ ok: true, decoded: sanitize(raw) });
  } catch (e) {
    if (e instanceof NoKey) {
      return NextResponse.json({ ok: false, code: "no_key", error: e.message }, { status: 503 });
    }
    if (e instanceof NotAnSbc) {
      return NextResponse.json({ ok: false, code: "not_sbc", error: e.message }, { status: 422 });
    }
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json(
      { ok: false, code: "api", error: e instanceof Error ? e.message : "Unknown error" },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}
