/**
 * The measuring-tape ruler — the brand's structural device, lifted from the
 * tablespoon marks on a stick of butter. A flat Press-Blue rule with 8 major
 * divisions and 4 minor ticks each (32 total), taller end-caps, and optional
 * Space-Mono labels in Stamp Red centered under each division.
 *
 * Used everywhere: a full-bleed section divider, a red progress meter, and a
 * data scale. Flat by rule — no rounded ends, no soft shadow.
 */
const INK = "#173A7A";
const RED = "#B23A2E";

export default function Tape({
  labels,
  majors = 8,
  fillPct,
  className = "",
}: {
  /** label centered under each major division (also sets the division count). */
  labels?: string[];
  /** number of major divisions when no labels are given (default 8). */
  majors?: number;
  /** 0..1 — fill the tape in Stamp Red to show progress. */
  fillPct?: number;
  className?: string;
}) {
  const divisions = labels?.length ?? majors;
  return (
    <div
      aria-hidden
      className={`relative ${labels ? "h-11" : "h-5"} w-full shrink-0 ${className}`}
    >
      {/* the rule */}
      <div className="absolute inset-x-0 top-0 border-t-[2.5px] border-ink" />
      {/* red progress fill */}
      {fillPct !== undefined && (
        <div
          className="absolute left-0 top-[2.5px] h-[13px]"
          style={{ width: `${Math.max(0, Math.min(1, fillPct)) * 100}%`, background: RED, opacity: 0.85 }}
        />
      )}
      {/* major ticks */}
      <div
        className="absolute inset-x-0 top-0 h-4"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 2px, transparent 2px 100%)`,
          backgroundSize: `calc(100% / ${divisions}) 16px`,
        }}
      />
      {/* minor ticks */}
      <div
        className="absolute inset-x-0 top-0 h-[9px] opacity-55"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 1.5px, transparent 1.5px 100%)`,
          backgroundSize: `calc(100% / ${divisions * 4}) 9px`,
        }}
      />
      {/* end caps */}
      <div className="absolute left-0 top-0 h-[22px] w-[2.5px] bg-ink" />
      <div className="absolute right-0 top-0 h-[22px] w-[2.5px] bg-ink" />
      {/* labels */}
      {labels && (
        <div className="absolute inset-x-0 top-[24px] flex">
          {labels.map((l, i) => (
            <span
              key={i}
              className="flex-1 text-center font-mono text-[11px] uppercase tracking-wide text-stamp"
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
