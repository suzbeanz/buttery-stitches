import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Ruler, Loader2 } from "lucide-react";
import { useDialogFocus, useEscapeToClose } from "./useEscapeToClose";
import { useProjectStore } from "../store/projectStore";
import { toast } from "../store/toastStore";
import { buildTestSwatch } from "../lib/samples/swatch";
import {
  SWATCH_OBSERVABLES,
  fitCalibration,
  saveCalibration,
  type ObservableKey,
  type FitResult,
} from "../lib/calibration";
import { DEFAULT_FABRIC, DEFAULT_THREAD_WEIGHT, FABRICS } from "../types/project";

/**
 * GUIDED FABRIC CALIBRATION — sew the built-in swatch, measure a few shapes
 * with a ruler, and the app fits the fabric-pull physics to YOUR fabric +
 * stabilizer + hooping. The fitted constants ride the project (and can be
 * saved per fabric), and the engine pre-warps every stitch so the sewn result
 * lands on the digitized intent. Wilcom ships decades of fabric presets;
 * this loop measures the one fabric that matters — the user's.
 */
export default function CalibrateDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  useEscapeToClose(onClose);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entered, setEntered] = useState<Partial<Record<ObservableKey, string>>>({});
  const [fitting, setFitting] = useState(false);
  const [fit, setFit] = useState<FitResult | null>(null);

  const fabric = project.fabric ?? DEFAULT_FABRIC;
  const threadWeight = project.threadWeight ?? DEFAULT_THREAD_WEIGHT;

  const loadSwatch = () => {
    if (
      project.objects.length > 0 &&
      !window.confirm("Replace the current design with the calibration swatch?")
    ) {
      return;
    }
    useProjectStore.getState().setProject(buildTestSwatch());
    useProjectStore.temporal.getState().clear();
    toast("Loaded the calibration swatch — export it and stitch a test", "success");
    onClose();
  };

  const runFit = () => {
    const measured: Partial<Record<ObservableKey, number>> = {};
    for (const ob of SWATCH_OBSERVABLES) {
      const raw = entered[ob.key];
      if (raw === undefined || raw.trim() === "") continue;
      const v = Number(raw);
      if (Number.isFinite(v) && v > 0) measured[ob.key] = v;
    }
    setFitting(true);
    // Yield a frame so the busy state paints before the ~seconds-long fit.
    setTimeout(() => {
      try {
        setFit(fitCalibration(measured));
        setStep(3);
      } finally {
        setFitting(false);
      }
    }, 30);
  };

  const applyToProject = () => {
    if (!fit) return;
    useProjectStore
      .getState()
      .updateProject({ calibration: { pullStrain: fit.pullStrain, backing: fit.backing } });
    toast("Calibration applied — the design now pre-compensates for this fabric", "success");
    onClose();
  };

  const saveProfile = () => {
    if (!fit) return;
    saveCalibration({
      fabric,
      threadWeight,
      pullStrain: fit.pullStrain,
      backing: fit.backing,
      residualMm: fit.residualMm,
      measuredAt: new Date().toISOString().slice(0, 10),
    });
    toast(`Saved calibration profile for ${FABRICS[fabric].name} @ ${threadWeight}wt`, "success");
  };

  return createPortal(
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
        aria-label="Calibrate fabric"
        tabIndex={-1}
        className="anim-press-in max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-5 text-navy shadow-press outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-label text-lg font-semibold uppercase tracking-[0.08em]">
            Calibrate fabric
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-full text-navy/40 hover:bg-butter-200 hover:text-navy"
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-3 font-body text-sm">
            <p>
              Every fabric + stabilizer + hooping pulls differently. Sew the built-in
              calibration swatch on <strong>{FABRICS[fabric].name}</strong>, measure a few
              shapes with a ruler, and the app fits its pull model to your setup — then
              pre-warps every stitch so the sewn result lands on the drawn dimensions.
            </p>
            <p className="text-navy/60">
              Woven cotton measured dead-on in our reference sew-out — calibration matters
              most for knits, fleece, and sheers.
            </p>
            <div className="flex gap-2">
              <button
                onClick={loadSwatch}
                className="rounded-sm border-2 border-ink bg-butter-200 px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-wide hover:bg-butter-300"
              >
                Load swatch to sew
              </button>
              <button
                onClick={() => setStep(2)}
                className="rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-wide text-cream hover:bg-navy"
              >
                I sewed it — measure
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3 font-body text-sm">
            <p className="flex items-center gap-1.5 text-navy/70">
              <Ruler size={14} aria-hidden /> Measure each sewn shape in mm (skip any you
              can&apos;t read cleanly):
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {SWATCH_OBSERVABLES.map((ob) => (
                <label key={ob.key} className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    {ob.label}
                    <span className="text-navy/50"> (drawn {ob.nominalMm} mm)</span>
                  </span>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    inputMode="decimal"
                    placeholder={String(ob.nominalMm)}
                    value={entered[ob.key] ?? ""}
                    onChange={(e) => setEntered((p) => ({ ...p, [ob.key]: e.target.value }))}
                    className="w-20 rounded-sm border-2 border-ink/40 bg-white px-1.5 py-0.5 text-right focus:border-ink"
                    aria-label={ob.label}
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setStep(1)}
                className="rounded-sm border-2 border-ink/40 px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-wide hover:bg-butter-200"
              >
                Back
              </button>
              <button
                onClick={runFit}
                disabled={fitting || Object.values(entered).every((v) => !v || !v.trim())}
                className="flex items-center gap-1.5 rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-wide text-cream hover:bg-navy disabled:opacity-40"
              >
                {fitting && <Loader2 size={13} className="animate-spin" aria-hidden />}
                {fitting ? "Fitting…" : "Fit calibration"}
              </button>
            </div>
          </div>
        )}

        {step === 3 && fit && (
          <div className="flex flex-col gap-3 font-body text-sm">
            <p>
              Your measurements are off the drawn dimensions by{" "}
              <strong>{fit.rawErrorMm.toFixed(2)} mm</strong> on average. The fitted model
              explains that to within <strong>{fit.residualMm.toFixed(2)} mm</strong> —
              what remains is beyond this first-order pull model (reported, not hidden).
            </p>
            <p className="text-xs text-navy/60">
              Fitted physics: thread pull {fit.pullStrain.toFixed(3)}, fabric hold{" "}
              {fit.backing.toFixed(3)}.
            </p>
            {fabric === "woven" && (
              <p className="rounded bg-butter-200 px-2 py-1.5 text-xs">
                Woven measured dead-on in the reference sew-out — apply only if your
                measurements above genuinely drift.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={saveProfile}
                className="rounded-sm border-2 border-ink/40 px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-wide hover:bg-butter-200"
              >
                Save profile
              </button>
              <button
                onClick={applyToProject}
                className="rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-wide text-cream hover:bg-navy"
              >
                Apply to this design
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
