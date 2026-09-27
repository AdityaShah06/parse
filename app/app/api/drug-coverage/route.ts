import { NextResponse } from "next/server";
import { drugsAutocomplete, drugsCovered, toHttpError } from "@/lib/marketplace";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/drug-coverage?planId=&q=atorvastatin  (or &rxcuis=a,b)
 * Is this drug on the plan's formulary? Straight from CMS, which builds it
 * from each insurer's machine-readable formulary.
 */
export async function GET(req: Request) {
  const limited = await rateLimit(req, "lookup");
  if (limited) return limited;
  const u = new URL(req.url).searchParams;
  const planId = u.get("planId") ?? "";
  const q = (u.get("q") ?? "").trim();
  try {
    let drugs: { rxcui: string; name: string }[] = [];
    if (q.length >= 3) drugs = (await drugsAutocomplete(q)).slice(0, 6).map((d) => ({ rxcui: d.rxcui, name: d.fullName ?? d.name }));
    const extra = (u.get("rxcuis") ?? "").split(",").filter(Boolean).map((r) => ({ rxcui: r, name: r }));
    drugs = [...drugs, ...extra].slice(0, 10);
    const cov = drugs.length ? await drugsCovered(drugs.map((d) => d.rxcui), [planId]) : [];
    const by = new Map(cov.map((c) => [c.rxcui, c]));
    const results = drugs.map((d) => ({ rxcui: d.rxcui, name: d.name, coverage: by.get(d.rxcui)?.coverage ?? "DataNotProvided", genericRxcui: by.get(d.rxcui)?.genericRxcui ?? null }));
    return NextResponse.json({ ok: true, planId, results, source: "CMS Marketplace formulary data" });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
