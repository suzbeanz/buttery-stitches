/**
 * The measuring-tape ruler — the brand's structural device, lifted from the
 * tablespoon marks on a stick of butter. Drawn like a graduation *printed on the
 * page itself*: flat Press-Blue ink, a tick hierarchy (major / half / quarter),
 * and a foil hairline, roughed with a faint ink grain so it reads as letterpress
 * on paper rather than a crisp vector line.
 *
 * Two modes:
 *  - RULER (pass `unit`): a printed graduation. Pure CSS at a FIXED pitch — no
 *    measuring, no JS, no snapping. The ticks simply run the width of the page
 *    and dissolve at both margins (masked), so nothing ever pops, slices, or
 *    resizes as the window changes. It's just ink on the paper.
 *  - STEPS (pass `labels`): a fixed set of labeled divisions (e.g. a progress
 *    meter) that spread to fill the width.
 *
 * Flat by rule — no rounded ends, no soft shadow.
 */
const INK = "#173A7A";
const RED = "#B23A2E";
/** Fixed ruler graduations: a major every 132px, a half every 66, a minor every 33. */
const MAJOR_PX = 132;
const MINOR_PX = MAJOR_PX / 4;
const HALF_PX = MAJOR_PX / 2;

/** Faint ink grain so the printed rule looks pressed into the paper. */
const INK_GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='t'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23t)' opacity='0.08'/%3E%3C/svg%3E\")";

export default function Tape({
  labels,
  majors = 8,
  fillPct,
  unit,
  className = "",
}: {
  /** fixed labeled divisions that fill the width (steps mode). */
  labels?: string[];
  /** division count when neither labels nor a unit is given. */
  majors?: number;
  /** 0..1 — fill the tape in Stamp Red to show progress. */
  fillPct?: number;
  /** ruler mode: a printed graduation at fixed pitch (labels are intentionally
   *  omitted — the marks alone are the device, and nothing pops on resize). */
  unit?: string;
  className?: string;
}) {
  const rulerMode = !labels && unit !== undefined;

  if (rulerMode) {
    // A static, resolution-independent printed rule. The ticks are CSS gradients
    // at a fixed pixel pitch; a horizontal mask fades them out at both margins so
    // the partial end ticks dissolve into the paper instead of slicing or jumping.
    const fade = "linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%)";
    return (
      <div aria-hidden className={`relative h-[22px] w-full shrink-0 overflow-hidden ${className}`}>
        {/* the rule */}
        <div className="absolute inset-x-0 top-0 border-t-[2.5px] border-ink opacity-90" />
        {/* foil hairline just under the rule */}
        <div className="absolute inset-x-0 top-[3px] h-px bg-foil/55" />
        {/* graduation ticks (faded at the margins) */}
        <div
          className="absolute inset-x-0 top-0 h-4"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 2px, transparent 2px 100%)`,
            backgroundSize: `${MAJOR_PX}px 16px`,
            opacity: 0.9,
            maskImage: fade,
            WebkitMaskImage: fade,
          }}
        />
        <div
          className="absolute inset-x-0 top-0 h-[12px] opacity-75"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 1.75px, transparent 1.75px 100%)`,
            backgroundSize: `${HALF_PX}px 12px`,
            maskImage: fade,
            WebkitMaskImage: fade,
          }}
        />
        <div
          className="absolute inset-x-0 top-0 h-[9px] opacity-50"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 1.5px, transparent 1.5px 100%)`,
            backgroundSize: `${MINOR_PX}px 9px`,
            maskImage: fade,
            WebkitMaskImage: fade,
          }}
        />
        {/* pressed-ink grain */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60 mix-blend-multiply"
          style={{ backgroundImage: INK_GRAIN, backgroundSize: "120px 120px" }}
        />
      </div>
    );
  }

  // STEPS MODE: a fixed set of labeled divisions that spread to fill the width.
  const divisions = labels?.length ?? majors;
  const majorSize = `calc(100% / ${divisions}) 16px`;
  const minorSize = `calc(100% / ${divisions * 4}) 9px`;

  return (
    <div
      aria-hidden
      className={`relative ${labels ? "h-11" : "h-5"} w-full shrink-0 overflow-hidden ${className}`}
    >
      {/* the rule */}
      <div className="absolute inset-x-0 top-0 border-t-[2.5px] border-ink" />
      <div className="absolute inset-x-0 top-[3px] h-px bg-foil/55" />
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
          backgroundSize: majorSize,
        }}
      />
      {/* minor ticks */}
      <div
        className="absolute inset-x-0 top-0 h-[9px] opacity-55"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 1.5px, transparent 1.5px 100%)`,
          backgroundSize: minorSize,
        }}
      />
      {/* end caps */}
      <div className="absolute left-0 top-0 h-[22px] w-[2.5px] bg-ink" />
      <div className="absolute right-0 top-0 h-[22px] w-[2.5px] bg-ink" />
      {/* pressed-ink grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60 mix-blend-multiply"
        style={{ backgroundImage: INK_GRAIN, backgroundSize: "120px 120px" }}
      />
      {/* labels */}
      {labels && (
        <div className="absolute inset-x-0 top-[24px] flex">
          {labels.map((l, i) => (
            <span
              key={i}
              style={{ textShadow: "0 1px 0 rgba(255,253,243,0.6)" }}
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
