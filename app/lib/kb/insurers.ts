/**
 * Insurer scorecard: how each carrier behaves once you are a member, beyond
 * the price tag. Covers the Missouri marketplace issuers and the big national
 * carriers that also sell employer plans.
 *
 * Every figure is a Sourced value. A null value means we could not find a
 * published figure for that insurer, and the note says why. Nothing here is an
 * estimate. The scoring lives in lib/ranking.ts.
 *
 * Verification status (2026-09-27): the figures below were carried over from
 * earlier research. A re-check against the first-party pages was attempted
 * this session but the page fetcher was unavailable, so every row is marked
 * verified: false. Search results did confirm that each cited page exists at
 * the URL given. Missouri issuer denial rates are a third-party computation
 * from the CMS file; `node scripts/build-denials.mjs` recomputes them from the
 * CMS file itself and should replace them.
 */

export type SourceTier =
  /** CMS, a state regulator, KFF or NCQA publishing the figure directly. */
  | "first-party"
  /** A reputable secondary summary of a first-party dataset. */
  | "secondary"
  /** A third party's own computation from a public file. Recompute pending. */
  | "third-party-pending";

export type Sourced<T> = {
  value: T;
  /** The year the figure describes (claims year, rating year, reporting year). */
  year: number | null;
  sourceName: string;
  sourceUrl: string;
  note?: string;
  tier?: SourceTier;
  /** Missouri legal entity, or the national parent company. */
  scope?: "missouri-issuer" | "missouri-parent" | "parent-national";
  /** True once someone re-read the figure on the source page. */
  verified?: boolean;
};

export type Market = "marketplace-MO" | "marketplace-other" | "employer";

export type InsurerFactors = {
  /** In-network claims denied, percent (0 to 100). Lower is better. */
  denialRate: Sourced<number | null>;
  /** Internal appeals upheld by the insurer, percent. Lower is better. */
  appealUpheldRate?: Sourced<number | null>;
  /** Missouri DCI complaint index, 100 = market average. Lower is better. */
  complaintIndexMO: Sourced<number | null>;
  /** Missouri individual market MLR rebate owed, US dollars. */
  mlrRebateMO: Sourced<number | null>;
  /** CMS Quality Rating System overall stars, 1 to 5. Higher is better. */
  qrsOverall: Sourced<number | null>;
  qrsMemberExperience?: Sourced<number | null>;
  /** Prior authorization requests denied (standard), percent. Lower is better. */
  priorAuthDenial: Sourced<number | null>;
  /** NCQA commercial health plan rating, 0 to 5. Higher is better. */
  ncqa: Sourced<number | null>;
  /** Share of local physicians in network, percent. Higher is better. */
  networkBreadth: Sourced<number | null>;
};

export type Insurer = {
  id: string;
  /** Short consumer-facing name. */
  name: string;
  /** Legal entities, brand names, HIOS issuer IDs and parent names. */
  aliases: string[];
  /** Missouri HIOS issuer IDs (first five characters of a plan ID). */
  hiosIds: string[];
  parent: string;
  markets: Market[];
  factors: InsurerFactors;
};

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export const SOURCES = {
  ticPuf: {
    name: "CMS Transparency in Coverage PUF, plan year 2026 (2024 claims), released 2025-09-26",
    url: "https://download.cms.gov/marketplace-puf/2026/transparency-in-coverage-puf.zip",
  },
  ticDictionary: {
    name: "CMS Transparency in Coverage PUF data dictionary",
    url: "https://www.cms.gov/files/document/transparency-coverage-puf-datadictionary-py25.pdf",
  },
  denialFactsMO: {
    name: "denialfacts.com Missouri page, computed from the CMS Transparency in Coverage PUF (2024 claims)",
    url: "https://denialfacts.com/states/missouri",
  },
  kffDenials: {
    name: "KFF, Claims Denials and Appeals in ACA Marketplace Plans in 2024",
    url: "https://www.kff.org/patient-consumer-protections/claims-denials-and-appeals-in-aca-marketplace-plans-in-2024/",
  },
  moComplaints: {
    name: "Missouri Department of Commerce and Insurance, 2023 Complaint Index (accident and health, 2021 to 2023 pooled)",
    url: "https://insurance.mo.gov/sites/insurance/files/2024-11/2023%20Complaint%20Index.pdf",
  },
  mlr2024: {
    name: "CMS, Issuers Owing Rebates for the 2024 MLR Reporting Year",
    url: "https://www.cms.gov/files/document/2024-rebates-issuer.pdf",
  },
  qrsPuf: {
    name: "CMS Quality Rating System nationwide PUF, plan year 2026",
    url: "https://www.cms.gov/files/zip/qrs-nationwide-puf-py2026.zip",
  },
  valuePenguinMO: {
    name: "ValuePenguin, Best Cheap Health Insurance in Missouri for 2026 (reporting CMS QRS 2026 stars)",
    url: "https://www.valuepenguin.com/best-cheap-health-insurance-missouri",
  },
  kffPriorAuth: {
    name: "KFF, Prior Authorization Metrics Provide New Insights into Insurer Practices, but Gaps Remain",
    url: "https://www.kff.org/patient-consumer-protections/prior-authorization-metrics-provide-new-insights-into-insurer-practices-but-gaps-remain/",
  },
  ncqa2025: {
    name: "NCQA Health Plan Ratings 2025",
    url: "https://www.ncqa.org/hedis/reports-and-research/ncqas-health-plan-ratings-2025/",
  },
  beckersNcqa: {
    name: "Becker's Payer Issues, The best-rated commercial health plans in each state: NCQA (2025 ratings)",
    url: "https://www.beckerspayer.com/rankings-ratings/the-best-rated-commercial-health-plans-in-each-state-ncqa-2/",
  },
  kffNetworks: {
    name: "KFF, How Narrow or Broad Are ACA Marketplace Physician Networks? (2021 networks)",
    url: "https://www.kff.org/private-insurance/how-narrow-or-broad-are-aca-marketplace-physician-networks/",
  },
} as const;

type SourceKey = keyof typeof SOURCES;

function src(
  key: SourceKey,
  value: number | null,
  year: number | null,
  extra: Omit<Sourced<number | null>, "value" | "year" | "sourceName" | "sourceUrl"> = {},
): Sourced<number | null> {
  return {
    value,
    year,
    sourceName: SOURCES[key].name,
    sourceUrl: SOURCES[key].url,
    verified: false,
    ...extra,
  };
}

/** A factor we have no figure for. `where` points at the file that would hold it. */
function missing(where: SourceKey, year: number | null, reason: string): Sourced<number | null> {
  return src(where, null, year, { note: reason });
}

/* ------------------------------------------------------------------ */
/* Benchmarks used by the scoring anchors and the plain-English text   */
/* ------------------------------------------------------------------ */

export const BENCHMARKS = {
  denialNationalAvg: src("kffDenials", 19, 2024, {
    tier: "first-party",
    note: "Average in-network denial rate across marketplace issuers. Issuer range 3% to 36%. Fewer than 1% of denials were appealed.",
  }),
  denialMin: src("kffDenials", 3, 2024, { tier: "first-party" }),
  denialMax: src("kffDenials", 36, 2024, { tier: "first-party" }),
  appealUpheldNational: src("kffDenials", 66, 2024, {
    tier: "first-party",
    note: "Share of internal appeals in which the insurer kept its denial.",
  }),
  complaintAvg: src("moComplaints", 100, 2023, {
    tier: "first-party",
    note: "By construction: an index of 100 means the company's share of complaints equals its share of premiums.",
  }),
  priorAuthMarketplaceAvg: src("kffPriorAuth", 18, 2025, {
    tier: "first-party",
    note: "Marketplace average for standard requests (expedited 16%).",
  }),
  networkMarketplaceAvg: src("kffNetworks", 40, 2021, {
    tier: "first-party",
    note: "Marketplace enrollees could see 40% of local physicians on average.",
  }),
} as const;

/* ------------------------------------------------------------------ */
/* The insurers                                                        */
/* ------------------------------------------------------------------ */

const DENIAL_MO_NOTE =
  "Recomputed from the CMS PUF Individual QHP sheet (in-network claims denied / received), data/denials-2024.json.";

const NO_PA =
  "KFF's 2025 prior authorization analysis did not report this insurer in our carried-over extract.";
const NO_NCQA = "No NCQA 2025 commercial rating for this insurer in Missouri in our extract.";
const NO_QRS =
  "No 2026 QRS star rating in our extract. Check the CMS nationwide QRS file or the Marketplace API quality_rating.";
const NO_NETWORK = "KFF did not break out this insurer in the 2021 network analysis.";
const NO_MLR_MO =
  "Not among the three Missouri individual-market rebates in our extract. If it is absent from the CMS PDF it owed $0, but that has not been checked.";
const NO_COMPLAINT = "Not listed in the Missouri complaint index in our extract.";

export const INSURERS: Insurer[] = [
  {
    id: "anthem-mo",
    name: "Anthem Blue Cross and Blue Shield",
    aliases: [
      "Anthem",
      "Anthem Blue Cross and Blue Shield",
      "Anthem BCBS",
      "Healthy Alliance Life Insurance Company",
      "Healthy Alliance Life",
      "HMO Missouri",
      "HMO Missouri Inc",
      "Elevance Health",
      "Elevance",
      "32753",
    ],
    hiosIds: ["32753"],
    parent: "Elevance Health",
    markets: ["marketplace-MO", "employer"],
    factors: {
      denialRate: src("ticPuf", 7.5, 2024, {
        tier: "first-party",
        verified: true,
        scope: "missouri-issuer",
        note: `Healthy Alliance Life Insurance Co. ${DENIAL_MO_NOTE} KFF puts parent Elevance at 8% nationally.`,
      }),
      complaintIndexMO: src("moComplaints", 91, 2023, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "Healthy Alliance Life Insurance Co. The Anthem HMO entity, HMO Missouri Inc, scored 244.",
      }),
      mlrRebateMO: src("mlr2024", 25_955_705, 2024, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "Healthy Alliance Life Insurance Co, Missouri individual market.",
      }),
      qrsOverall: src("valuePenguinMO", 2, 2026, {
        tier: "secondary",
        note: "Secondary summary of CMS QRS 2026. Confirm against the CMS nationwide QRS file.",
      }),
      priorAuthDenial: missing("kffPriorAuth", 2025, NO_PA),
      ncqa: missing("ncqa2025", 2025, NO_NCQA),
      networkBreadth: src("kffNetworks", 49, 2021, {
        tier: "first-party",
        scope: "parent-national",
        note: "Average for Blue Cross Blue Shield plans nationally, not Anthem Missouri specifically.",
      }),
    },
  },
  {
    id: "blue-kc",
    name: "Blue Cross and Blue Shield of Kansas City",
    aliases: [
      "Blue KC",
      "BlueKC",
      "BCBSKC",
      "BCBS KC",
      "BCBS of Kansas City",
      "Blue Cross and Blue Shield of Kansas City",
      "Blue Cross Blue Shield of Kansas City",
      "Blue Cross and Blue Shield Kansas City",
    ],
    hiosIds: [],
    parent: "Blue Cross and Blue Shield of Kansas City (independent Blue licensee)",
    markets: ["marketplace-MO", "employer"],
    factors: {
      denialRate: src("ticPuf", 20.7, 2024, {
        tier: "first-party",
        verified: true,
        scope: "missouri-issuer",
        note: DENIAL_MO_NOTE,
      }),
      complaintIndexMO: src("moComplaints", 65, 2023, { tier: "first-party", scope: "missouri-issuer" }),
      mlrRebateMO: missing("mlr2024", 2024, NO_MLR_MO),
      qrsOverall: src("valuePenguinMO", 3, 2026, {
        tier: "secondary",
        note: "Secondary summary of CMS QRS 2026. Confirm against the CMS nationwide QRS file.",
      }),
      priorAuthDenial: missing("kffPriorAuth", 2025, NO_PA),
      ncqa: src("beckersNcqa", 3.5, 2025, {
        tier: "secondary",
        scope: "missouri-issuer",
        note: "Tied for highest-rated Missouri commercial plan per Becker's summary of NCQA 2025.",
      }),
      networkBreadth: src("kffNetworks", 49, 2021, {
        tier: "first-party",
        scope: "parent-national",
        note: "Average for Blue Cross Blue Shield plans nationally, not Blue KC specifically.",
      }),
    },
  },
  {
    id: "cox",
    name: "Cox HealthPlans",
    aliases: [
      "Cox HealthPlans",
      "Cox Health Plans",
      "Cox Health Systems Insurance Company",
      "Cox Health Systems Insurance",
      "CoxHealth",
    ],
    hiosIds: [],
    parent: "CoxHealth",
    markets: ["marketplace-MO", "employer"],
    factors: {
      denialRate: src("ticPuf", 14.7, 2024, {
        tier: "first-party",
        verified: true,
        scope: "missouri-issuer",
        note: `Cox Health Systems Insurance Co. ${DENIAL_MO_NOTE}`,
      }),
      complaintIndexMO: src("moComplaints", 68, 2023, { tier: "first-party", scope: "missouri-issuer" }),
      mlrRebateMO: missing("mlr2024", 2024, NO_MLR_MO),
      qrsOverall: missing("qrsPuf", 2026, NO_QRS),
      priorAuthDenial: missing("kffPriorAuth", 2025, NO_PA),
      ncqa: missing("ncqa2025", 2025, NO_NCQA),
      networkBreadth: missing("kffNetworks", 2021, NO_NETWORK),
    },
  },
  {
    id: "ambetter-mo",
    name: "Ambetter from Home State Health",
    aliases: [
      "Ambetter",
      "Ambetter Health",
      "Ambetter from Home State Health",
      "Home State Health",
      "Home State Health Plan",
      "Celtic Insurance Company",
      "Celtic Insurance",
      "Celtic",
      "Centene",
      "Centene Corporation",
      "99723",
    ],
    hiosIds: ["99723"],
    parent: "Centene",
    markets: ["marketplace-MO"],
    factors: {
      denialRate: src("ticPuf", 18.8, 2024, {
        tier: "first-party",
        verified: true,
        scope: "missouri-issuer",
        note: `Celtic Insurance Co. ${DENIAL_MO_NOTE}`,
      }),
      complaintIndexMO: src("moComplaints", 133, 2023, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "Celtic Insurance Co.",
      }),
      mlrRebateMO: src("mlr2024", 87_529_084, 2024, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "Celtic Insurance Co, Missouri individual market.",
      }),
      qrsOverall: src("valuePenguinMO", 3, 2026, {
        tier: "secondary",
        note: "Secondary summary of CMS QRS 2026. Confirm against the CMS nationwide QRS file.",
      }),
      qrsMemberExperience: src("valuePenguinMO", 5, 2026, {
        tier: "secondary",
        note: "Member Experience sub-rating, secondary summary of CMS QRS 2026.",
      }),
      priorAuthDenial: src("kffPriorAuth", 25, 2025, {
        tier: "first-party",
        scope: "parent-national",
        note: "Centene marketplace plans nationally, standard requests (expedited 23%).",
      }),
      ncqa: missing("ncqa2025", 2025, NO_NCQA),
      networkBreadth: src("kffNetworks", 33, 2021, {
        tier: "first-party",
        scope: "parent-national",
        note: "Centene marketplace plans nationally.",
      }),
    },
  },
  {
    id: "uhc",
    name: "UnitedHealthcare",
    aliases: [
      "UnitedHealthcare",
      "United Healthcare",
      "UHC",
      "UnitedHealthcare Insurance Company",
      "UnitedHealthcare of the Midwest",
      "UnitedHealth",
      "UnitedHealth Group",
      "United Health Group",
      "95426",
    ],
    hiosIds: ["95426"],
    parent: "UnitedHealth Group",
    markets: ["marketplace-MO", "employer"],
    factors: {
      denialRate: src("ticPuf", 19.0, 2024, {
        tier: "first-party",
        verified: true,
        scope: "missouri-issuer",
        note: `UnitedHealthcare Insurance Co. ${DENIAL_MO_NOTE} KFF puts parent UnitedHealth at 19% nationally.`,
      }),
      complaintIndexMO: src("moComplaints", 126, 2023, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "UnitedHealthcare Insurance Co.",
      }),
      mlrRebateMO: src("mlr2024", 3_864_442, 2024, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "UnitedHealthcare Insurance Co, Missouri individual market.",
      }),
      qrsOverall: missing("qrsPuf", 2026, NO_QRS),
      priorAuthDenial: src("kffPriorAuth", 21, 2025, {
        tier: "first-party",
        scope: "parent-national",
        note: "UnitedHealth marketplace plans nationally, standard requests.",
      }),
      ncqa: src("beckersNcqa", 3.5, 2025, {
        tier: "secondary",
        scope: "missouri-issuer",
        note: "Tied for highest-rated Missouri commercial plan per Becker's summary of NCQA 2025.",
      }),
      networkBreadth: missing("kffNetworks", 2021, NO_NETWORK),
    },
  },
  {
    id: "medica",
    name: "Medica",
    aliases: [
      "Medica",
      "Medica Insurance Company",
      "Medica Insurance",
      "Medica Central Health Plan",
      "Medica Central",
      "53461",
    ],
    hiosIds: ["53461"],
    parent: "Medica",
    markets: ["marketplace-MO", "employer"],
    factors: {
      denialRate: src("ticPuf", 23.4, 2024, {
        tier: "first-party",
        verified: true,
        scope: "missouri-issuer",
        note: `Medica Insurance Co. ${DENIAL_MO_NOTE} Sister entity Medica Central Health Plan: 21.3%. Which entity issues HIOS 53461 is not yet confirmed.`,
      }),
      complaintIndexMO: src("moComplaints", 280, 2023, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "Medica Insurance Co.",
      }),
      mlrRebateMO: missing("mlr2024", 2024, NO_MLR_MO),
      qrsOverall: missing("qrsPuf", 2026, NO_QRS),
      priorAuthDenial: missing("kffPriorAuth", 2025, NO_PA),
      ncqa: missing("ncqa2025", 2025, NO_NCQA),
      networkBreadth: missing("kffNetworks", 2021, NO_NETWORK),
    },
  },
  {
    id: "oscar",
    name: "Oscar Health",
    aliases: ["Oscar", "Oscar Health", "Oscar Insurance Company", "Oscar Insurance"],
    hiosIds: [],
    parent: "Oscar Health",
    markets: ["marketplace-MO"],
    factors: {
      denialRate: src("ticPuf", 24.5, 2024, {
        tier: "first-party",
        verified: true,
        scope: "missouri-issuer",
        note: `Oscar Insurance Co. ${DENIAL_MO_NOTE} KFF puts parent Oscar at 25% nationally.`,
      }),
      complaintIndexMO: src("moComplaints", 228, 2023, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "Oscar Insurance Co.",
      }),
      mlrRebateMO: missing("mlr2024", 2024, NO_MLR_MO),
      qrsOverall: missing("qrsPuf", 2026, NO_QRS),
      priorAuthDenial: missing("kffPriorAuth", 2025, NO_PA),
      ncqa: missing("ncqa2025", 2025, NO_NCQA),
      networkBreadth: missing("kffNetworks", 2021, NO_NETWORK),
    },
  },
  {
    id: "cigna",
    name: "Cigna Healthcare",
    aliases: [
      "Cigna",
      "Cigna Healthcare",
      "Cigna Health and Life Insurance Company",
      "Cigna Health and Life",
      "The Cigna Group",
    ],
    hiosIds: [],
    parent: "The Cigna Group",
    markets: ["employer", "marketplace-other"],
    factors: {
      denialRate: src("kffDenials", 21, 2024, {
        tier: "first-party",
        scope: "parent-national",
        note: "Cigna marketplace plans nationally. Employer plans are not in this data.",
      }),
      complaintIndexMO: src("moComplaints", 106, 2023, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "Cigna Health and Life Insurance Co.",
      }),
      mlrRebateMO: missing("mlr2024", 2024, NO_MLR_MO),
      qrsOverall: missing("qrsPuf", 2026, NO_QRS),
      priorAuthDenial: missing("kffPriorAuth", 2025, NO_PA),
      ncqa: missing("ncqa2025", 2025, NO_NCQA),
      networkBreadth: missing("kffNetworks", 2021, NO_NETWORK),
    },
  },
  {
    id: "aetna",
    name: "Aetna",
    aliases: ["Aetna", "Aetna Life Insurance Company", "Aetna Life", "Aetna CVS Health", "CVS Health"],
    hiosIds: [],
    parent: "CVS Health",
    markets: ["employer"],
    factors: {
      denialRate: missing(
        "kffDenials",
        2024,
        "KFF's 2024 marketplace denial figures in our extract do not include Aetna, and the CMS file covers only marketplace plans.",
      ),
      complaintIndexMO: src("moComplaints", 138, 2023, {
        tier: "first-party",
        scope: "missouri-issuer",
        note: "Aetna Life Insurance Co.",
      }),
      mlrRebateMO: missing("mlr2024", 2024, NO_MLR_MO),
      qrsOverall: missing("qrsPuf", 2026, NO_QRS),
      priorAuthDenial: missing("kffPriorAuth", 2025, NO_PA),
      ncqa: src("beckersNcqa", 3.5, 2025, {
        tier: "secondary",
        scope: "missouri-issuer",
        note: "Tied for highest-rated Missouri commercial plan per Becker's summary of NCQA 2025.",
      }),
      networkBreadth: missing("kffNetworks", 2021, NO_NETWORK),
    },
  },
  {
    id: "molina",
    name: "Molina Healthcare",
    aliases: ["Molina", "Molina Healthcare"],
    hiosIds: [],
    parent: "Molina Healthcare",
    markets: ["marketplace-other"],
    factors: {
      denialRate: src("kffDenials", 22, 2024, {
        tier: "first-party",
        scope: "parent-national",
        note: "Molina marketplace plans nationally.",
      }),
      complaintIndexMO: missing("moComplaints", 2023, NO_COMPLAINT),
      mlrRebateMO: missing("mlr2024", 2024, NO_MLR_MO),
      qrsOverall: missing("qrsPuf", 2026, NO_QRS),
      priorAuthDenial: missing("kffPriorAuth", 2025, NO_PA),
      ncqa: missing("ncqa2025", 2025, NO_NCQA),
      networkBreadth: src("kffNetworks", 35, 2021, {
        tier: "first-party",
        scope: "parent-national",
        note: "Molina marketplace plans nationally.",
      }),
    },
  },
];

/* ------------------------------------------------------------------ */
/* Matching a decoded issuer name to an insurer                        */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set(["the", "of", "and", "inc", "co", "company", "corp", "corporation", "llc"]);

/** Lowercase, "&" to "and", punctuation to spaces, drop filler words. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}

const INDEX: { alias: string; insurer: Insurer }[] = INSURERS.flatMap((ins) =>
  [ins.name, ins.id, ...ins.aliases].map((a) => ({ alias: normalizeName(a), insurer: ins })),
).filter((e) => e.alias.length > 0);

/**
 * Find the insurer behind a plan's issuer name, a brand, a legal entity name,
 * a HIOS issuer ID, or a full plan ID like "95426MO0410021".
 *
 * Returns null when nothing matches or when the name is ambiguous (for
 * example plain "Blue Cross Blue Shield", which could be Anthem or Blue KC).
 */
export function findInsurer(nameOrAlias: string | null | undefined): Insurer | null {
  if (!nameOrAlias) return null;
  const raw = nameOrAlias.trim();

  const hios = raw.match(/^(\d{5})(?:[A-Z]{2}\d*)?(?:-\d+)?$/i);
  if (hios) return INSURERS.find((i) => i.hiosIds.includes(hios[1])) ?? null;

  const q = normalizeName(raw);
  if (!q) return null;

  const exact = INDEX.find((e) => e.alias === q);
  if (exact) return exact.insurer;

  // 1. A known alias appears as whole words inside the query; longest wins.
  const padded = ` ${q} `;
  let best: { len: number; insurer: Insurer } | null = null;
  let tie = false;
  for (const e of INDEX) {
    if (!padded.includes(` ${e.alias} `)) continue;
    const len = e.alias.length;
    if (!best || len > best.len) {
      best = { len, insurer: e.insurer };
      tie = false;
    } else if (len === best.len && best.insurer !== e.insurer) {
      tie = true;
    }
  }
  if (best) return tie ? null : best.insurer;

  // 2. The query is a fragment of an alias ("Home State"); only if one insurer fits.
  if (q.length >= 4) {
    const owners = new Set(INDEX.filter((e) => ` ${e.alias} `.includes(padded)).map((e) => e.insurer));
    if (owners.size === 1) return [...owners][0];
    if (owners.size > 1) return null;
  }

  // Squashed spellings like "bluekc" or "unitedhealthcare".
  const squashed = q.replace(/ /g, "");
  const sq = INDEX.find((e) => e.alias.replace(/ /g, "") === squashed);
  return sq ? sq.insurer : null;
}
