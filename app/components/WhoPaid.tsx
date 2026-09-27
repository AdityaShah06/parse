"use client";

import { motion } from "framer-motion";
import type { YearResult } from "@/lib/engine";
import Money from "./Money";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

/**
 * The year's care, split by who paid for it. Both printed figures are engine
 * fields (patientTotal, planTotal). The width is a layout ratio.
 */
export default function WhoPaid({ result }: { result: YearResult }) {
  const { patientTotal, planTotal } = result;
  const total = patientTotal + planTotal; // layout ratio only
  const you = total > 0 ? (patientTotal / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm text-dim">You pay for care</div>
          <div className="font-serif text-[2.4rem] sm:text-6xl text-red tabular leading-none mt-1">
            <Money value={patientTotal} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-dim">Your plan pays</div>
          <div className="font-serif text-[2.4rem] sm:text-6xl text-blue tabular leading-none mt-1">
            <Money value={planTotal} />
          </div>
        </div>
      </div>
      <div className={`relative h-2 mt-5 rounded-full overflow-hidden ${total > 0 ? "bg-blue" : "bg-line"}`}>
        <motion.div
          className="absolute inset-y-0 left-0 bg-red shadow-[0_0_16px] shadow-red/60"
          animate={{ width: `${you}%` }}
          transition={spring}
        />
      </div>
    </div>
  );
}
