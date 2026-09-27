/**
 * People to call. Every path in the app ends at one of these.
 *
 * Numbers marked with a source were checked against the agency's own page or
 * a published notice in September 2026. Entries without a number point to a
 * number the visitor already has (their card, their bill).
 */

import type { KbRow } from "./types";

export type Person = KbRow & {
  name: string;
  phone: string | null;
  url: string | null;
  /** One line: when this is the right person. */
  when: string;
};

export const PEOPLE: Record<string, Person> = {
  billing: {
    id: "billing",
    name: "The provider's billing office",
    phone: null,
    url: null,
    when: "The number is on your bill. Best first call for coding mistakes, missing information, or a claim sent to the wrong plan.",
    sample: false,
    source: { name: "Standard practice" },
  },
  insurer: {
    id: "insurer",
    name: "Your insurer's member services",
    phone: null,
    url: null,
    when: "The number is on the back of your card. Ask for the appeals process and a copy of your claim file.",
    sample: false,
    source: { name: "Standard practice" },
  },
  moDci: {
    id: "moDci",
    name: "Missouri Department of Commerce and Insurance",
    phone: "800-726-7390",
    url: "https://insurance.mo.gov/consumers/complaints/index.php",
    when: "Free help with a plan an insurance company sells in Missouri, including marketplace plans and most small-employer plans. Weekdays 8 to 5.",
    sample: false,
    source: { name: "Missouri Department of Insurance, complaints page", url: "https://insurance.mo.gov/consumers/complaints/index.php", asOf: "2026-09" },
  },
  ebsa: {
    id: "ebsa",
    name: "U.S. Department of Labor, benefits advisors (EBSA)",
    phone: "866-444-3272",
    url: "https://askebsa.dol.gov",
    when: "Free help when your employer pays claims itself (a self-funded plan). State insurance departments usually cannot step in for these plans.",
    sample: false,
    source: { name: "U.S. Department of Labor, EBSA", url: "https://askebsa.dol.gov", asOf: "2026-09" },
  },
  nurse: {
    id: "nurse",
    name: "Your plan's 24-hour nurse line",
    phone: null,
    url: null,
    when: "Most plans have one; the number is on the back of your card. A nurse can help you decide where to go. This app cannot.",
    sample: false,
    source: { name: "Standard practice" },
  },
  moHealthNet: {
    id: "moHealthNet",
    name: "MO HealthNet constituent services",
    phone: "800-392-2161",
    url: "https://mydss.mo.gov/mhd",
    when: "Questions about Missouri Medicaid coverage, your health plan, or a bill.",
    sample: false,
    source: { name: "Missouri Department of Social Services, toll free numbers", url: "https://dss.mo.gov/toll.htm", asOf: "2026-09" },
  },
  assistance: {
    id: "assistance",
    name: "The hospital's financial assistance office",
    phone: null,
    url: null,
    when: "Nonprofit hospitals must have a written financial assistance policy. Ask for it and ask them to screen you before you pay.",
    sample: false,
    source: { name: "IRS, section 501(r)", url: "https://www.irs.gov/charities-non-profits/financial-assistance-policies-faps" },
  },
  crisis: {
    id: "crisis",
    name: "988 Suicide and Crisis Lifeline",
    phone: "988",
    url: "https://988lifeline.org",
    when: "Call or text any time, free.",
    sample: false,
    source: { name: "988 Lifeline", url: "https://988lifeline.org" },
  },
  emergency: {
    id: "emergency",
    name: "Emergency services",
    phone: "911",
    url: null,
    when: "Any emergency. Cost questions can wait.",
    sample: false,
    source: { name: "Standard practice" },
  },
};
