import { NextResponse } from "next/server";
import { ATTRIBUTION, fillOptions, suggestDrugs } from "@/lib/pharmacy";

export const runtime = "nodejs";

/**
 * GET /api/rx?q=sertraline%2050%20mg&qty=30&days=30
 *   -> { ok, drug, benchmark, options, notes, attribution }
 * GET /api/rx?suggest=sert
 *   -> { ok, suggestions: [{ name, strengths, rxcuis }] }
 *
 * No personal data in or out. Queries are not logged or stored; the only
 * cache is keyed by the public API URL. `private` keeps shared caches (CDNs)
 * from holding a response tied to one visitor's search.
 */

const HEADERS = { "Cache-Control": "private, max-age=300" };

function intParam(v: string | null, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!v || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const suggest = params.get("suggest");
  if (suggest !== null) {
    try {
      const suggestions = await suggestDrugs(suggest.slice(0, 60));
      return NextResponse.json({ ok: true, suggestions, attribution: [ATTRIBUTION[0]] }, { headers: HEADERS });
    } catch {
      return NextResponse.json({ ok: false, suggestions: [], error: "Suggestions are unavailable right now." }, { headers: HEADERS });
    }
  }

  const q = (params.get("q") ?? "").trim().slice(0, 100);
  if (!q) {
    return NextResponse.json({ ok: false, error: "Add ?q= with a drug name, like sertraline 50 mg." }, { status: 400, headers: HEADERS });
  }
  const qty = intParam(params.get("qty"), 30, 1, 1000);
  const days = intParam(params.get("days"), 30, 1, 365);

  const result = await fillOptions({ query: q, qty, daysSupply: days });
  return NextResponse.json(
    { ok: true, query: { qty, days }, drug: result.drug, benchmark: result.benchmark, options: result.options, notes: result.notes, attribution: ATTRIBUTION },
    { headers: HEADERS },
  );
}
