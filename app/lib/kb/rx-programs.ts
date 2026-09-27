/**
 * Cash and assistance programs for prescriptions, each with its source.
 *
 * Static on purpose: these change a few times a year, and every row names the
 * page it came from and when it was read. `verified` means that page was
 * fetched and said what the row says on `source.asOf`. `reported` means the
 * figure comes from a news story or secondhand report, so the interface should
 * say "reported" next to it.
 *
 * Eligibility text is phrased as the program phrases it. We never ask the
 * visitor for income, insurance type or anything else to "check" eligibility:
 * the row says who it is for and links out.
 */

import type { Citation } from "./types";

export type DeductibleCredit = "no" | "usually-no" | "yes" | "ask-plan";

export type RxProgram = {
  id: string;
  kind: "program" | "manufacturer";
  title: string;
  seller: string;
  /** Which drugs the row applies to. An empty match applies to every drug. */
  match: {
    /** Applies to generic drugs in general (the list itself varies). */
    generics?: boolean;
    /** Lowercase ingredient names (RxNorm spelling), any one matches. */
    ingredients?: string[];
    /** Lowercase brand names, any one matches. */
    brands?: string[];
    /** Only inhaled forms (inhaler caps). These rows list brands only: the caps do not cover other makers' generics. */
    inhaledOnly?: boolean;
  };
  /** Price for up to 30 days, or null when there is no single price. */
  price30: number | null;
  /** Price for a 90 day supply when the program sets one. */
  price90?: number | null;
  /** True when the price is a monthly fee that covers every eligible drug at once. */
  subscription?: boolean;
  priceNote: string;
  eligibility: string;
  countsTowardDeductible: DeductibleCredit;
  privacy: string;
  source: Citation & { url: string };
  verified: boolean;
  reported?: boolean;
};

const AS_OF = "2026-09";

/**
 * Cash, coupon and manufacturer purchases usually do not count toward an
 * insurance deductible or out-of-pocket maximum unless the plan accepts a
 * receipt. Shown next to every cash row.
 */
export const DEDUCTIBLE_NOTE =
  "Paying cash or with a discount program usually does not count toward your insurance deductible or out-of-pocket maximum. Some plans accept a receipt: ask your plan before you rely on it.";

export const RX_PROGRAMS: RxProgram[] = [
  // ---------------------------------------------------------------- generics
  {
    id: "amazon-rxpass",
    kind: "program",
    title: "Amazon RxPass, if your drug is on its list",
    seller: "Amazon Pharmacy",
    match: { generics: true },
    price30: 5,
    subscription: true,
    priceNote: "$5 a month covers every eligible generic you take, only if this drug is on the RxPass list.",
    eligibility: "Prime members. Not available with Medicaid or CHIP, and not available in some states (California and Washington were excluded when last checked). Check the RxPass list for your drug.",
    countsTowardDeductible: "usually-no",
    privacy: "Amazon account required; Amazon sees your prescriptions.",
    source: { name: "Amazon Pharmacy, RxPass", url: "https://pharmacy.amazon.com/rxpass", asOf: AS_OF },
    verified: false,
  },
  {
    id: "walmart-4",
    kind: "program",
    title: "Walmart $4 generics, if your drug is on the list",
    seller: "Walmart Pharmacy",
    match: { generics: true },
    price30: 4,
    price90: 10,
    priceNote: "$4 for up to 30 days or $10 for 90 days, only if this drug and strength are on Walmart's list. The list varies by state.",
    eligibility: "Anyone with a prescription. Check the current list for your drug and strength.",
    countsTowardDeductible: "usually-no",
    privacy: "In-store pharmacy; no account needed to ask for the cash price.",
    source: {
      name: "Walmart, 20 years of $4 prescriptions",
      url: "https://corporate.walmart.com/news/2026/09/20-Years-of-Walmarts-4-Dollar-Prescriptions",
      asOf: AS_OF,
    },
    verified: false,
  },
  {
    id: "costco-pharmacy",
    kind: "program",
    title: "Costco pharmacy cash price",
    seller: "Costco Pharmacy",
    match: { generics: true },
    price30: null,
    priceNote: "Cash prices vary by drug and store. Call the pharmacy for a quote.",
    eligibility: "Reported usable without a Costco membership in most states (pharmacy access is required by law in many states).",
    countsTowardDeductible: "usually-no",
    privacy: "In-store pharmacy; ask for the cash price by phone.",
    source: { name: "Costco Pharmacy", url: "https://www.costco.com/pharmacy/home-delivery", asOf: AS_OF },
    verified: false,
    reported: true,
  },
  {
    id: "hyvee-generics",
    kind: "program",
    title: "Hy-Vee discounted generics, if listed",
    seller: "Hy-Vee Pharmacy (Missouri and the Midwest)",
    match: { generics: true },
    price30: 4,
    price90: 10,
    priceNote: "Reported $4 for 30 days or $10 for 90 days on listed generics. Date of the list unknown; confirm at the counter.",
    eligibility: "Anyone with a prescription at a Hy-Vee pharmacy. Check the list for your drug.",
    countsTowardDeductible: "usually-no",
    privacy: "In-store pharmacy.",
    source: { name: "Hy-Vee Pharmacy", url: "https://www.hy-vee.com/health/pharmacy", asOf: AS_OF },
    verified: false,
    reported: true,
  },

  // ------------------------------------------------------------ manufacturer
  {
    id: "eliquis-copay-card",
    kind: "manufacturer",
    title: "Eliquis co-pay card",
    seller: "Bristol Myers Squibb and Pfizer",
    match: { ingredients: ["apixaban"], brands: ["eliquis"] },
    price30: 10,
    priceNote: "As little as $10 a month with commercial insurance, up to program limits.",
    eligibility: "Commercial (job or marketplace) insurance only. Not for Medicare, Medicaid or other government coverage.",
    countsTowardDeductible: "ask-plan",
    privacy: "Enrollment collects your name and contact details.",
    source: { name: "Eliquis co-pay card", url: "https://www.eliquis.com/eliquis/hcp/copay-card", asOf: AS_OF },
    verified: false,
  },
  {
    id: "eliquis-direct",
    kind: "manufacturer",
    title: "Eliquis direct cash price",
    seller: "Bristol Myers Squibb and Pfizer",
    match: { ingredients: ["apixaban"], brands: ["eliquis"] },
    price30: 346,
    priceNote: "$346 for a 30 day supply, paid in cash direct from the maker.",
    eligibility: "Anyone with a prescription, including uninsured people. Not billed to insurance.",
    countsTowardDeductible: "usually-no",
    privacy: "Order through the maker's program; they see the prescription.",
    source: { name: "Eliquis 360 Support", url: "https://www.eliquis.com/eliquis/hcp/eliquis-360-support", asOf: AS_OF },
    verified: false,
  },
  {
    id: "novocare-ozempic",
    kind: "manufacturer",
    title: "Ozempic self-pay (NovoCare Pharmacy)",
    seller: "Novo Nordisk",
    match: { ingredients: ["semaglutide"], brands: ["ozempic"] },
    price30: 349,
    priceNote: "$349 a month for most doses, $499 for the 2 mg dose.",
    eligibility: "Self-pay, not billed to insurance.",
    countsTowardDeductible: "usually-no",
    privacy: "Order through NovoCare Pharmacy; they see the prescription.",
    source: { name: "NovoCare Pharmacy", url: "https://www.novocare.com/", asOf: AS_OF },
    verified: false,
  },
  {
    id: "novocare-wegovy",
    kind: "manufacturer",
    title: "Wegovy self-pay (NovoCare Pharmacy)",
    seller: "Novo Nordisk",
    match: { ingredients: ["semaglutide"], brands: ["wegovy"] },
    price30: 349,
    priceNote: "$349 a month; an introductory $199 offer has been available for the first fills.",
    eligibility: "Self-pay, not billed to insurance.",
    countsTowardDeductible: "usually-no",
    privacy: "Order through NovoCare Pharmacy; they see the prescription.",
    source: { name: "NovoCare Pharmacy", url: "https://www.novocare.com/", asOf: AS_OF },
    verified: false,
  },
  {
    id: "inhaler-cap-astrazeneca",
    kind: "manufacturer",
    title: "AstraZeneca $35 inhaler cap",
    seller: "AstraZeneca",
    match: { inhaledOnly: true, brands: ["symbicort", "breztri", "airsupra", "bevespi"] },
    price30: 35,
    priceNote: "$35 a month for eligible AstraZeneca inhalers.",
    eligibility: "Uninsured and underinsured patients; terms vary by insurance. Check the program page.",
    countsTowardDeductible: "ask-plan",
    privacy: "Enrollment collects your contact details.",
    source: { name: "AstraZeneca inhaler savings", url: "https://www.azandmeapp.com/", asOf: AS_OF },
    verified: false,
  },
  {
    id: "inhaler-cap-bi",
    kind: "manufacturer",
    title: "Boehringer Ingelheim $35 inhaler cap",
    seller: "Boehringer Ingelheim",
    match: { inhaledOnly: true, brands: ["spiriva", "combivent", "atrovent", "stiolto", "striverdi"] },
    price30: 35,
    priceNote: "$35 a month out of pocket for eligible inhalers since June 2024.",
    eligibility: "Eligible patients, including many commercially insured and uninsured. Check the program page.",
    countsTowardDeductible: "ask-plan",
    privacy: "Enrollment collects your contact details.",
    source: { name: "Boehringer Ingelheim inhaler cap", url: "https://www.boehringer-ingelheim.com/", asOf: AS_OF },
    verified: false,
  },
  {
    id: "inhaler-cap-gsk",
    kind: "manufacturer",
    title: "GSK $35 inhaler cap",
    seller: "GSK",
    match: { inhaledOnly: true, brands: ["advair", "anoro", "arnuity", "breo", "incruse", "serevent", "trelegy", "ventolin", "flovent"] },
    price30: 35,
    priceNote: "$35 a month out of pocket for eligible GSK inhalers since January 2025.",
    eligibility: "Eligible patients; check the program page for insurance rules.",
    countsTowardDeductible: "ask-plan",
    privacy: "Enrollment collects your contact details.",
    source: { name: "GSK inhaler cap", url: "https://www.gsk.com/", asOf: AS_OF },
    verified: false,
  },

  // --------------------------------------------------------- finders (links)
  {
    id: "phrma-mat",
    kind: "program",
    title: "Medicine Assistance Tool (PhRMA)",
    seller: "PhRMA",
    match: {},
    price30: null,
    priceNote: "Search tool for maker assistance programs. Prices depend on the program.",
    eligibility: "Depends on the program. This app never asks for your income; the tool does that on its own site.",
    countsTowardDeductible: "ask-plan",
    privacy: "Link out; nothing from this app is sent.",
    source: { name: "PhRMA Medicine Assistance Tool", url: "https://medicineassistancetool.org/", asOf: AS_OF },
    verified: false,
  },
  {
    id: "needymeds",
    kind: "program",
    title: "NeedyMeds",
    seller: "NeedyMeds (nonprofit)",
    match: {},
    price30: null,
    priceNote: "Nonprofit directory of assistance programs and clinics.",
    eligibility: "Depends on the program.",
    countsTowardDeductible: "ask-plan",
    privacy: "Link out; nothing from this app is sent.",
    source: { name: "NeedyMeds", url: "https://www.needymeds.org/", asOf: AS_OF },
    verified: false,
  },
];

/**
 * Typical pharmacy dispensing fee used for the insurance placeholder row.
 * An estimate, not a quote.
 */
export const DISPENSING_FEE = {
  amount: 10.5,
  note: "Estimate. State Medicaid professional dispensing fees mostly fall around $10 to $12 per prescription; commercial plans usually pay less.",
  source: {
    name: "Medicaid.gov, covered outpatient drug reimbursement by state",
    url: "https://www.medicaid.gov/medicaid/prescription-drugs/state-prescription-drug-resources/medicaid-covered-outpatient-prescription-drug-reimbursement-information-state",
    asOf: AS_OF,
  },
  verified: false,
};
