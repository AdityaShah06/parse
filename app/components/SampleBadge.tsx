/** Marks anything that is not real yet. Stays until the data is sourced. */
export default function SampleBadge({ label = "Estimated" }: { label?: string }) {
  return (
    <span
      title="Typical prices, not a quote. Your pharmacy or lab may charge a different amount."
      className="inline-flex items-center gap-1.5 text-[12px] text-dim"
    >
      <span className="size-1.5 rounded-full bg-dim/70" aria-hidden />
      {label}
    </span>
  );
}
