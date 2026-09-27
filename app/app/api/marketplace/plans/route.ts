import { NextResponse } from "next/server";
import { STATE_MARKETPLACES, isHealthcareGovState, countiesByZip, getPlan, searchPlans, toEnginePlanDetailed, toHttpError, type ApiPlan } from "@/lib/marketplace";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Gemini and the CMS API can take tens of seconds; 60 is the ceiling on every Vercel plan.
export const maxDuration = 60;

/**
 * GET /api/marketplace/plans?zip=65201&age=21&income=24000
 * Real HealthCare.gov plans for any ZIP in the 29 states that use it, each
 * already converted to the engine's Plan shape. States that run their own
 * marketplace get a pointer to it instead.
 */
export async function GET(req: Request) {
  const limited = await rateLimit(req, "lookup");
  if (limited) return limited;
  const u = new URL(req.url).searchParams;
  const zip = (u.get("zip") ?? "").trim();
  const age = Number(u.get("age") ?? 26);
  const incomeRaw = u.get("income");
  const income = incomeRaw ? Number(incomeRaw) : undefined;
  if (!/^\d{5}$/.test(zip)) return NextResponse.json({ ok: false, code: "bad_request", message: "zip must be 5 digits" }, { status: 400 });

  try {
    const counties = await countiesByZip(zip);
    const state = counties[0]?.state ?? null;
    if (state && !isHealthcareGovState(state)) {
      return NextResponse.json({ ok: true, healthcareGov: false, state, stateMarketplace: STATE_MARKETPLACES[state] ?? null, plans: [] });
    }
    const res = await searchPlans({ zip, age, income, limit: Number(u.get("limit") ?? 60) });
    // Search results carry only a few headline benefits. Without the rest,
    // an MRI or a hospital stay would fall back to "free" in the engine, so
    // fetch each plan's full benefit list (cached for 12 hours) and keep the
    // household-specific premiums from the search.
    const full = await mapLimit(res.plans, 8, async (p) => {
      try {
        const d = await getPlan(p.id);
        return { ...d, premium: p.premium, premium_w_credit: p.premium_w_credit, ehb_premium: p.ehb_premium } as ApiPlan;
      } catch {
        return p;
      }
    });
    const plans = full
      .map((p) => {
        const e = toEnginePlanDetailed(p);
        if (!e) return null;
        return {
          id: p.id,
          name: p.name,
          issuer: p.issuer?.name ?? null,
          issuerPhone: p.issuer?.toll_free ?? null,
          metal: p.metal_level ?? null,
          type: p.type ?? null,
          premium: p.premium ?? null,
          premiumWithCredit: p.premium_w_credit ?? null,
          deductible: e.plan.deductible,
          moop: e.plan.outOfPocketMax,
          hsa: p.hsa_eligible ?? false,
          hasNationalNetwork: p.has_national_network ?? null,
          referral: p.specialist_referral_required ?? null,
          qualityRating: p.quality_rating ?? null,
          urls: { brochure: p.brochure_url ?? null, benefits: p.benefits_url ?? null, network: p.network_url ?? null, formulary: p.formulary_url ?? null },
          enginePlan: e.plan,
          notes: e.notes,
        };
      })
      .filter(Boolean);
    return NextResponse.json({ ok: true, healthcareGov: true, state: res.county.state, county: res.county, total: res.total, plans, source: "CMS Marketplace API" });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}
