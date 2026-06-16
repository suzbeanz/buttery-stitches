import { useEffect, useRef, useState } from "react";

/**
 * The measuring-tape ruler — the brand's structural device, lifted from the
 * tablespoon marks on a stick of butter, drawn like a graduation printed on old
 * paper: a Press-Blue rule with a tick hierarchy (major / half / quarter),
 * letterpressed numerals, and a foil hairline.
 *
 * Two modes:
 *  - RULER (pass `unit`): a true measuring tape. Ticks sit at a FIXED pitch and
 *    are never sliced — the strip snaps to a whole number of major divisions and
 *    centers, so widening the window adds clean, full graduations rather than a
 *    half-cut tick that grows and shrinks at the edge.
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
const HALF_PX = MAJOR_PX / 2;

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

  // RULER: snap the printed strip to a whole number of majors and center it.
  // The tick gradients then tile the strip *exactly*, so the end tick is always
  // a full mark (never a sliced one that resizes with the window) and the small
  // side margins read like the blank ends of a printed rule.
  const wholeMajors = Math.max(1, Math.floor(width / MAJOR_PX));
  const stripW = rulerMode ? wholeMajors * MAJOR_PX : 0;
  const rulerLabels = rulerMode
    ? Array.from({ length: wholeMajors }, (_, i) => `${i + 1} ${unit}`)
    : null;

  // STEPS: tick gradient spans a fraction of the width so N labels spread evenly.
  const stepMajor = `calc(100% / ${divisions}) 16px`;
  const stepMinor = `calc(100% / ${divisions * 4}) 9px`;
  const hasLabels = Boolean(labels || rulerMode);

  // The graduated band (rule + ticks + caps). Reused for both modes; in ruler
  // mode it's wrapped in a centered, whole-major-wide strip.
  const band = (sizeMajor: string, sizeMinor: string, sizeHalf?: string) => (
    <>
      {/* the rule */}
      <div className="absolute inset-x-0 top-0 border-t-[2.5px] border-ink" />
      {/* foil hairline just under the rule — a printed-band flourish */}
      <div className="absolute inset-x-0 top-[3px] h-px bg-foil/60" />
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
          backgroundSize: sizeMajor,
        }}
      />
      {/* half ticks (ruler only) */}
      {sizeHalf && (
        <div
          className="absolute inset-x-0 top-0 h-[12px] opacity-80"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 1.75px, transparent 1.75px 100%)`,
            backgroundSize: sizeHalf,
          }}
        />
      )}
      {/* minor ticks */}
      <div
        className="absolute inset-x-0 top-0 h-[9px] opacity-55"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 1.5px, transparent 1.5px 100%)`,
          backgroundSize: sizeMinor,
        }}
      />
      {/* end caps */}
      <div className="absolute left-0 top-0 h-[22px] w-[2.5px] bg-ink" />
      <div className="absolute right-0 top-0 h-[22px] w-[2.5px] bg-ink" />
    </>
  );

  return (
    <div
      ref={ref}
      aria-hidden
      className={`relative ${hasLabels ? "h-11" : "h-5"} w-full shrink-0 overflow-hidden ${className}`}
    >
      {/* faint printed-ink grain over the whole band, so the ticks read as
          letterpress on paper rather than crisp vector lines. */}
      <div
        className="pointer-events-none absolute inset-0 z-10 opacity-[0.5] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='t'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.4 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23t)' opacity='0.06'/%3E%3C/svg%3E\")",
          backgroundSize: "120px 120px",
        }}
      />

      {/* RULER MODE: a centered strip snapped to whole majors. */}
      {rulerMode && (
        <div className="absolute left-1/2 top-0 h-full -translate-x-1/2" style={{ width: `${stripW}px` }}>
          {band(`${MAJOR_PX}px 16px`, `${MINOR_PX}px 9px`, `${HALF_PX}px 12px`)}
          {rulerLabels && (
            <div className="absolute inset-x-0 top-[24px] flex">
              {rulerLabels.map((l, i) => (
                <span
                  key={i}
                  style={{ width: `${MAJOR_PX}px`, textShadow: "0 1px 0 rgba(255,253,243,0.6)" }}
                  className="shrink-0 text-center font-mono text-[11px] uppercase tracking-wide text-stamp"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEPS MODE: ticks + labels spread across the full width. */}
      {!rulerMode && band(stepMajor, stepMinor)}
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
