/**
 * Denied claims: read the letter, sort it, find the deadline, name the person
 * to call, and draft the appeal.
 *
 * The AI only reads the document and sorts the reason into a category, using
 * the letter's own words. Dates, routing and the letter itself are
 * deterministic code in this file. Nothing here gives a medical opinion.
 */

import { PEOPLE, type Person } from "./kb/people";

export type DenialKind =
  | "paperwork"
  | "prior_auth"
  | "not_covered"
  | "medical_necessity"
  | "out_of_network"
  | "unclear";

export type Denial = {
  insurer: string | null;
  claimNumber: string | null;
  provider: string | null;
  service: string | null;
  serviceDate: string | null;
  /** The date on the denial notice. The appeal clock starts here. */
  noticeDate: string | null;
  billed: number | null;
  denied: number | null;
  reasonQuote: string | null;
  codes: string[];
  kind: DenialKind;
  deadlineQuote: string | null;
  appealContact: string | null;
  selfFunded: boolean | null;
  source: "upload" | "sample";
};

export const KIND_LABEL: Record<DenialKind, string> = {
  paperwork: "Paperwork problem",
  prior_auth: "Missing prior approval",
  not_covered: "Plan says it's not covered",
  medical_necessity: "Plan says it wasn't necessary",
  out_of_network: "Out of network",
  unclear: "Reason not clear",
};

/** What to do first, per kind. Plain steps, no medical judgment. */
export const FIRST_MOVE: Record<DenialKind, string[]> = {
  paperwork: [
    "Call the provider's billing office first. Many of these are a wrong code, a missing number, or the wrong insurer on file, and they fix it by sending the claim again.",
    "Still file the appeal if the deadline is close. It keeps your rights open while the billing office works on it.",
  ],
  prior_auth: [
    "Call your doctor's office and ask them to request approval after the fact (a retroactive authorization).",
    "File the appeal at the same time, so the deadline does not pass while you wait.",
  ],
  not_covered: [
    "Ask your insurer for the exact plan wording they used to deny it. You have a right to it for free.",
    "Appeal if the service matches something your plan summary lists as covered.",
  ],
  medical_necessity: [
    "Ask your doctor for a letter explaining why you needed it. That letter carries more weight than anything you write yourself.",
    "Appeal with the doctor's letter attached. If the insurer says no again, you can usually ask for an independent outside review.",
  ],
  out_of_network: [
    "Check whether it was an emergency or a provider you did not choose, like an anesthesiologist at an in-network hospital. The No Surprises Act protects many of those bills.",
    "Ask the insurer to reprocess it at in-network rates, then appeal if they refuse.",
  ],
  unclear: [
    "Call your insurer and ask them to explain the denial in plain words and send you the claim file.",
    "File the appeal anyway to protect the deadline.",
  ],
};

/**
 * Appeal deadline: 180 days from the notice for the internal appeal, the
 * federal minimum for ACA-compliant plans. If the letter states its own date,
 * the interface shows that quote next to this one.
 */
export function appealDeadline(noticeDate: string | null): string | null {
  if (!noticeDate || !/^\d{4}-\d{2}-\d{2}$/.test(noticeDate)) return null;
  const d = new Date(`${noticeDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 180);
  return d.toISOString().slice(0, 10);
}

export function daysLeft(deadline: string | null, today: Date = new Date()): number | null {
  if (!deadline) return null;
  const end = Date.parse(`${deadline}T23:59:59Z`);
  return Math.max(0, Math.ceil((end - today.getTime()) / 86_400_000));
}

/** Who to call, in order. Every path ends at a person. */
export function whoToCall(d: Denial): Person[] {
  const first = d.kind === "paperwork" ? [PEOPLE.billing, PEOPLE.insurer] : [PEOPLE.insurer, PEOPLE.billing];
  const regulator =
    d.selfFunded === true ? [PEOPLE.ebsa] : d.selfFunded === false ? [PEOPLE.moDci] : [PEOPLE.moDci, PEOPLE.ebsa];
  return [...first, ...regulator];
}

export const fmtDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : "[date]";

/** The appeal letter. A template filled from the document, never generated. */
export function appealLetter(d: Denial, you: { name: string; memberId: string; today: string }): string {
  const v = (x: string | null | undefined, blank: string) => (x && x.trim() ? x.trim() : blank);
  return [
    you.today,
    "",
    `${v(d.insurer, "[Insurance company]")}`,
    "Appeals Department",
    `${v(d.appealContact, "[Appeals address from your denial letter]")}`,
    "",
    `Re: Request for internal appeal`,
    `Member: ${v(you.name, "[Your name]")}`,
    `Member ID: ${v(you.memberId, "[Member ID from your card]")}`,
    `Claim number: ${v(d.claimNumber, "[Claim number]")}`,
    `Service: ${v(d.service, "[Service]")}${d.serviceDate ? `, on ${fmtDate(d.serviceDate)}` : ""}`,
    `Provider: ${v(d.provider, "[Provider]")}`,
    "",
    "To whom it may concern,",
    "",
    `I am appealing the denial of the claim above${d.noticeDate ? `, described in your notice dated ${fmtDate(d.noticeDate)}` : ""}.` +
      (d.reasonQuote ? ` The notice gives this reason: "${d.reasonQuote.replace(/[.\s]+$/, "")}."` : ""),
    "",
    "I ask that you reconsider this claim. Please also send me, free of charge:",
    "1. A copy of my complete claim file.",
    "2. The specific plan provision, guideline, or criteria used to make this decision.",
    "3. The name and qualifications of any reviewer who took part in the decision.",
    "",
    "I will send any additional records from my provider as soon as I receive them. Please confirm in writing that you received this appeal, and tell me the date by which you will decide.",
    "",
    "Sincerely,",
    v(you.name, "[Your name]"),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------

const text = (description: string) => ({ type: ["string", "null"], description });

export const DENIAL_SCHEMA = {
  type: "object",
  properties: {
    is_denial: { type: "boolean", description: "False if this is not a claim denial or explanation of benefits." },
    insurer: text("Insurance company name."),
    claim_number: text("Claim number as printed."),
    provider: text("Doctor, hospital or lab that billed."),
    service: text("The service or item that was denied, in the document's words, under 10 words."),
    service_date: text("Date of service as YYYY-MM-DD."),
    notice_date: text("Date of this notice as YYYY-MM-DD."),
    billed: { type: ["number", "null"], description: "Amount billed in dollars, as printed." },
    denied: { type: ["number", "null"], description: "Amount denied or owed by the member in dollars, as printed." },
    reason_quote: text("The denial reason, quoted exactly, under 40 words."),
    codes: { type: "array", items: { type: "string" }, description: "Any reason or remark codes printed, e.g. CO-197, N130." },
    kind: {
      type: "string",
      enum: ["paperwork", "prior_auth", "not_covered", "medical_necessity", "out_of_network", "unclear"],
      description:
        "Sort the stated reason, using only the document's words: paperwork (coding, missing information, duplicate, eligibility, other insurance), prior_auth, not_covered (exclusion or benefit limit), medical_necessity, out_of_network, or unclear.",
    },
    deadline_quote: text("The appeal deadline sentence, quoted exactly."),
    appeal_contact: text("Where to send an appeal: address, fax or phone, as printed."),
    self_funded: {
      type: ["boolean", "null"],
      description: "True if the document says the plan is self-funded or employer-funded, false if insured, null if not stated.",
    },
  },
  required: ["is_denial", "kind", "codes"],
} as const;

export const DENIAL_SYSTEM = [
  "You read health insurance denial letters and explanations of benefits and record what they say.",
  "Copy facts exactly as printed. If something is missing or unclear, use null.",
  "Sort the denial reason using only the document's own words.",
  "Never give medical opinions, never judge whether the care was needed, never add facts.",
].join(" ");

export class NotADenial extends Error {}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const money = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 10_000_000 ? Math.round(v * 100) / 100 : null;
const KINDS: DenialKind[] = ["paperwork", "prior_auth", "not_covered", "medical_necessity", "out_of_network", "unclear"];

export function sanitizeDenial(raw: unknown): Denial {
  const o = obj(raw);
  if (o.is_denial === false) throw new NotADenial("This does not look like a denial letter or explanation of benefits.");
  return {
    insurer: str(o.insurer, 100),
    claimNumber: str(o.claim_number, 40),
    provider: str(o.provider, 100),
    service: str(o.service, 100),
    serviceDate: iso(o.service_date),
    noticeDate: iso(o.notice_date),
    billed: money(o.billed),
    denied: money(o.denied),
    reasonQuote: str(o.reason_quote, 300),
    codes: Array.isArray(o.codes) ? o.codes.filter((c): c is string => typeof c === "string").map((c) => c.slice(0, 12)).slice(0, 8) : [],
    kind: KINDS.includes(o.kind as DenialKind) ? (o.kind as DenialKind) : "unclear",
    deadlineQuote: str(o.deadline_quote, 300),
    appealContact: str(o.appeal_contact, 200),
    selfFunded: typeof o.self_funded === "boolean" ? o.self_funded : null,
    source: "upload",
  };
}

/**
 * A sample denial for the demo, from a made-up insurer. CARC 197 is the real
 * standard code for "precertification/authorization/notification absent".
 */
export const SAMPLE_DENIAL: Denial = {
  insurer: "Example Health Plan",
  claimNumber: "EHP-2026-0418273",
  provider: "Columbia Imaging Center",
  service: "MRI, lumbar spine without contrast",
  serviceDate: "2026-08-21",
  noticeDate: "2026-09-10",
  billed: 1850,
  denied: 1200,
  reasonQuote: "Precertification/authorization/notification absent. This service required approval before it was provided.",
  codes: ["CO-197"],
  kind: "prior_auth",
  deadlineQuote: "You have 180 days from the date of this notice to request an appeal.",
  appealContact: "PO Box 1234, Columbia, MO 65201. Fax 555-0100",
  selfFunded: null,
  source: "sample",
};

/** What the insurer's reason usually means, per kind, in plain words. */
export const PLAIN_REASON: Record<DenialKind, string> = {
  paperwork: "A billing mistake, not a judgment about your care. A wrong code or a missing number. The office can usually resend it.",
  prior_auth: "Nobody asked the plan for permission before the service. That's usually the office's job, not yours.",
  not_covered: "They say your plan excludes this. Check your plan summary: if it's listed as covered, they're wrong.",
  medical_necessity: "A reviewer decided you didn't need it. Your doctor's letter is the strongest answer to that.",
  out_of_network: "They say the provider wasn't in your network. If you didn't choose them, federal law often protects you.",
  unclear: "They didn't say clearly why. You're allowed to make them explain.",
};

/**
 * One sample letter per kind, all from the same made-up insurer, so the room
 * can show how each reason reads and what to do. The CARC codes are the real
 * standard codes for each reason. The amounts are what a letter would print,
 * shown as the document's own numbers, not computed by the app.
 */
export const SAMPLE_DENIALS: Record<Exclude<DenialKind, "unclear">, Denial> = {
  prior_auth: SAMPLE_DENIAL,
  paperwork: {
    ...SAMPLE_DENIAL,
    claimNumber: "EHP-2026-0391552",
    provider: "Broadway Urgent Care",
    service: "Urgent care visit, level 3",
    serviceDate: "2026-08-02",
    noticeDate: "2026-08-29",
    billed: 285,
    denied: 285,
    reasonQuote: "Claim/service lacks information or has submission/billing error(s).",
    codes: ["CO-16", "N290"],
    kind: "paperwork",
  },
  out_of_network: {
    ...SAMPLE_DENIAL,
    claimNumber: "EHP-2026-0402918",
    provider: "Mid-Missouri Anesthesia Associates",
    service: "Anesthesia for knee arthroscopy, at an in-network hospital",
    serviceDate: "2026-07-14",
    noticeDate: "2026-09-02",
    billed: 2400,
    denied: 2400,
    reasonQuote: "Services not provided by network/primary care providers.",
    codes: ["CO-242"],
    kind: "out_of_network",
  },
  medical_necessity: {
    ...SAMPLE_DENIAL,
    claimNumber: "EHP-2026-0417730",
    provider: "Tiger Physical Therapy",
    service: "Physical therapy after ACL repair, visits 13 to 24",
    serviceDate: "2026-08-11",
    noticeDate: "2026-09-08",
    billed: 1560,
    denied: 1560,
    reasonQuote: "These are non-covered services because this is not deemed a 'medical necessity' by the payer.",
    codes: ["CO-50"],
    kind: "medical_necessity",
  },
  not_covered: {
    ...SAMPLE_DENIAL,
    claimNumber: "EHP-2026-0385104",
    provider: "Columbia Allergy and Asthma",
    service: "Allergy skin testing, 40 allergens",
    serviceDate: "2026-07-28",
    noticeDate: "2026-08-20",
    billed: 640,
    denied: 640,
    reasonQuote: "Non-covered charge(s). This service is not a covered benefit under the member's plan.",
    codes: ["CO-96"],
    kind: "not_covered",
  },
};
