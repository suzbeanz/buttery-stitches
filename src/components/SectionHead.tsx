/**
 * The numbered section header used down the editorial homepage: a Space-Mono
 * "Section 0X" kicker in Stamp Red, a big Anton title, and an Oswald sub on the
 * right — like the running heads on a printed spread.
 */
export default function SectionHead({
  no,
  title,
  sub,
}: {
  no: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-3 mt-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-stamp">
          {no}
        </div>
        <h2 className="mt-1.5 font-display text-4xl uppercase leading-[0.92] tracking-wide text-ink-deep sm:text-6xl">
          {title}
        </h2>
      </div>
      {sub && (
        <div className="max-w-[240px] text-right font-label text-[13px] font-medium uppercase tracking-[0.32em] text-stamp">
          {sub}
        </div>
      )}
    </div>
  );
}
