"use client";

import { motion } from "framer-motion";
import type { Person } from "@/lib/kb/people";
import { Icon } from "../ui";

/**
 * The moment the software steps aside. Always night, whatever the theme, so
 * it reads as a different kind of object: a real person, a real number.
 */
export default function Handoff({ person, line }: { person: Person; line: string }) {
  const tel = person.phone ? `tel:${person.phone.replace(/\D/g, "")}` : null;
  return (
    <motion.div
      data-theme="night"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
      className="relative overflow-hidden rounded-[28px] bg-paper text-ink p-6 sm:p-8"
      style={{ boxShadow: "0 40px 80px -30px rgb(0 0 0 / 0.55)" }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(60% 120% at 100% 0%, rgb(245 182 199 / 0.18), transparent 60%), radial-gradient(50% 100% at 0% 100%, rgb(127 224 171 / 0.14), transparent 60%)" }} />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="max-w-xl">
          <div className="text-[11px] uppercase tracking-[0.2em] text-blossom">A real person</div>
          <div className="font-serif text-[1.9rem] sm:text-[2.3rem] leading-[1.05] mt-2">{person.name}</div>
          <p className="text-[14.5px] text-dim mt-2">{line} {person.when}</p>
        </div>
        {tel ? (
          <a href={tel} className="group inline-flex items-center gap-3 rounded-full bg-ink text-paper h-14 pl-5 pr-6 text-[17px]">
            <span className="grid place-items-center size-8 rounded-full bg-paper/10">
              <Icon name="phone" className="size-4" />
            </span>
            <span className="font-mono">{person.phone}</span>
          </a>
        ) : (
          <div className="rounded-full border border-line-strong px-5 h-12 inline-flex items-center text-[14px] text-dim">The number is on the back of your card</div>
        )}
      </div>
    </motion.div>
  );
}
