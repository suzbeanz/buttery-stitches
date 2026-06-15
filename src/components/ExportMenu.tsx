import { useMemo, useState } from "react";
import { Download, AlertTriangle } from "lucide-react";
import type { LoadStage } from "../lib/pyodide/loader";
import { useProjectStore } from "../store/projectStore";
import {
  EMB_FORMATS,
  PES_VERSIONS,
  exportAndDownload,
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
  "loading-runtime": "Loading Python runtime…",
  "loading-micropip": "Loading micropip…",
  "installing-pyembroidery": "Installing pyembroidery…",
  ready: "Ready",
  error: "Failed to load",
};

export default function ExportMenu() {
  const project = useProjectStore((s) => s.project);
  const [open, setOpen] = useState(false);
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        data-tip="Export"
        aria-label="Export"
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-lg text-butter-100 hover:bg-butter-200/15"
      >
        <Download size={18} />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-navy/30 bg-butter-50 p-2 text-navy shadow-xl">
          {empty ? (
            <p className="px-1 py-2 text-[12px] text-navy/60">
              Nothing to export yet — draw or import a design first.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between px-1 pb-2 text-[11px] text-navy/70">
                <span>{stitches.toLocaleString()} stitches</span>
                <span>
                  {changes + 1} color{changes === 0 ? "" : "s"}
                </span>
              </div>

              {warnings.length > 0 && (
                <ul className="mb-2 max-h-24 overflow-y-auto rounded bg-butter-200/60 p-1.5 text-[11px] text-navy/80">
                  {warnings.map((w, i) => (
                    <li key={i} className="flex gap-1.5">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-butter-600" />
                      <span>{w.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              <label className="mb-2 flex items-center justify-between px-1 text-xs text-navy/70">
                PES version
                <select
                  value={pesVersion}
                  onChange={(e) => setPesVersion(Number(e.target.value) as PesVersion)}
                  className="ml-2 rounded border border-navy/30 bg-white px-1 py-0.5 text-navy"
                >
                  {PES_VERSIONS.map((v) => (
                    <option key={v} value={v}>
                      #PES{String(v).padStart(4, "0")}
                      {v === 1 ? " (compatible)" : " (color)"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-3 gap-1">
                {EMB_FORMATS.map((f) => (
                  <button
                    key={f}
                    disabled={busy}
                    onClick={() => doExport(f)}
                    className="rounded bg-butter-200 px-2 py-1.5 text-xs uppercase text-navy hover:bg-butter-300 disabled:opacity-50"
                  >
                    {f}
                  </button>
                ))}
              </div>

              <p className="mt-2 px-1 text-[10px] text-navy/50">
                First export loads the Python runtime (a few seconds, then cached).
              </p>
            </>
          )}

          {busy && (
            <p className="mt-2 px-1 text-[11px] text-navy">
              {STAGE_LABEL[stage] || "Working…"}
            </p>
          )}
          {error && <p className="mt-2 px-1 text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
