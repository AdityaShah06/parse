/**
 * Prescriptions and tests you can buy either through your plan or for cash.
 *
 * `planPrice` is the price the plan would be billed (the allowed amount), which
 * the engine runs through your plan's rules. `cashPrice` is what you would pay
 * out of pocket with no insurance involved. Both are sample figures for now.
 */

import { BENEFIT } from "../load-plans";
import { SAMPLE_SOURCE, type KbRow } from "./types";

export type RxKind = "generic" | "brand" | "lab" | "imaging" | "xray";

export type RxItem = KbRow & {
  name: string;
  /** Plain description with no medical claims: what it is, not what it treats. */
  detail: string;
  kind: RxKind;
  planPrice: number;
  cashPrice: number;
  cashSeller: string;
  /** How often people usually buy it, for the default frequency. */
  typically: "once" | "monthly" | "quarterly";
};

export const RX_SERVICE: Record<RxKind, string> = {
  generic: BENEFIT.GENERIC_DRUGS,
  brand: BENEFIT.BRAND_DRUGS,
  lab: BENEFIT.LAB,
  imaging: BENEFIT.IMAGING,
  xray: BENEFIT.XRAY,
};

const s = SAMPLE_SOURCE;
const row = (r: Omit<RxItem, "sample" | "source">): RxItem => ({ ...r, sample: true, source: s });

export const RX: RxItem[] = [
  row({ id: "atorvastatin", name: "Atorvastatin 20 mg", detail: "Generic Lipitor, 30 tablets", kind: "generic", planPrice: 14, cashPrice: 6.9, cashSeller: "Online cash pharmacy", typically: "monthly" }),
  row({ id: "sertraline", name: "Sertraline 50 mg", detail: "Generic Zoloft, 30 tablets", kind: "generic", planPrice: 12, cashPrice: 5.8, cashSeller: "Online cash pharmacy", typically: "monthly" }),
  row({ id: "escitalopram", name: "Escitalopram 10 mg", detail: "Generic Lexapro, 30 tablets", kind: "generic", planPrice: 13, cashPrice: 6.2, cashSeller: "Online cash pharmacy", typically: "monthly" }),
  row({ id: "amoxicillin", name: "Amoxicillin 500 mg", detail: "21 capsules, one course", kind: "generic", planPrice: 12, cashPrice: 7.5, cashSeller: "Pharmacy discount card", typically: "once" }),
  row({ id: "metformin", name: "Metformin 500 mg", detail: "Generic Glucophage, 60 tablets", kind: "generic", planPrice: 9, cashPrice: 4.1, cashSeller: "Online cash pharmacy", typically: "monthly" }),
  row({ id: "levothyroxine", name: "Levothyroxine 50 mcg", detail: "Generic Synthroid, 30 tablets", kind: "generic", planPrice: 16, cashPrice: 6.6, cashSeller: "Online cash pharmacy", typically: "monthly" }),
  row({ id: "albuterol", name: "Albuterol inhaler", detail: "Generic rescue inhaler, 1 inhaler", kind: "generic", planPrice: 60, cashPrice: 24, cashSeller: "Pharmacy discount card", typically: "quarterly" }),
  row({ id: "budesonide-formoterol", name: "Budesonide and formoterol inhaler", detail: "Generic Symbicort, 1 inhaler", kind: "brand", planPrice: 280, cashPrice: 95, cashSeller: "Online cash pharmacy", typically: "monthly" }),
  row({ id: "apixaban", name: "Eliquis 5 mg", detail: "Brand name, 60 tablets, no generic sold in the US yet", kind: "brand", planPrice: 560, cashPrice: 610, cashSeller: "Pharmacy discount card", typically: "monthly" }),
  row({ id: "bmp", name: "Basic metabolic panel", detail: "Blood test", kind: "lab", planPrice: 45, cashPrice: 24, cashSeller: "Direct-to-consumer lab", typically: "once" }),
  row({ id: "lipid", name: "Lipid panel", detail: "Cholesterol blood test", kind: "lab", planPrice: 40, cashPrice: 19, cashSeller: "Direct-to-consumer lab", typically: "once" }),
  row({ id: "cbc", name: "Complete blood count", detail: "Blood test", kind: "lab", planPrice: 30, cashPrice: 15, cashSeller: "Direct-to-consumer lab", typically: "once" }),
  row({ id: "chest-xray", name: "Chest X-ray", detail: "Two views", kind: "xray", planPrice: 150, cashPrice: 60, cashSeller: "Cash-price imaging center", typically: "once" }),
  row({ id: "mri-lumbar", name: "MRI, lower back", detail: "Lumbar spine, without contrast", kind: "imaging", planPrice: 1200, cashPrice: 450, cashSeller: "Cash-price imaging center", typically: "once" }),
  row({ id: "ct-head", name: "CT scan, head", detail: "Without contrast", kind: "imaging", planPrice: 1000, cashPrice: 350, cashSeller: "Cash-price imaging center", typically: "once" }),
];

export const RX_GROUPS: { label: string; kinds: RxKind[] }[] = [
  { label: "Prescriptions", kinds: ["generic", "brand"] },
  { label: "Tests and scans", kinds: ["lab", "xray", "imaging"] },
];
