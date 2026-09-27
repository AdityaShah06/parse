/**
 * Parser for the cost-sharing strings in the CMS Benefits and Cost Sharing PUF.
 *
 * CopayInnTier1 and CoinsInnTier1 are VARCHAR, not numbers. They hold a small
 * regular grammar:
 *
 *   [ percentage | dollar amount | "No Charge" | "Not Applicable" ]
 *     + optional " Coinsurance" / " Copay"
 *     + optional " after deductible"
 *
 * The "after deductible" suffix is the part that changes the math. A bare
 * "20.00%" means the deductible is waived and you pay 20% from the first
 * dollar. "20.00% Coinsurance after deductible" means you pay the full allowed
 * amount until the deductible is met, then 20%.
 *
 * Verified against the Missouri slice of the PY2026 file: 32 distinct
 * CoinsInnTier1 values, all covered below.
 */

export type CostShare =
  | { kind: "notApplicable" }
  | {
      kind: "coinsurance";
      rate: number;
      afterDeductible: boolean;
      /** SBC "10% coinsurance up to $50": the most one event costs in coinsurance. Undefined means uncapped. */
      maxPerEvent?: number;
    }
  | {
      kind: "copay";
      amount: number;
      afterDeductible: boolean;
      /**
       * Inpatient benefits price copays per day or per stay, not per visit.
       * A "$1000.00 Copay per Day" on a four-day admission is $4,000.
       */
      unit: "visit" | "day" | "stay";
    };

const NOT_APPLICABLE: CostShare = { kind: "notApplicable" };

/**
 * Parse one cost-sharing cell.
 *
 * Handles every observed Missouri value:
 *   "Not Applicable", NULL, ""          -> notApplicable
 *   "No Charge"                         -> 0% coinsurance, deductible waived
 *   "No Charge after deductible"        -> 0% coinsurance after deductible
 *   "0.00%" / "25.00%"                  -> coinsurance, deductible waived
 *   "20.00% Coinsurance after deductible" -> coinsurance after deductible
 *   "$30"                               -> copay, deductible waived
 *   "$30 Copay after deductible"        -> copay after deductible
 *   "$1000.00 Copay per Day"            -> copay, per day of admission
 *   "$500.00 Copay per Stay after deductible" -> copay, once per admission
 */
export function parseCostShare(raw: string | null | undefined): CostShare {
  if (raw === null || raw === undefined) return NOT_APPLICABLE;

  const s = raw.trim();
  if (s === "" || /^not applicable$/i.test(s)) return NOT_APPLICABLE;

  const afterDeductible = /after deductible/i.test(s);

  if (/no charge/i.test(s)) {
    return { kind: "coinsurance", rate: 0, afterDeductible };
  }

  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    return {
      kind: "coinsurance",
      rate: parseFloat(pct[1]) / 100,
      afterDeductible,
    };
  }

  const dollars = s.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (dollars) {
    const unit: "visit" | "day" | "stay" = /per\s+day/i.test(s)
      ? "day"
      : /per\s+stay/i.test(s)
        ? "stay"
        : "visit";

    return {
      kind: "copay",
      amount: parseFloat(dollars[1].replace(/,/g, "")),
      afterDeductible,
      unit,
    };
  }

  // Unknown shape. Warn rather than silently pricing something at zero: if a
  // new string appears in the data, you want to see it, not absorb it.
  console.warn(`Unparsed cost-sharing string: ${JSON.stringify(raw)}`);
  return NOT_APPLICABLE;
}

/**
 * A benefit row usually carries either a copay or a coinsurance, with the
 * other set to "Not Applicable". Some carry both, meaning a copay plus
 * coinsurance on the remainder; this model takes the copay in that case and
 * notes the simplification.
 */
export function pickCostShare(
  copayRaw: string | null | undefined,
  coinsRaw: string | null | undefined
): CostShare {
  const copay = parseCostShare(copayRaw);
  if (copay.kind === "copay") return copay;

  const coins = parseCostShare(coinsRaw);
  if (coins.kind !== "notApplicable") return coins;

  // "No Charge" and "No Charge after deductible" can sit in the copay column
  // with coinsurance "Not Applicable". parseCostShare reads them as 0%
  // coinsurance, which is covered care, not an exclusion. When both columns
  // are "Not Applicable", copay is already notApplicable here.
  return copay;
}
