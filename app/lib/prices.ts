/**
 * Representative allowed amounts per service.
 *
 * These are inputs to the engine, not outputs. They are NOT negotiated rates
 * at a named facility, and the interface says so on screen.
 *
 * Every row carries a `source`. Rows marked "placeholder" are rough figures
 * picked so the demo runs end to end. Replace each one with a sourced number
 * (for example MU Health Care's published price transparency file, or a
 * Medicare fee schedule rate times a stated commercial multiplier) and write
 * the source in the row.
 *
 * `low` and `high` are here so the interface can later show a range by running
 * the engine twice. The core screen uses `typical`.
 */

import { BENEFIT } from "./load-plans";

export type Price = {
  label: string;
  serviceType: string;
  typical: number;
  low: number;
  high: number;
  preventive?: boolean;
  source: string;
};

const PLACEHOLDER = "placeholder, replace with a sourced figure";

export const PRICES = {
  physical: {
    label: "Yearly physical",
    serviceType: BENEFIT.PREVENTIVE,
    typical: 250,
    low: 180,
    high: 350,
    preventive: true,
    source: PLACEHOLDER,
  },
  sickVisit: {
    label: "Doctor visit, sick",
    serviceType: BENEFIT.PRIMARY_CARE,
    typical: 180,
    low: 120,
    high: 260,
    source: PLACEHOLDER,
  },
  specialist: {
    label: "Specialist visit",
    serviceType: BENEFIT.SPECIALIST,
    typical: 260,
    low: 180,
    high: 400,
    source: PLACEHOLDER,
  },
  therapy: {
    label: "Therapy session",
    serviceType: BENEFIT.MENTAL_HEALTH,
    typical: 150,
    low: 100,
    high: 220,
    source: PLACEHOLDER,
  },
  urgentCare: {
    label: "Urgent care visit",
    serviceType: BENEFIT.URGENT_CARE,
    typical: 200,
    low: 150,
    high: 300,
    source: PLACEHOLDER,
  },
  er: {
    label: "Emergency room visit",
    serviceType: BENEFIT.EMERGENCY_ROOM,
    typical: 2200,
    low: 1200,
    high: 3500,
    source: PLACEHOLDER,
  },
  ambulance: {
    label: "Ground ambulance ride",
    serviceType: BENEFIT.AMBULANCE,
    typical: 1200,
    low: 800,
    high: 1800,
    source: PLACEHOLDER,
  },
  xray: {
    label: "X-ray",
    serviceType: BENEFIT.XRAY,
    typical: 150,
    low: 90,
    high: 250,
    source: PLACEHOLDER,
  },
  mri: {
    label: "MRI",
    serviceType: BENEFIT.IMAGING,
    typical: 1200,
    low: 600,
    high: 2500,
    source: PLACEHOLDER,
  },
  ctScan: {
    label: "CT scan",
    serviceType: BENEFIT.IMAGING,
    typical: 1000,
    low: 500,
    high: 2000,
    source: PLACEHOLDER,
  },
  labs: {
    label: "Blood work",
    serviceType: BENEFIT.LAB,
    typical: 120,
    low: 60,
    high: 200,
    source: PLACEHOLDER,
  },
  genericFill: {
    label: "Generic prescription, 30 days",
    serviceType: BENEFIT.GENERIC_DRUGS,
    typical: 15,
    low: 5,
    high: 30,
    source: PLACEHOLDER,
  },
  brandFill: {
    label: "Brand inhaler, 30 days",
    serviceType: BENEFIT.BRAND_DRUGS,
    typical: 350,
    low: 250,
    high: 450,
    source: PLACEHOLDER,
  },
  kneeSurgery: {
    label: "Knee surgery, outpatient",
    serviceType: BENEFIT.OUTPATIENT_SURGERY,
    typical: 7500,
    low: 5000,
    high: 12000,
    source: PLACEHOLDER,
  },
  appendectomy: {
    label: "Appendix removal, 2 nights",
    serviceType: BENEFIT.INPATIENT,
    typical: 30000,
    low: 18000,
    high: 45000,
    source: PLACEHOLDER,
  },
  traumaStay: {
    label: "Hospital stay after a crash, 4 nights",
    serviceType: BENEFIT.INPATIENT,
    typical: 60000,
    low: 35000,
    high: 90000,
    source: PLACEHOLDER,
  },
} satisfies Record<string, Price>;

export type PriceKey = keyof typeof PRICES;

/**
 * The out-of-network ambulance balance bill: the part above the allowed amount
 * that the ambulance company can bill you directly.
 *
 * Source: Commonwealth Fund, Feb 18 2026, "Consumers Still Face Surprise Bills
 * for Ground Ambulances": average surprise charge of $1,093 in 2021 data.
 * It is a national average from older data, so the interface labels it that way.
 */
export const AMBULANCE_BALANCE_BILL = {
  amount: 1093,
  source:
    "Commonwealth Fund (2026), average ground ambulance surprise charge, 2021 data",
};
