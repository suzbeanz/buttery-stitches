import { useEffect } from "react";
import { Pencil, Eye, Play, Pause } from "lucide-react";
import { useEditorStore } from "../store/editorStore";

/**
 * Stitch simulator: the highest-trust feature. Toggle between editing the
 * vectors and watching the design redraw stitch-by-stitch, scrub to any point,
 * and control playback speed. The simulation reads the exact same `generateDesign`
 * output the exporter uses, so what you watch is what you'll sew.
 */

const SPEEDS: { label: string; value: number }[] = [
  { label: "0.5×", value: 120 },
  { label: "1×", value: 400 },
  { label: "2×", value: 900 },
  { label: "4×", value: 2000 },
];

export default function SimulatorBar() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const simTotal = useEditorStore((s) => s.simTotal);
  const simIndex = useEditorStore((s) => s.simIndex);
  const simPlaying = useEditorStore((s) => s.simPlaying);
  const simSpeed = useEditorStore((s) => s.simSpeed);
  const realistic = useEditorStore((s) => s.realistic);
  const toggleRealistic = useEditorStore((s) => s.toggleRealistic);
  const setSimIndex = useEditorStore((s) => s.setSimIndex);
  const setSimPlaying = useEditorStore((s) => s.setSimPlaying);
  const setSimSpeed = useEditorStore((s) => s.setSimSpeed);

  // Playback loop: advance the cursor by speed × elapsed each animation frame.
  useEffect(() => {
    if (viewMode !== "stitch" || !simPlaying) return;
    let raf = 0;
    let prev = performance.now();
    const step = (now: number) => {
      const s = useEditorStore.getState();
      const dt = (now - prev) / 1000;
      prev = now;
      const next = s.simIndex + s.simSpeed * dt;
      if (next >= s.simTotal) {
        s.setSimIndex(s.simTotal);
        s.setSimPlaying(false);
        return;
      }
      s.setSimIndex(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [viewMode, simPlaying]);

  function togglePlay() {
    if (simTotal === 0) return;
    if (simIndex >= simTotal) setSimIndex(0); // replay from the top
    setSimPlaying(!simPlaying);
  }

  const shown = Math.min(Math.floor(simIndex), simTotal);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t-2 border-ink/20 bg-cream px-3 py-1.5">
      {/* Edit / Stitch view toggle */}
      <div className="flex overflow-hidden rounded-sm border-2 border-ink text-xs">
        {([
          { m: "edit" as const, label: "Edit", Icon: Pencil },
          { m: "stitch" as const, label: "Stitch view", Icon: Eye },
        ]).map(({ m, label, Icon }) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            data-tip={label}
            data-tip-side="top"
            aria-label={label}
            aria-pressed={viewMode === m}
            className={`tap-target flex items-center gap-1 px-2.5 py-1 font-label font-semibold uppercase tracking-wide ${
              viewMode === m
                ? "bg-ink text-cream"
                : "bg-cream text-ink hover:bg-butter-200"
            }`}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {viewMode === "stitch" ? (
        <>
          <button
            onClick={togglePlay}
            disabled={simTotal === 0}
            data-tip={simPlaying ? "Pause" : "Play"}
            data-tip-side="top"
            aria-label={simPlaying ? "Pause" : "Play"}
            className="tap-target grid h-8 w-8 place-items-center rounded-sm border-2 border-ink bg-ink text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none disabled:opacity-40"
          >
            {simPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <input
            type="range"
            min={0}
            max={simTotal}
            value={shown}
            onChange={(e) => {
              setSimPlaying(false);
              setSimIndex(Number(e.target.value));
            }}
            className="h-1.5 flex-1 cursor-pointer accent-ink"
            aria-label="Scrub stitches"
          />

          <span className="hidden w-28 text-right font-mono text-xs tabular-nums text-ink-deep sm:inline">
            {shown.toLocaleString()} / {simTotal.toLocaleString()}
          </span>

          <select
            value={simSpeed}
            onChange={(e) => setSimSpeed(Number(e.target.value))}
            className="rounded-sm border-2 border-ink bg-cream px-1.5 py-0.5 font-label text-xs font-semibold uppercase tracking-wide text-ink"
            aria-label="Playback speed"
          >
            {SPEEDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            onClick={toggleRealistic}
            aria-pressed={realistic}
            data-tip={realistic ? "Realistic thread on" : "Realistic thread off"}
            data-tip-side="top"
            className={`tap-target rounded-sm border-2 border-ink px-2 py-1 font-label text-xs font-semibold uppercase tracking-wide ${
              realistic ? "bg-ink text-cream" : "bg-cream text-ink hover:bg-butter-200"
            }`}
          >
            3D
          </button>
        </>
      ) : (
        // Educational only — hidden on small screens where it wrapped the bar
        // to 2-3 rows and collided with toasts (the P shortcut stays in Help).
        <span className="hidden text-xs text-navy/80 md:inline">
          Switch to <b>Stitch view</b> to watch the design redraw stitch by stitch — or press <kbd className="rounded border border-navy/25 px-1 font-mono text-[10px]">P</kbd>.
        </span>
      )}
    </div>
  );
}
