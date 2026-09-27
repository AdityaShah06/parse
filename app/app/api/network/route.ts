import { NextResponse } from "next/server";
import { formatAddress, isPlanId, providersCovered, providersSearch, toHttpError } from "@/lib/marketplace";
import { checkPlaces, NETWORK_SOURCE, type PlaceIn } from "@/lib/network";

export const runtime = "nodejs";

const SOURCE = NETWORK_SOURCE;


/**
 * POST /api/network { planId, zip, places: [{ id, name, address }] }
 * For each place (usually from Google), find the matching provider in the
 * CMS directory near that ZIP, then ask CMS whether that NPI is covered by
 * the plan. Returns Covered / NotCovered / DataNotProvided / NoMatch per place.
 *
 * GET /api/network?planId=&npis=a,b checks NPIs directly.
 */
export async function POST(req: Request) {
  let body: { planId?: string; zip?: string; places?: PlaceIn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }
  const planId = (body.planId ?? "").slice(0, 14);
  const zip = body.zip ?? "";
  const places = (body.places ?? []).slice(0, 12);
  if (!isPlanId(planId) || !/^\d{5}$/.test(zip)) return NextResponse.json({ ok: false, code: "bad_request", message: "planId and zip required" }, { status: 400 });

  try {
    const results = await checkPlaces(planId, zip, places);
    return NextResponse.json({ ok: true, planId, results, source: SOURCE });
  } catch (err) {
    const { status, body: b } = toHttpError(err);
    return NextResponse.json(b, { status });
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const planId = u.get("planId") ?? "";
  const npis = (u.get("npis") ?? "").split(",").filter(Boolean).slice(0, 40);
  const q = (u.get("q") ?? "").trim();
  const zip = u.get("zip") ?? "";
  try {
    // Directory search: real providers near a ZIP from the CMS directory, with
    // coverage for the plan when a plan id is given. Works with no Google key.
    if (q.length >= 3 && /^\d{5}$/.test(zip)) {
      const t = u.get("type");
      // The directory matches on names, so a search can return someone 300 miles away. Keep it local.
      const found = (await providersSearch({ zip, q, type: t === "Individual" || t === "Facility" ? t : "Individual,Facility", specialty: u.get("specialty") ?? undefined }))
        .filter((f) => f.distance === null || f.distance <= 30)
        .slice(0, 20);
      const cov = isPlanId(planId) && found.length ? await providersCovered(found.map((f) => f.npi), [planId]) : [];
      const by = new Map(cov.map((c) => [c.npi, c]));
      return NextResponse.json({
        ok: true,
        planId: isPlanId(planId) ? planId : null,
        providers: found.map((f) => ({ ...f, addressText: formatAddress(f.address), coverage: by.get(f.npi)?.coverage ?? (isPlanId(planId) ? "DataNotProvided" : null) })),
        source: SOURCE,
      });
    }
    const rows = await providersCovered(npis, [planId]);
    return NextResponse.json({ ok: true, planId, results: rows, source: SOURCE });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
