import { useEffect, useRef, useState } from "react";

/**
 * The measuring-tape ruler — the brand's structural device, lifted from the
 * tablespoon marks on a stick of butter. A flat Press-Blue rule with major
 * divisions + 4 minor ticks each, taller end-caps, and Space-Mono labels.
 *
 * Two modes:
 *  - RULER (pass `unit`): a true measuring tape. Ticks sit at a FIXED spacing
 *    and never stretch — widening the window simply reveals more of them.
 *  - STEPS (pass `labels`): a fixed set of labeled divisions (e.g. a progress
 *    meter) that spread to fill the width.
 *
 * Flat by rule — no rounded ends, no soft shadow.
 */
const INK = "#173A7A";
const RED = "#B23A2E";
/** Fixed ruler graduations: a labeled major every 132px, a minor every 33px. */
const MAJOR_PX = 132;
const MINOR_PX = MAJOR_PX / 4;

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
  /** ruler mode: fixed-spacing tape, labelled "1 {unit}", "2 {unit}", … */
  unit?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const rulerMode = !labels && unit !== undefined;
  useEffect(() => {
    if (!rulerMode) return;
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rulerMode]);

  const divisions = labels?.length ?? majors;
  // Tick gradient size: a fixed pixel pitch in ruler mode (so marks don't
  // stretch — more appear as the tape gets wider); a fraction of the width in
  // steps mode (so N labels spread evenly).
  const majorSize = rulerMode ? `${MAJOR_PX}px 16px` : `calc(100% / ${divisions}) 16px`;
  const minorSize = rulerMode ? `${MINOR_PX}px 9px` : `calc(100% / ${divisions * 4}) 9px`;

  // Labels: fixed-width segments in ruler mode (count follows the width); evenly
  // spread flex children in steps mode.
  const rulerCount = rulerMode ? Math.max(2, Math.floor(width / MAJOR_PX)) : 0;
  const rulerLabels = rulerMode
    ? Array.from({ length: rulerCount }, (_, i) => `${i + 1} ${unit}`)
    : null;
  const hasLabels = Boolean(labels || rulerMode);

  return (
    <div
      ref={ref}
      aria-hidden
      className={`relative ${hasLabels ? "h-11" : "h-5"} w-full shrink-0 overflow-hidden ${className}`}
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
      {/* labels — steps mode: evenly spread; ruler mode: fixed-width segments. */}
      {labels && (
        <div className="absolute inset-x-0 top-[24px] flex">
          {labels.map((l, i) => (
            <span key={i} className="flex-1 text-center font-mono text-[11px] uppercase tracking-wide text-stamp">
              {l}
            </span>
          ))}
        </div>
      )}
      {rulerLabels && (
        <div className="absolute inset-x-0 top-[24px] flex">
          {rulerLabels.map((l, i) => (
            <span
              key={i}
              style={{ width: `${MAJOR_PX}px` }}
              className="shrink-0 text-center font-mono text-[11px] uppercase tracking-wide text-stamp"
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
