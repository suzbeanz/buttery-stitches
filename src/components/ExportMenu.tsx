import { useEffect, useMemo, useState } from "react";
import { Download, AlertTriangle } from "lucide-react";
import { toast } from "../store/toastStore";
import type { LoadStage } from "../lib/pyodide/loader";
import { useProjectStore } from "../store/projectStore";
import {
  EMB_FORMATS,
  PES_VERSIONS,
  exportAndDownload,
  exportBundle,
  downloadBytes,
  friendlyExportError,
  planFromDesign,
  type EmbFormat,
  type PesVersion,
} from "../lib/export";
import { designFor, countStitches, countColorChanges } from "../lib/engine";
import { validateDesign } from "../lib/engine/validate";
import { buildTag } from "../lib/version";

/**
 * Export menu. Runs the stitch engine on the current project, shows a quick
 * summary + any validation warnings, then exports through Pyodide/pyembroidery.
 */

/** Which machines read each format — shown under the format buttons so a
 *  first-timer doesn't need to already know that PES means Brother. */
const FORMAT_BRAND: Record<EmbFormat, string> = {
  pes: "Brother · Babylock",
  dst: "Tajima · most",
  jef: "Janome",
  exp: "Melco · Bernina",
  vp3: "Husqvarna · Pfaff",
  tbf: "Barudan",
  t01: "Tajima · Pfaff",
};

const STAGE_LABEL: Record<LoadStage, string> = {
  idle: "",
  "loading-runtime": "Loading the stitch engine…",
  "loading-micropip": "Loading the stitch engine…",
  "installing-pyembroidery": "Installing the export library…",
  ready: "Ready",
  error: "Couldn't start the export engine",
};

export default function ExportMenu({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const project = useProjectStore((s) => s.project);
  // Optionally controlled: TopBar can drive `open` (so "Export now" in the design
  // check can pop this menu); otherwise it manages its own state.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (v: boolean) => {
    setUncontrolledOpen(v);
    onOpenChange?.(v);
  };
  const [pesVersion, setPesVersion] = useState<PesVersion>(1);
  const [stage, setStage] = useState<LoadStage>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Let keyboard users dismiss the open menu with Escape (don't trap focus — this
  // is a lightweight popover, not a modal dialog).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Recompute the design only while the menu is open.
  const { design, stitches, changes, colorCount, warnings } = useMemo(() => {
    if (!open) return { design: [], stitches: 0, changes: 0, colorCount: 0, warnings: [] };
    const d = designFor(project);
    return {
      design: d,
      stitches: countStitches(d),
      changes: countColorChanges(d),
      // Distinct thread colors — NOT color blocks. A color sewn in two separate
      // blocks (red circle + red crescent) is one color but two thread blocks;
      // the old "changes + 1" label showed "7 colors" on a 6-color design.
      colorCount: new Set(d.map((s) => s.colorId)).size,
      warnings: [
        // The trace only runs at import time and persists with the project, so
        // a stored design keeps its ORIGINAL digitization forever. When that
        // vintage predates the running app, say so — the fix is re-importing
        // the image, and no amount of re-exporting will apply new trace logic.
        ...(project.digitizedBuild && project.digitizedBuild !== buildTag()
          ? [
              {
                level: "warn" as const,
                message: `This design was digitized by an older version (build ${project.digitizedBuild}). Re-import the image to apply the latest digitizer improvements.`,
              },
            ]
          : []),
        ...validateDesign(d, project),
      ],
    };
  }, [open, project]);

  const empty = design.length === 0;

  async function doExport(format: EmbFormat) {
    setBusy(true);
    setError(null);
    try {
      const plan = planFromDesign(design, project.colors);
      await exportAndDownload(plan, `buttery-stitches-${buildTag()}`, {
        format,
        pesVersion,
        onStage: setStage,
      });
      setOpen(false);
      toast(`Exported buttery-stitches-${buildTag()}.${format} to your downloads`, "success");
    } catch (err) {
      const msg = friendlyExportError(err);
      setError(msg);
      toast(`Export failed — ${msg}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function doExportAll() {
    setBusy(true);
    setError(null);
    try {
      const plan = planFromDesign(design, project.colors);
      const zip = await exportBundle(plan, EMB_FORMATS, { pesVersion, onStage: setStage });
      downloadBytes(zip, `buttery-stitches-${buildTag()}.zip`, "application/zip");
      setOpen(false);
      toast(`Exported all ${EMB_FORMATS.length} formats as a .zip`, "success");
    } catch (err) {
      const msg = friendlyExportError(err);
      setError(msg);
      toast(`Export failed — ${msg}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      {/* The deliverable action — labeled and visually distinct from the other
          icon buttons so "how do I get my file?" answers itself at a glance. */}
      <button
        onClick={() => setOpen(!open)}
        data-tip="Export a machine file (PES, DST…)"
        aria-label="Export a machine file"
        aria-expanded={open}
        className="tap-target flex h-9 shrink-0 items-center gap-1.5 rounded-sm border-2 border-butter-200/70 px-2.5 font-label text-xs font-semibold uppercase tracking-[0.08em] text-butter-100 hover:bg-butter-200/15"
      >
        <Download size={16} />
        <span className="hidden sm:inline">Export</span>
      </button>

      {open && (
        <>
          {/* Presentational backdrop — click outside to dismiss; keyboard users
              close via the toggle button or Escape (above). */}
          <div aria-hidden className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Export options"
            // On a phone the bar's export button sits near the right edge, so a
            // left-anchored popover ran off-screen (the DST/JEF/VP3 column was
            // clipped). Pin it on-screen as a centered sheet on narrow screens;
            // keep the inline popover from the `sm` breakpoint up.
            className="anim-press-in fixed inset-x-2 top-14 z-20 mx-auto max-h-[78dvh] w-auto max-w-sm overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-2.5 text-char shadow-press sm:absolute sm:inset-x-auto sm:left-0 sm:top-auto sm:mx-0 sm:mt-1 sm:max-h-[70vh] sm:w-72 sm:max-w-[90vw]"
          >
          {empty ? (
            <p className="px-1 py-2 font-body text-[12px] text-char/60">
              Nothing to export yet — draw or import a design first.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between px-1 pb-2 font-mono text-[11px] text-char/70">
                <span>{stitches.toLocaleString()} stitches</span>
                <span>
                  {colorCount} color{colorCount === 1 ? "" : "s"}
                  {changes + 1 > colorCount ? ` · ${changes + 1} blocks` : ""}
                </span>
              </div>

              {warnings.length > 0 && (
                <ul className="mb-2 max-h-24 overflow-y-auto rounded-sm border border-stamp/30 bg-stamp/5 p-1.5 text-[11px] text-char/80">
                  {warnings.map((w, i) => (
                    <li key={i} className="flex gap-1.5">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-stamp" />
                      <span>{w.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              <label className="mb-2 flex items-center justify-between px-1 font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-deep">
                PES version
                <select
                  value={pesVersion}
                  onChange={(e) => setPesVersion(Number(e.target.value) as PesVersion)}
                  className="select-sm ml-2 font-body"
                >
                  {PES_VERSIONS.map((v) => (
                    <option key={v} value={v}>
                      #PES{String(v).padStart(4, "0")}
                      {v === 1 ? " (compatible)" : " (color)"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-3 gap-1.5">
                {EMB_FORMATS.map((f) => (
                  <button
                    key={f}
                    disabled={busy}
                    onClick={() => doExport(f)}
                    className="tap-target flex flex-col items-center rounded-sm border-2 border-ink bg-cream px-1 py-1.5 shadow-press-sm transition-transform hover:bg-ink hover:text-cream active:translate-y-[2px] active:shadow-none disabled:opacity-40 group"
                  >
                    <span className="font-label text-xs font-semibold uppercase tracking-wide text-ink group-hover:text-cream">{f}</span>
                    <span className="font-body text-[9px] leading-tight text-char/55 group-hover:text-cream/70">{FORMAT_BRAND[f]}</span>
                  </button>
                ))}
              </div>

              <button
                disabled={busy}
                onClick={doExportAll}
                className="tap-target mt-1.5 w-full rounded-sm border-2 border-ink bg-ink px-2 py-1.5 font-label text-xs font-semibold uppercase tracking-wide text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none disabled:opacity-40"
              >
                All formats (.zip)
              </button>

              <p className="mt-2.5 px-1 font-body text-[10px] text-char/70">
                The first export takes a few seconds to get ready, then it's instant.
                <span className="float-right text-char/40">build {buildTag()}</span>
              </p>
            </>
          )}

          {busy && (
            <div className="mt-2 px-1">
              <p className="font-mono text-[11px] text-ink">
                {STAGE_LABEL[stage] || "Working…"}
              </p>
              {/* Indeterminate sweep so the multi-second first run never reads as frozen. */}
              <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-ink/10">
                <div className="anim-indeterminate h-full w-1/3 rounded-full bg-stamp" />
              </div>
            </div>
          )}
          {error && <p className="mt-2 px-1 font-body text-[11px] text-stamp">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
