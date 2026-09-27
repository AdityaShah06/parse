import { NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/care";
import { NoPlacesKey, PlacesBudgetExhausted, PlacesHttpError, PlacesInputError, searchPlaces } from "@/lib/places";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/places?category=urgent&zip=65201&detail=list
 * GET /api/places?category=er&lat=38.95&lng=-92.33&radius=16000
 *
 * 200 {ok:true, category, detail, center, centerSource, places, attribution, cached, fetchedAt, note?}
 * 400 {ok:false, code:"bad_category"|"bad_location"}
 * 429 {ok:false, code:"budget"}
 * 503 {ok:false, code:"no_key"}
 * 502 {ok:false, code:"upstream", status}
 *
 * With no category and no location it still returns the bundled Columbia list
 * ({ok:true, source:"bundled", places}) so the current Find care room keeps working.
 */
export async function GET(req: Request) {
  const limited = await rateLimit(req, "places");
  if (limited) return limited;
  const q = new URL(req.url).searchParams;
  const category = q.get("category") ?? q.get("kind");
  const zip = q.get("zip") ?? undefined;
  const lat = q.get("lat");
  const lng = q.get("lng");

  if (!category && !zip && lat === null) {
    return NextResponse.json({ ok: true, source: "bundled", places: PROVIDERS });
  }

  const num = (s: string | null) => (s === null || s.trim() === "" ? undefined : Number(s));
  const detail = q.get("detail") === "list" ? "list" : "full";

  try {
    const r = await searchPlaces({
      category: category ?? "",
      zip,
      lat: num(lat),
      lng: num(lng),
      radiusMeters: num(q.get("radius")),
      pageSize: num(q.get("limit")),
      detail,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof PlacesInputError) return NextResponse.json({ ok: false, code: e.code, error: e.message }, { status: 400 });
    if (e instanceof NoPlacesKey) return NextResponse.json({ ok: false, code: "no_key" }, { status: 503 });
    if (e instanceof PlacesBudgetExhausted) return NextResponse.json({ ok: false, code: "budget" }, { status: 429 });
    if (e instanceof PlacesHttpError) return NextResponse.json({ ok: false, code: "upstream", status: e.status }, { status: 502 });
    return NextResponse.json({ ok: false, code: "error" }, { status: 500 });
  }
}
