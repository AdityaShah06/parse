/**
 * The knowledge base: typed rows by category, each with its source.
 *
 * Every room and every AI answer reads from here. A row marked `sample` is a
 * placeholder the interface must badge as "Sample data" until it is replaced
 * with a sourced figure.
 */

export type Citation = {
  /** Who published it, e.g. "Mark Cuban Cost Plus Drug Company". */
  name: string;
  url?: string;
  /** When the figure was read or published, e.g. "2026-09". */
  asOf?: string;
};

export type KbRow = {
  id: string;
  /** True until a real, cited figure replaces the placeholder. */
  sample: boolean;
  source: Citation;
};

export const SAMPLE_SOURCE: Citation = { name: "Sample figure for the demo, not a real quote" };
