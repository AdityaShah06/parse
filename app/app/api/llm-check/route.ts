import { NextResponse } from "next/server";
import { target, keyFingerprint } from "@/lib/llm";

export const runtime = "nodejs";

/** GET /api/llm-check: which Gemini host and model this key works with, or why not. Never returns the key. */
export async function GET() {
  try {
    const t = await target();
    return NextResponse.json({ ok: true, key: keyFingerprint(), surface: t.surface, model: t.model, auth: t.auth });
  } catch (e) {
    return NextResponse.json({ ok: false, key: keyFingerprint(), error: (e as Error).message.slice(0, 1600) });
  }
}
