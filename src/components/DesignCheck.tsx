import { useMemo } from "react";
import { CheckCircle2, AlertTriangle, X, Wand2, Sparkles, Download } from "lucide-react";
import { useDialogFocus, useEscapeToClose } from "./useEscapeToClose";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { designFor, countStitches, countColorChanges } from "../lib/engine";
import { designInfo } from "../lib/engine/info";
import { validateDesign } from "../lib/engine/validate";
import { fixStitches } from "../lib/fix";
import { mmToInch } from "../lib/units";
import { toast } from "../store/toastStore";

/**
 * The "is my design ready to sew?" check — the deliberate finalize step. It runs
 * the same machine/quality validation the live panel uses, but as a clear,
 * confidence-giving verdict before export: a green all-clear, or a friendly list
 * of what to fix (with a one-click auto clean-up).
 */
export default function DesignCheck({
  onClose,
  onExport,
}: {
  onClose: () => void;
  onExport?: () => void;
}) {
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const rulerUnit = useEditorStore((s) => s.rulerUnit);
  // Move focus into the dialog, trap Tab, and restore focus on close; Esc dismisses.
  const dialogRef = useDialogFocus<HTMLDivElement>();
  useEscapeToClose(onClose);

  const design = useMemo(() => designFor(project), [project]);
  const warnings = useMemo(() => validateDesign(design, project), [design, project]);
  const stitches = countStitches(design);
  const colorChanges = countColorChanges(design);
  const info = useMemo(() => designInfo(design, project), [design, project]);
  const threadLen =
    rulerUnit === "inch"
      ? `${(info.threadLengthMm / 25.4 / 12).toFixed(1)} ft`
      : `${(info.threadLengthMm / 1000).toFixed(1)} m`;
  const runtime =
    info.runtimeMin >= 1
      ? `${Math.round(info.runtimeMin)} min`
      : `${Math.max(1, Math.round(info.runtimeMin * 60))} s`;
  const visible = project.objects.filter((o) => o.visible).length;
  const empty = visible === 0;
  const ready = !empty && warnings.length === 0;

  const dims =
    rulerUnit === "inch"
      ? `${mmToInch(project.widthMm).toFixed(2)} × ${mmToInch(project.heightMm).toFixed(2)} in`
      : `${project.widthMm.toFixed(0)} × ${project.heightMm.toFixed(0)} mm`;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="anim-scrim-in fixed inset-0 z-50 flex items-center justify-center bg-navy/30 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Check design"
        tabIndex={-1}
        className="anim-press-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-5 text-navy shadow-press outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-label text-lg font-semibold uppercase tracking-[0.08em]">
            Check design
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-full text-navy/40 hover:bg-butter-200 hover:text-navy"
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        {empty ? (
          <p className="font-body text-sm text-navy/70">
            Nothing to check yet — draw a shape, add words, or bring in an image first.
          </p>
        ) : ready ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <CheckCircle2 size={44} className="text-ink-deep" aria-hidden />
            <div className="font-display text-2xl uppercase tracking-wide text-ink-deep">
              Ready to stitch
            </div>
            <p className="font-body text-sm text-navy/70">
              Every stitch is mapped within safe limits. You&apos;re good to export.
            </p>
            {onExport && (
              <button
                onClick={onExport}
                className="mt-2 flex items-center justify-center gap-2 rounded-sm border-2 border-ink bg-ink px-5 py-2 font-label text-sm font-semibold uppercase tracking-[0.1em] text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
              >
                <Download size={15} /> Export now
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 font-label text-sm font-semibold uppercase tracking-wide text-stamp">
              <AlertTriangle size={16} aria-hidden />
              {warnings.length} thing{warnings.length === 1 ? "" : "s"} to look at
            </div>
            <ul className="flex flex-col gap-1.5">
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 font-body text-[13px] leading-snug text-navy/80">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-stamp" aria-hidden />
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => {
                setProject(fixStitches(project));
                toast("Stitching cleaned up — re-checking", "success");
              }}
              className="mt-1 flex items-center justify-center gap-2 rounded-sm border-2 border-ink bg-ink px-4 py-2 font-label text-sm font-semibold uppercase tracking-[0.1em] text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
            >
              <Wand2 size={15} /> Clean up automatically
            </button>
            <p className="text-center font-body text-[11px] text-navy/50">
              These are guidance, not blockers — you can still export.
            </p>
          </div>
        )}

        {!empty && (
          <div className="mt-4 grid grid-cols-3 gap-2 border-t-2 border-ink/10 pt-3 text-center">
            <Stat label="Stitches" value={stitches.toLocaleString()} />
            <Stat label="Colors" value={String(colorChanges + 1)} />
            <Stat label="Size" value={dims} icon />
            <Stat label="Thread" value={threadLen} />
            <Stat label="Est. time" value={runtime} />
            <Stat label="Hoop" value={info.withinHoop ? "Fits" : "Too big"} />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="flex items-center gap-1 font-mono text-[13px] tabular-nums text-ink-deep">
        {icon && <Sparkles size={11} className="text-stamp" aria-hidden />}
        {value}
      </span>
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-navy/45">
        {label}
      </span>
    </div>
  );
}
