import { useMemo, useState } from "react";
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

/**
 * Export menu. Runs the stitch engine on the current project, shows a quick
 * summary + any validation warnings, then exports through Pyodide/pyembroidery.
 */

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

  // Recompute the design only while the menu is open.
  const { design, stitches, changes, warnings } = useMemo(() => {
    if (!open) return { design: [], stitches: 0, changes: 0, warnings: [] };
    const d = designFor(project);
    return {
      design: d,
      stitches: countStitches(d),
      changes: countColorChanges(d),
      warnings: validateDesign(d, project),
    };
  }, [open, project]);

  const empty = design.length === 0;

  async function doExport(format: EmbFormat) {
    setBusy(true);
    setError(null);
    try {
      const plan = planFromDesign(design, project.colors);
      await exportAndDownload(plan, "buttery-stitches", {
        format,
        pesVersion,
        onStage: setStage,
      });
      setOpen(false);
      toast(`Exported buttery-stitches.${format} to your downloads`, "success");
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
      downloadBytes(zip, "buttery-stitches.zip", "application/zip");
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
      <button
        onClick={() => setOpen(!open)}
        data-tip="Export"
        aria-label="Export"
        aria-expanded={open}
        className="tap-target grid h-9 w-9 shrink-0 place-items-center rounded-lg text-butter-100 hover:bg-butter-200/15"
      >
        <Download size={18} />
      </button>

      {open && (
        <div className="anim-press-in absolute left-0 z-20 mt-1 max-h-[70vh] w-72 max-w-[90vw] overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-2.5 text-char shadow-press">
          {empty ? (
            <p className="px-1 py-2 font-body text-[12px] text-char/60">
              Nothing to export yet — draw or import a design first.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between px-1 pb-2 font-mono text-[11px] text-char/70">
                <span>{stitches.toLocaleString()} stitches</span>
                <span>
                  {changes + 1} color{changes === 0 ? "" : "s"}
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
                  className="ml-2 rounded-sm border-2 border-ink/70 bg-white px-1 py-0.5 font-body text-xs text-char"
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
                    className="tap-target rounded-sm border-2 border-ink bg-cream px-2 py-1.5 font-label text-xs font-semibold uppercase tracking-wide text-ink shadow-press-sm transition-transform hover:bg-ink hover:text-cream active:translate-y-[2px] active:shadow-none disabled:opacity-50"
                  >
                    {f}
                  </button>
                ))}
              </div>

              <button
                disabled={busy}
                onClick={doExportAll}
                className="tap-target mt-1.5 w-full rounded-sm border-2 border-ink bg-ink px-2 py-1.5 font-label text-xs font-semibold uppercase tracking-wide text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none disabled:opacity-50"
              >
                All formats (.zip)
              </button>

              <p className="mt-2.5 px-1 font-body text-[10px] text-char/70">
                The first export takes a few seconds to get ready, then it's instant.
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
      )}
    </div>
  );
}
