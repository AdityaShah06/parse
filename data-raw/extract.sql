-- extract.sql
-- Turns three CMS Public Use Files into one small JSON the app ships with.
-- Run from the folder holding the CSVs:  .\duckdb < extract.sql
--
-- Missouri, individual market, medical (not dental), medical and drug
-- accumulators integrated so a single deductible and MOOP are correct.
--
-- TWO THINGS TO CONFIRM BEFORE TRUSTING THE OUTPUT, both flagged in the
-- diagnostics below:
-- Rating areas are set: Boone County (Columbia, where the hackathon is) is
-- Rating Area 5. Adair County (Kirksville) is Rating Area 2. Source: CMS,
-- Missouri Geographic Rating Areas.

.pager off

-- ---------------------------------------------------------------------------
-- Parameters
-- ---------------------------------------------------------------------------
-- Age used for premium quotes. Say this in the UI; premiums are age-rated.
SET VARIABLE quote_age = '30';

-- Rating area for premium quotes. Boone County (Columbia) = Rating Area 5.
-- Adair County (Kirksville) = Rating Area 2. Premiums differ between them for
-- the same plan, which is worth showing in the UI.
SET VARIABLE rating_area = 'Rating Area 5';

-- ---------------------------------------------------------------------------
-- 0. Diagnostics. Read these before anything else.
-- ---------------------------------------------------------------------------
SELECT '--- rating areas in the rate file ---' AS diagnostic;
SELECT RatingAreaId, COUNT(*) AS n
FROM read_csv_auto('rate-puf.csv', all_varchar=true)
WHERE StateCode = 'MO'
GROUP BY 1 ORDER BY 1;

-- ---------------------------------------------------------------------------
-- 1. Plans
-- ---------------------------------------------------------------------------
-- Deductible and MOOP are VARCHAR holding "$7,500" or "$0" or NULL, so strip
-- the formatting before casting. Anything that will not cast is dropped by the
-- IS NOT NULL filter at the end rather than silently becoming zero.
CREATE OR REPLACE TABLE plans AS
WITH raw AS (
  SELECT
    StandardComponentId                        AS plan_id,
    PlanId                                     AS variant_id,
    PlanMarketingName                          AS plan_name,
    IssuerMarketPlaceMarketingName             AS issuer,
    MetalLevel                                 AS metal,
    PlanType                                   AS plan_type,
    CSRVariationType                           AS csr_variant,
    URLForSummaryofBenefitsCoverage            AS sbc_url,
    IsHSAEligible                              AS hsa_eligible,
    -- NULLIF: a blank cell casts to 0, and a 0 cap would make the engine
    -- charge a per-day copay for zero days, i.e. price an admission at $0.
    -- Absent means uncapped, not zero.
    NULLIF(TRY_CAST(InpatientCopaymentMaximumDays AS INTEGER), 0)
                                               AS inpatient_copay_max_days,
    NULLIF(TRY_CAST(BeginPrimaryCareCostSharingAfterNumberOfVisits AS INTEGER), 0)
                                               AS free_pcp_visits,
    TRY_CAST(
      REPLACE(REPLACE(TEHBDedInnTier1Individual, '$', ''), ',', '') AS DOUBLE
    )                                          AS deductible,
    TRY_CAST(
      REPLACE(REPLACE(TEHBInnTier1IndividualMOOP, '$', ''), ',', '') AS DOUBLE
    )                                          AS out_of_pocket_max,
    -- Plan-level default coinsurance, used for benefits with no explicit rule.
    TRY_CAST(
      REPLACE(REPLACE(TEHBDedInnTier1Coinsurance, '%', ''), ',', '') AS DOUBLE
    ) / 100.0                                  AS default_coinsurance
  FROM read_csv_auto('plan-attributes-puf.csv', all_varchar=true)
  WHERE StateCode = 'MO'
    AND MarketCoverage = 'Individual'
    AND DentalOnlyPlan = 'No'
    -- Only integrated plans: the engine models one combined accumulator, and
    -- a non-integrated plan has a separate drug deductible it cannot express.
    AND MedicalDrugDeductiblesIntegrated = 'Yes'
    -- One row per plan. This drops the off-exchange duplicates, the 73/87/94%
    -- AV silver cost-sharing-reduction variants, and the Zero and Limited Cost
    -- Sharing variations, which otherwise fan the join out several times per
    -- plan with different deductibles.
    AND CSRVariationType LIKE 'Standard %'
    AND CSRVariationType LIKE '% On Exchange Plan'
)
SELECT * FROM raw
WHERE deductible IS NOT NULL
  AND out_of_pocket_max IS NOT NULL;

SELECT '--- plans kept ---' AS diagnostic, COUNT(*) AS n FROM plans;

-- ---------------------------------------------------------------------------
-- 2. Premiums
-- ---------------------------------------------------------------------------
-- The Rate PUF is keyed by PlanId, rating area, age and tobacco status.
--
-- NOTE ON THE JOIN KEY. The rate file's PlanId is the 14-character
-- StandardComponentId (e.g. 29416MO0020003) with no variant suffix, while
-- Plan Attributes carries both that and a suffixed PlanId (…-01). Rates join
-- on StandardComponentId. Joining on the suffixed id silently returns nothing.
CREATE OR REPLACE TABLE premiums AS
SELECT
  PlanId AS plan_id,
  MIN(TRY_CAST(IndividualRate AS DOUBLE))
    FILTER (WHERE RatingAreaId = getvariable('rating_area'))
                                            AS monthly_premium,
  -- Second area kept alongside so the app can show the same plan priced for
  -- Kirksville and Columbia without re-running the extraction.
  MIN(TRY_CAST(IndividualRate AS DOUBLE))
    FILTER (WHERE RatingAreaId = 'Rating Area 2')
                                            AS monthly_premium_area2
FROM read_csv_auto('rate-puf.csv', all_varchar=true)
WHERE StateCode = 'MO'
  AND Age = getvariable('quote_age')
  -- No tobacco filter. Missouri issuers use two conventions: 'No Preference'
  -- (one rate for everyone, in IndividualRate) and 'Tobacco User/Non-Tobacco
  -- User' (IndividualRate is the non-tobacco rate, IndividualTobaccoRate the
  -- smoker rate). Filtering to either one silently drops most issuers.
  -- IndividualRate is the non-smoker premium under both conventions.
GROUP BY 1
HAVING monthly_premium IS NOT NULL;

SELECT '--- plans with a premium ---' AS diagnostic,
       COUNT(*) AS n
FROM plans p JOIN premiums r ON p.plan_id = r.plan_id;

-- ---------------------------------------------------------------------------
-- 3. Benefits, narrowed to the scenarios the app supports
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TABLE benefits AS
SELECT
  PlanId        AS variant_id,
  BenefitName   AS benefit,
  CopayInnTier1 AS copay_raw,
  CoinsInnTier1 AS coins_raw,
  IsCovered     AS is_covered,
  IsExclFromInnMOOP = 'Yes' AS excluded_from_moop,
  Exclusions    AS exclusions,
  LimitQty      AS limit_qty,
  LimitUnit     AS limit_unit
FROM read_csv_auto('benefits-and-cost-sharing-puf.csv', all_varchar=true)
WHERE StateCode = 'MO'
  AND BenefitName IN (
    'Primary Care Visit to Treat an Injury or Illness',
    'Specialist Visit',
    'Preventive Care/Screening/Immunization',
    'Urgent Care Centers or Facilities',
    'Emergency Room Services',
    'Emergency Transportation/Ambulance',
    'Imaging (CT/PET Scans, MRIs)',
    'X-rays and Diagnostic Imaging',
    'Laboratory Outpatient and Professional Services',
    'Generic Drugs',
    'Preferred Brand Drugs',
    'Specialty Drugs',
    'Inpatient Physician and Surgical Services',
    'Outpatient Surgery Physician/Surgical Services',
    'Mental/Behavioral Health Outpatient Services'
  );

SELECT '--- benefits kept ---' AS diagnostic, COUNT(*) AS n FROM benefits;

-- ---------------------------------------------------------------------------
-- 4. Join and write
-- ---------------------------------------------------------------------------
-- Cost-sharing strings are emitted raw. parse-cost-share.ts owns the grammar,
-- so the parser has one home and the SQL stays dumb.
COPY (
  SELECT
    p.plan_id,
    p.variant_id,
    p.plan_name,
    p.issuer,
    p.metal,
    p.plan_type,
    p.csr_variant,
    p.deductible,
    p.out_of_pocket_max,
    p.default_coinsurance,
    p.inpatient_copay_max_days,
    p.free_pcp_visits,
    p.hsa_eligible,
    p.sbc_url,
    r.monthly_premium,
    r.monthly_premium_area2,
    LIST({
      'benefit':            b.benefit,
      'copay_raw':          b.copay_raw,
      'coins_raw':          b.coins_raw,
      'is_covered':         b.is_covered,
      'excluded_from_moop': b.excluded_from_moop,
      'exclusions':         b.exclusions,
      'limit_qty':          b.limit_qty,
      'limit_unit':         b.limit_unit
    }) AS cost_sharing
  FROM plans p
  JOIN premiums r ON p.plan_id = r.plan_id
  JOIN benefits b ON p.variant_id = b.variant_id
  GROUP BY ALL
  ORDER BY p.metal, r.monthly_premium
) TO 'mo-plans.json' (FORMAT JSON, ARRAY true);

SELECT '--- wrote mo-plans.json ---' AS diagnostic;
