/**
 * Ground ambulance surprise-billing protections by state.
 *
 * The federal No Surprises Act covers emergency rooms and air ambulances but
 * leaves out ground ambulances. Some states filled the gap for plans they
 * regulate. None of these laws reach self-funded employer plans, which only
 * federal law governs.
 *
 * List: 23 states as of February 18, 2026 (healthinsurance.org, drawing on
 * Commonwealth Fund tracking). "Partial" marks the four states whose law only
 * covers part of the market: Colorado and Maryland protect only against
 * private ambulance services, and Florida and West Virginia only for HMOs.
 */

import type { Citation } from "./types";

export type AmbulanceStatus = "protected" | "partial" | "none";

export type StateRow = {
  id: string;
  name: string;
  /** Position on an 11 by 8 tile grid shaped roughly like the country. */
  col: number;
  row: number;
  status: AmbulanceStatus;
  note?: string;
};

export const AMBULANCE_SOURCE: Citation = {
  name: "healthinsurance.org, No Surprises Act glossary, citing Commonwealth Fund state tracking",
  url: "https://www.healthinsurance.org/glossary/no-surprises-act/",
  asOf: "2026-02-18",
};

const PROTECTED = new Set([
  "AL", "AR", "CA", "DE", "IL", "IN", "LA", "ME", "MS", "NH", "NY", "ND",
  "OH", "OK", "OR", "TX", "UT", "VT", "WA",
]);

const PARTIAL: Record<string, string> = {
  CO: "Protects you only from private ambulance companies, not public ones.",
  MD: "Protects you only from private ambulance companies, not public ones.",
  FL: "Protects you only if your plan is an HMO.",
  WV: "Protects you only if your plan is an HMO. Wider protections begin in 2027.",
};

const GRID: [string, string, number, number][] = [
  ["AK", "Alaska", 0, 0], ["ME", "Maine", 10, 0],
  ["WI", "Wisconsin", 5, 1], ["VT", "Vermont", 9, 1], ["NH", "New Hampshire", 10, 1],
  ["WA", "Washington", 0, 2], ["ID", "Idaho", 1, 2], ["MT", "Montana", 2, 2], ["ND", "North Dakota", 3, 2],
  ["MN", "Minnesota", 4, 2], ["IL", "Illinois", 5, 2], ["MI", "Michigan", 6, 2], ["NY", "New York", 8, 2],
  ["MA", "Massachusetts", 9, 2],
  ["OR", "Oregon", 0, 3], ["NV", "Nevada", 1, 3], ["WY", "Wyoming", 2, 3], ["SD", "South Dakota", 3, 3],
  ["IA", "Iowa", 4, 3], ["IN", "Indiana", 5, 3], ["OH", "Ohio", 6, 3], ["PA", "Pennsylvania", 7, 3],
  ["NJ", "New Jersey", 8, 3], ["CT", "Connecticut", 9, 3], ["RI", "Rhode Island", 10, 3],
  ["CA", "California", 0, 4], ["UT", "Utah", 1, 4], ["CO", "Colorado", 2, 4], ["NE", "Nebraska", 3, 4],
  ["MO", "Missouri", 4, 4], ["KY", "Kentucky", 5, 4], ["WV", "West Virginia", 6, 4], ["VA", "Virginia", 7, 4],
  ["MD", "Maryland", 8, 4], ["DE", "Delaware", 9, 4],
  ["AZ", "Arizona", 1, 5], ["NM", "New Mexico", 2, 5], ["KS", "Kansas", 3, 5], ["AR", "Arkansas", 4, 5],
  ["TN", "Tennessee", 5, 5], ["NC", "North Carolina", 6, 5], ["SC", "South Carolina", 7, 5],
  ["DC", "District of Columbia", 8, 5],
  ["OK", "Oklahoma", 3, 6], ["LA", "Louisiana", 4, 6], ["MS", "Mississippi", 5, 6], ["AL", "Alabama", 6, 6],
  ["GA", "Georgia", 7, 6],
  ["HI", "Hawaii", 0, 7], ["TX", "Texas", 3, 7], ["FL", "Florida", 8, 7],
];

export const STATES: StateRow[] = GRID.map(([id, name, col, row]) => ({
  id,
  name,
  col,
  row,
  status: PROTECTED.has(id) ? "protected" : id in PARTIAL ? "partial" : "none",
  note: PARTIAL[id],
}));

export const stateById = (id: string) => STATES.find((s) => s.id === id);

export const STATUS_LABEL: Record<AmbulanceStatus, string> = {
  protected: "State protection",
  partial: "Partial protection",
  none: "No state protection",
};

/** A Missouri ZIP starts 63 to 65. Everything else defaults to Missouri for now. */
export function stateFromZip(zip: string | null): string {
  if (!zip) return "MO";
  const n = Number(zip.slice(0, 3));
  if (n >= 630 && n <= 658) return "MO";
  if (n >= 660 && n <= 679) return "KS";
  if (n >= 600 && n <= 629) return "IL";
  if (n >= 500 && n <= 528) return "IA";
  if (n >= 716 && n <= 729) return "AR";
  if (n >= 730 && n <= 749) return "OK";
  if (n >= 680 && n <= 693) return "NE";
  if (n >= 400 && n <= 427) return "KY";
  if (n >= 370 && n <= 385) return "TN";
  return "MO";
}

/**
 * Whether a state law can protect this person at all. A self-funded employer
 * plan is outside every state law; "unknown" means we cannot say yet.
 */
export function stateLawApplies(
  status: AmbulanceStatus,
  selfFunded: boolean | null
): "yes" | "partly" | "no" | "depends" {
  if (status === "none") return "no";
  if (selfFunded === true) return "no";
  if (selfFunded === null) return "depends";
  return status === "protected" ? "yes" : "partly";
}
