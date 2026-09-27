/**
 * The guide's grounded answers. Each one is checked against a public source,
 * names no dollar figure the engine did not compute, and ends at a person.
 * The Ask room answers from here first, instantly and offline, and only asks
 * Gemini when nothing here fits.
 */

export type Faq = {
  id: string;
  q: string;
  keys: string[];
  a: string;
  /** Person ids from kb/people.ts. */
  people: string[];
  /** A room in the app that goes deeper. */
  room?: "rx" | "denied" | "ambulance" | "care" | "compare" | "year";
  source: string;
};

export const FAQ: Faq[] = [
  {
    id: "cash-deductible",
    q: "Does paying cash for a prescription count toward my deductible?",
    keys: ["cash", "goodrx", "coupon", "discount card", "count toward", "pharmacy"],
    a: "Usually not. A cash or coupon purchase never goes through your plan, so it does not move your deductible or your out-of-pocket maximum. That is why the cheaper price today can lose over a whole year. Some plans will count it if you mail in the receipt, so ask. The Rx room runs both paths through your year.",
    people: ["insurer"],
    room: "rx",
    source: "How deductibles work under ACA plans",
  },
  {
    id: "out-of-network-er",
    q: "I went to an out-of-network ER. What do I owe?",
    keys: ["out of network er", "out-of-network er", "surprise bill", "emergency room bill", "er bill", "no surprises"],
    a: "The federal No Surprises Act protects you here. For emergency care, your plan must charge you the same copay, coinsurance and deductible as it would in network, and the hospital cannot bill you the difference. Ground ambulances are the big exception. If you got a bill above your normal cost sharing, call the billing office and mention the No Surprises Act.",
    people: ["billing", "insurer"],
    room: "ambulance",
    source: "CMS, No Surprises Act consumer protections",
  },
  {
    id: "parents-plan-26",
    q: "Can I stay on my parent's plan?",
    keys: ["parent", "parents", "until 26", "age 26", "turn 26", "stay on", "dependent"],
    a: "Yes, until you turn 26, whether or not you are in school, married, living at home, or claimed on their taxes. That is federal law. Losing that coverage at 26 opens a 60-day window to buy a marketplace plan, and a job or Medicaid also work. Put the birthday on a calendar: nobody reminds you.",
    people: ["insurer"],
    room: "compare",
    source: "HealthCare.gov, young adult coverage",
  },
  {
    id: "prior-auth",
    q: "My claim says CO-197 or prior authorization. What now?",
    keys: ["co-197", "197", "prior auth", "prior authorization", "precert", "pre-authorization"],
    a: "It means approval was needed before the service and nobody got it. Often the office forgot to ask, which makes it a paperwork problem, not a medical one. Call the provider's billing office first and ask them to request the approval and resubmit. If that fails, appeal. The Denied room writes the letter and finds your deadline.",
    people: ["billing", "insurer"],
    room: "denied",
    source: "X12 claim adjustment reason code 197",
  },
  {
    id: "self-funded",
    q: "What does self-funded mean for me?",
    keys: ["self-funded", "self funded", "self-insured", "erisa", "tpa", "administered by"],
    a: "Your employer, or your parent's employer, pays the claims itself and hires an insurance company to run the paperwork. About two in three covered workers are in plans like this. State insurance laws usually do not apply to them, so complaints go to the U.S. Department of Labor, not the state. Your plan summary often says so near the top.",
    people: ["ebsa"],
    room: "denied",
    source: "KFF 2025 Employer Health Benefits Survey; U.S. Department of Labor",
  },
  {
    id: "hospital-bill",
    q: "Can the hospital lower my bill?",
    keys: ["lower my bill", "reduce", "charity", "financial assistance", "can't pay", "cannot pay", "payment plan", "hospital bill"],
    a: "Often, yes. Nonprofit hospitals must have a written financial assistance policy, publicize it, and limit what they charge people who qualify. Each hospital sets its own income rules, so ask for the policy and ask them to screen you before you pay anything. Ask for an itemized bill too. Mistakes are common.",
    people: ["assistance", "billing"],
    room: "care",
    source: "IRS, section 501(r) financial assistance policies",
  },
  {
    id: "ambulance-bill",
    q: "Why is my ambulance bill so high?",
    keys: ["ambulance", "ems", "ambulance bill"],
    a: "Federal surprise billing law covers emergency rooms and air ambulances but left out ground ambulances. An out-of-network ambulance company can bill you the difference unless your state stepped in, and state laws never reach self-funded employer plans. Appeal through your plan first, then ask the ambulance service about a hardship reduction. The Ambulance room shows your state.",
    people: ["insurer", "billing"],
    room: "ambulance",
    source: "Commonwealth Fund, 2026; healthinsurance.org",
  },
  {
    id: "hsa",
    q: "Can I use an HSA with my plan?",
    keys: ["hsa", "health savings", "hdhp", "high deductible"],
    a: "Only with an HSA-eligible plan. For 2026 that means a deductible of at least $1,700 for one person, and you can put in up to $4,400, or $8,750 for a family. New for 2026, bronze and catastrophic marketplace plans count as HSA-eligible. Money in an HSA is never taxed if you spend it on care, and it stays yours.",
    people: ["insurer"],
    source: "IRS Rev. Proc. 2025-19; One Big Beautiful Bill Act, section 71307",
  },
  {
    id: "tax-credit",
    q: "Will I owe back my marketplace tax credit?",
    keys: ["tax credit", "subsidy", "aptc", "1095-a", "8962", "pay back", "repay", "clawback"],
    a: "Possibly. The credit is based on the income you expect. If you earn more, you settle the difference on Form 8962 when you file. Starting with tax year 2026 there is no longer a cap on how much you may have to repay, so update your income on HealthCare.gov as soon as it changes. Free tax help (VITA) can walk you through the form.",
    people: ["insurer"],
    room: "compare",
    source: "One Big Beautiful Bill Act; IRS Form 8962 instructions",
  },
  {
    id: "medicaid",
    q: "How does MO HealthNet work?",
    keys: ["medicaid", "mo healthnet", "healthnet", "mo health net"],
    a: "MO HealthNet is Missouri's Medicaid. Most services cost little or nothing, but networks and prior approval still apply, so use doctors your MO HealthNet plan lists. If you lose coverage you get a special window to buy a marketplace plan. MO HealthNet constituent services can answer coverage questions.",
    people: ["moHealthNet"],
    source: "Missouri Department of Social Services",
  },
  {
    id: "deductible",
    q: "What is a deductible, and what is the out-of-pocket max?",
    keys: ["what is a deductible", "deductible mean", "out-of-pocket max", "out of pocket max", "oop", "ceiling", "maximum"],
    a: "The deductible is what you pay in full for covered care before your plan starts sharing the cost. The out-of-pocket maximum is the ceiling: once your payments for covered, in-network care reach it, the plan pays 100% for the rest of the year. Premiums do not count toward either. Both reset on January 1.",
    people: ["insurer"],
    room: "year",
    source: "HealthCare.gov glossary",
  },
  {
    id: "copay-coinsurance",
    q: "What is the difference between a copay and coinsurance?",
    keys: ["copay", "co-pay", "coinsurance", "co-insurance"],
    a: "A copay is a flat fee, like a set amount for a visit. Coinsurance is a percent of the price, like 20%, usually after your deductible. Copays are predictable. Coinsurance grows with the bill, which is why a scan or a hospital stay can cost far more than a visit.",
    people: ["insurer"],
    room: "year",
    source: "HealthCare.gov glossary",
  },
  {
    id: "preventive",
    q: "Is my yearly physical free?",
    keys: ["physical", "checkup", "check-up", "preventive", "screening", "vaccine", "flu shot"],
    a: "On most plans, yes: recommended preventive care from an in-network doctor has no copay or deductible. The catch is that a problem discussed during the visit can be billed as a regular visit. Ask the office before they start. With no insurance, preventive care costs full price.",
    people: ["insurer"],
    room: "year",
    source: "ACA section 2713; HealthCare.gov preventive services",
  },
  {
    id: "in-network",
    q: "How do I know if a doctor is in network?",
    keys: ["in network", "in-network", "network", "accept my insurance", "take my insurance"],
    a: "Check your insurer's online directory, then call the office and ask whether they are in network for your exact plan name, not just the insurance company. Directories are often wrong, so write down who you spoke with and when. Find care marks each place and prices a visit on your plan.",
    people: ["insurer"],
    room: "care",
    source: "Standard practice",
  },
];

/** Starter questions shown as chips. */
export const STARTERS = ["cash-deductible", "parents-plan-26", "self-funded", "hospital-bill", "ambulance-bill", "hsa"];
