import { NextResponse } from "next/server";
import { matchPlaceToNpi, NpiBudgetExhausted, NpiHttpError } from "@/lib/npi";
import { resolveCategory } from "@/lib/places";

export const runtime = "nodejs";

const MAX_PLACES = 20;
const CONCURRENCY = 4;

type Row = { id: string; npi: string | null; npiName: string | null; taxonomy: string | null; confidence: number };

/**
 * POST /api/places/npi
 * body {category, places:[{id, name, address}]} (at most 20 places)
 *
 * 200 {ok:true, results:[{id, npi, npiName, taxonomy, confidence}]}
 *     npi is null (confidence 0) when no registry record matches well enough,
 *     or when that one lookup failed; partial results still return 200.
 * 400 {ok:false, code:"bad_category"|"bad_request"}
 * 429 {ok:false, code:"budget"} when the daily NPI budget ran out before any match finished
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "bad_request", error: "JSON body required" }, { status: 400 });
  }
  const b = body as { category?: unknown; places?: unknown };
  const category = resolveCategory(b.category);
  if (!category) return NextResponse.json({ ok: false, code: "bad_category" }, { status: 400 });
  if (!Array.isArray(b.places)) return NextResponse.json({ ok: false, code: "bad_request", error: "places must be an array" }, { status: 400 });

  const places = b.places
    .filter((p): p is { id: string; name: string; address: string } => {
      const o = p as Record<string, unknown>;
      return !!o && typeof o.id === "string" && typeof o.name === "string" && typeof o.address === "string";
    })
    .slice(0, MAX_PLACES);

  let budgetHit = false;
  const results: Row[] = new Array(places.length);
  let next = 0;
  async function worker() {
    while (next < places.length) {
      const i = next++;
      const p = places[i];
      try {
        const m = await matchPlaceToNpi(p, category as string);
        results[i] = { id: p.id, npi: m?.npi ?? null, npiName: m?.name ?? null, taxonomy: m?.taxonomy ?? null, confidence: m?.confidence ?? 0 };
      } catch (e) {
        if (e instanceof NpiBudgetExhausted) budgetHit = true;
        else if (!(e instanceof NpiHttpError)) throw e;
        results[i] = { id: p.id, npi: null, npiName: null, taxonomy: null, confidence: 0 };
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, places.length) }, worker));
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 500 });
  }

  if (budgetHit && results.every((r) => r.npi === null)) {
    return NextResponse.json({ ok: false, code: "budget" }, { status: 429 });
  }
  return NextResponse.json({ ok: true, category, results });
}
