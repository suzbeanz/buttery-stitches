import { useEffect, useRef, useState } from "react";

/**
 * The measuring-tape ruler — the brand's structural device, lifted from the
 * tablespoon marks on a stick of butter. Drawn like a graduation *printed on the
 * page itself*: flat Press-Blue ink, a tick hierarchy (major / half / quarter),
 * a foil hairline, and a faint ink grain so it reads as letterpress on paper.
 *
 * Modes:
 *  - RULER (`unit`): a printed graduation at a FIXED pitch — pure CSS, no
 *    measuring, no snapping. Ticks run the length and dissolve at the margins
 *    (masked), so nothing pops or resizes. `orientation="vertical"` runs it down
 *    a left margin as a section divider.
 *  - STEPS (`labels`): a fixed set of labeled divisions (a progress meter). With
 *    `animate`, the red fill is laid in stitch-by-stitch when it scrolls into
 *    view — the one moving thing on the page; everything else is printed.
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

const Grain = () => (
  <div
    className="pointer-events-none absolute inset-0 opacity-60 mix-blend-multiply"
    style={{ backgroundImage: INK_GRAIN, backgroundSize: "120px 120px" }}
  />
);

/** One-shot "is it on screen yet" flag — used only to trigger the stitch fill. */
function useInView(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(!enabled);
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return { ref, shown };
}

export default function Tape({
  labels,
  majors = 8,
  fillPct,
  unit,
  orientation = "horizontal",
  animate = false,
  className = "",
}: {
  /** fixed labeled divisions that fill the width (steps mode). */
  labels?: string[];
  /** division count when neither labels nor a unit is given. */
  majors?: number;
  /** 0..1 — fill the tape in Stamp Red to show progress. */
  fillPct?: number;
  /** ruler mode: a printed graduation at fixed pitch (marks only). */
  unit?: string;
  /** vertical rulers run down a left margin as section dividers. */
  orientation?: "horizontal" | "vertical";
  /** lay the red fill in stitch-by-stitch when it scrolls into view. */
  animate?: boolean;
  className?: string;
}) {
  const { ref, shown } = useInView(animate);

  // VERTICAL RULER — a printed rule down a left margin (decorative divider).
  if (orientation === "vertical") {
    const fade = "linear-gradient(to bottom, transparent 0, #000 6%, #000 94%, transparent 100%)";
    const tick = (w: string, pitch: number, op: number, weight: number) => (
      <div
        className={`absolute inset-y-0 left-0 ${w}`}
        style={{
          backgroundImage: `repeating-linear-gradient(to bottom, ${INK} 0 ${weight}px, transparent ${weight}px 100%)`,
          backgroundSize: `100% ${pitch}px`,
          opacity: op,
          maskImage: fade,
          WebkitMaskImage: fade,
        }}
      />
    );
    return (
      <div aria-hidden className={`relative w-[22px] shrink-0 overflow-hidden ${className}`}>
        <div className="absolute inset-y-0 left-0 border-l-[2.5px] border-ink opacity-90" />
        <div className="absolute inset-y-0 left-[3px] w-px bg-foil/55" />
        {tick("w-4", MAJOR_PX, 0.9, 2)}
        {tick("w-3", HALF_PX, 0.7, 1.75)}
        {tick("w-[9px]", MINOR_PX, 0.45, 1.5)}
        <Grain />
      </div>
    );
  }

  // RULER MODE — a static printed graduation; ticks fade into the margins.
  const rulerMode = !labels && unit !== undefined;
  if (rulerMode) {
    const fade = "linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%)";
    const tick = (h: string, pitch: number, op: number, weight: number) => (
      <div
        className={`absolute inset-x-0 top-0 ${h}`}
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 ${weight}px, transparent ${weight}px 100%)`,
          backgroundSize: `${pitch}px 100%`,
          opacity: op,
          maskImage: fade,
          WebkitMaskImage: fade,
        }}
      />
    );
    return (
      <div aria-hidden className={`relative h-[22px] w-full shrink-0 overflow-hidden ${className}`}>
        <div className="absolute inset-x-0 top-0 border-t-[2.5px] border-ink opacity-90" />
        <div className="absolute inset-x-0 top-[3px] h-px bg-foil/55" />
        {tick("h-4", MAJOR_PX, 0.9, 2)}
        {tick("h-[12px]", HALF_PX, 0.75, 1.75)}
        {tick("h-[9px]", MINOR_PX, 0.5, 1.5)}
        <Grain />
      </div>
    );
  }

  // STEPS MODE — a fixed set of labeled divisions that spread to fill the width.
  const divisions = labels?.length ?? majors;
  const majorSize = `calc(100% / ${divisions}) 16px`;
  const minorSize = `calc(100% / ${divisions * 4}) 9px`;
  // The fill is a row of running stitches (red dashes); when animated it's
  // revealed left-to-right in discrete steps, like being sewn in.
  const stitches = `repeating-linear-gradient(to right, ${RED} 0 9px, ${RED}40 9px 13px)`;

  return (
    <div
      ref={ref}
      aria-hidden
      className={`relative ${labels ? "h-11" : "h-5"} w-full shrink-0 overflow-hidden ${className}`}
    >
      <div className="absolute inset-x-0 top-0 border-t-[2.5px] border-ink" />
      <div className="absolute inset-x-0 top-[3px] h-px bg-foil/55" />
      {/* red running-stitch fill */}
      {fillPct !== undefined && (
        <div
          className={`absolute left-0 top-[2.5px] h-[13px] ${animate ? `stitch-fill ${shown ? "go" : ""}` : ""}`}
          style={{ width: `${Math.max(0, Math.min(1, fillPct)) * 100}%`, backgroundImage: stitches }}
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
      <Grain />
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
