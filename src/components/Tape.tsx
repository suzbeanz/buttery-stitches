import { useEffect, useRef, useState } from "react";

/**
 * The measuring-tape ruler — the brand's structural device, lifted from the
 * tablespoon marks on a stick of butter. A flat Press-Blue rule with major
 * divisions + 4 minor ticks each, taller end-caps, and optional Space-Mono
 * labels in Stamp Red.
 *
 * Two modes:
 *  - RULER (pass `unit`): like a real tape measure, the number of divisions
 *    grows with the element's width — resize the window and more marks appear.
 *  - STEPS (pass `labels`): a fixed set of labeled divisions (e.g. a progress
 *    meter), independent of width.
 *
 * Flat by rule — no rounded ends, no soft shadow.
 */
const INK = "#173A7A";
const RED = "#B23A2E";
/** Target px between major (labeled) ticks in ruler mode. */
const TARGET_MAJOR_PX = 132;

export default function Tape({
  labels,
  majors = 8,
  fillPct,
  unit,
  className = "",
}: {
  /** fixed labeled divisions (steps mode). */
  labels?: string[];
  /** division count when neither labels nor a unit is given. */
  majors?: number;
  /** 0..1 — fill the tape in Stamp Red to show progress. */
  fillPct?: number;
  /** ruler mode: label each major "1 {unit}" … and let the count grow with width. */
  unit?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rulerMode = !labels && unit !== undefined;
  // In ruler mode the division COUNT tracks the width (a real measuring tape);
  // otherwise it's the fixed label/majors count.
  const divisions = labels?.length
    ?? (rulerMode && width > 0
      ? Math.max(3, Math.min(18, Math.round(width / TARGET_MAJOR_PX)))
      : majors);
  const tickLabels =
    labels ??
    (rulerMode
      ? Array.from({ length: divisions }, (_, i) => `${i + 1} ${unit}`)
      : undefined);

  return (
    <div
      ref={ref}
      aria-hidden
      className={`relative ${tickLabels ? "h-11" : "h-5"} w-full shrink-0 ${className}`}
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
      {tickLabels && (
        <div className="absolute inset-x-0 top-[24px] flex">
          {tickLabels.map((l, i) => (
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
