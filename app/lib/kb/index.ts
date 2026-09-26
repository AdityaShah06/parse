/**
 * The knowledge base registry. Each category lists its rows; the interface can
 * show how much of each category is real versus still a sample.
 */

import { RX } from "./rx";
import { PEOPLE } from "./people";
import type { KbRow } from "./types";

export type Category = { id: string; label: string; rows: KbRow[] };

export const KB: Category[] = [
  { id: "rx", label: "Prescriptions, tests and cash prices", rows: RX },
  { id: "people", label: "People to call", rows: Object.values(PEOPLE) },
];

export { RX } from "./rx";
export { PEOPLE } from "./people";
export type { KbRow, Citation } from "./types";
