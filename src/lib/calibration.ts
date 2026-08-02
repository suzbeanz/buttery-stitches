import type { FabricType, ThreadWeight, Project } from "../types/project";
import { buildTestSwatch } from "./samples/swatch";
import { designFor } from "./engine";
import {
  landedStitchPositions,
  PULL_STRAIN,
  BACKING,
  type DistortionOpts,
} from "./bench/distortion";

/**
 * GUIDED FABRIC CALIBRATION — the closed loop that turns the user's own
 * sew-out into per-fabric physics constants.
 *
 * The July 2026 woven sew-out measured dead-on: the engine's heuristic
 * allowances already cancel net pull on stable fabric. On stretch knits,
 * fleece, and sheers they don't — and no amount of desk math can know a given
 * fabric + stabilizer + hooping combination. So: the user sews the built-in
 * calibration swatch, measures a handful of known-dimension shapes with a
 * ruler, and this module fits the distortion model's two constants
 * (pullStrain, backing) to those measurements by deterministic least squares.
 * The fitted constants describe the RESIDUAL the heuristics missed on that
 * fabric; `applyPrecompensation` then cancels exactly that residual at
 * compile time for projects carrying the calibration.
 *
 * Everything here is pure math and fully deterministic — same measurements,
 * same fit.
 */

/** One measurable dimension of the sewn swatch. */
export interface Observable {
  key: ObservableKey;
  /** the swatch object measured (matched by EmbObject.name). */
  objectName: string;
  /** which axis of the landed shape the ruler reads. */
  axis: "x" | "y";
  /** drawn dimension (mm). */
  nominalMm: number;
  /** form label, e.g. "Satin 3mm column width". */
  label: string;
}

export type ObservableKey =
  | "satin1" | "satin2" | "satin3" | "satin5" | "satin7"
  | "circleX" | "circleY"
  | "squareW" | "squareH"
  | "ruler";

/** The swatch dimensions a user measures — nominals from samples/swatch.ts.
 *  The narrow-vs-wide satin ladder is what makes the two-parameter fit
 *  identifiable: pull saturates differently across column widths. */
export const SWATCH_OBSERVABLES: Observable[] = [
  { key: "satin1", objectName: "Satin 1mm", axis: "x", nominalMm: 1, label: "Satin 1 mm column width" },
  { key: "satin2", objectName: "Satin 2mm", axis: "x", nominalMm: 2, label: "Satin 2 mm column width" },
  { key: "satin3", objectName: "Satin 3mm", axis: "x", nominalMm: 3, label: "Satin 3 mm column width" },
  { key: "satin5", objectName: "Satin 5mm", axis: "x", nominalMm: 5, label: "Satin 5 mm column width" },
  { key: "satin7", objectName: "Satin 7mm", axis: "x", nominalMm: 7, label: "Satin 7 mm column width" },
  { key: "circleX", objectName: "Circle 24mm", axis: "x", nominalMm: 24, label: "Circle width (across rows)" },
  { key: "circleY", objectName: "Circle 24mm", axis: "y", nominalMm: 24, label: "Circle height (along rows)" },
  { key: "squareW", objectName: "Square 24mm", axis: "x", nominalMm: 24, label: "Square width" },
  { key: "squareH", objectName: "Square 24mm", axis: "y", nominalMm: 24, label: "Square height" },
  { key: "ruler", objectName: "Ruler 40mm", axis: "x", nominalMm: 40, label: "Ruler line length" },
];

/** A fitted, saveable per-fabric calibration. */
export interface FabricCalibration {
  fabric: FabricType;
  threadWeight: ThreadWeight;
  pullStrain: number;
  backing: number;
  /** mean |measured − model| after the fit (mm) — reported, never hidden. */
  residualMm: number;
  /** ISO date the measurements were entered. */
  measuredAt: string;
}

/** The swatch compiled once — prediction evaluates many θ against it. */
interface SwatchContext {
  design: ReturnType<typeof designFor>;
  /** design indices per observable (real penetrations of the named object). */
  byObservable: Map<ObservableKey, number[]>;
}

function buildContext(): SwatchContext {
  const swatch = buildTestSwatch();
  const idByName = new Map(swatch.objects.map((o) => [o.name ?? "", o.id]));
  const design = designFor(swatch);
  const byObservable = new Map<ObservableKey, number[]>();
  for (const ob of SWATCH_OBSERVABLES) {
    const objectId = idByName.get(ob.objectName);
    const idx: number[] = [];
    design.forEach((s, i) => {
      if (s.objectId === objectId && !s.jump && !s.trim && !s.stop && !s.underlay) idx.push(i);
    });
    byObservable.set(ob.key, idx);
  }
  return { design, byObservable };
}

let ctxCache: SwatchContext | null = null;
function context(): SwatchContext {
  return (ctxCache ??= buildContext());
}

/** Predicted ruler readings (mm per observable) for physics θ. */
export function predictObservables(theta: DistortionOpts): Record<ObservableKey, number> {
  const { design, byObservable } = context();
  const landed = landedStitchPositions(design, theta);
  const out = {} as Record<ObservableKey, number>;
  for (const ob of SWATCH_OBSERVABLES) {
    const idx = byObservable.get(ob.key) ?? [];
    let min = Infinity;
    let max = -Infinity;
    for (const i of idx) {
      const p = landed[i];
      if (!p) continue;
      const v = ob.axis === "x" ? p.x : p.y;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[ob.key] = Number.isFinite(min) ? max - min : ob.nominalMm;
  }
  return out;
}

/** Fit result plus the honest before/after story for the UI. */
export interface FitResult {
  pullStrain: number;
  backing: number;
  /** mean |measured − model(θ̂)| over the entered observables (mm). */
  residualMm: number;
  /** mean |measured − nominal| — the raw error the user is seeing (mm). */
  rawErrorMm: number;
}

/** Tikhonov weight toward the defaults — both parameters scale distortion, so
 *  the objective has a valley; a light pull toward known-plausible physics
 *  picks the physical point on it. */
const LAMBDA = 0.5;

/**
 * Fit (pullStrain, backing) to the user's ruler measurements: deterministic
 * coarse grid over the plausible range, then three rounds of neighborhood
 * halving around the best cell. Observables the user skipped are ignored.
 */
export function fitCalibration(measured: Partial<Record<ObservableKey, number>>): FitResult {
  const entries = SWATCH_OBSERVABLES.filter(
    (ob) => typeof measured[ob.key] === "number" && Number.isFinite(measured[ob.key]),
  );
  const rawErrorMm =
    entries.length > 0
      ? entries.reduce((s, ob) => s + Math.abs((measured[ob.key] as number) - ob.nominalMm), 0) /
        entries.length
      : 0;
  if (entries.length === 0) {
    return { pullStrain: PULL_STRAIN, backing: BACKING, residualMm: 0, rawErrorMm };
  }

  const objective = (pullStrain: number, backing: number): number => {
    const pred = predictObservables({ pullStrain, backing });
    let sum = 0;
    for (const ob of entries) {
      const d = (measured[ob.key] as number) - pred[ob.key];
      sum += d * d;
    }
    const dp = (pullStrain - PULL_STRAIN) / 0.15;
    const db = (backing - BACKING) / 0.3;
    return sum / entries.length + LAMBDA * (dp * dp + db * db) * 0.01;
  };

  // Coarse grid over the plausible physics range.
  let best = { p: PULL_STRAIN, b: BACKING, f: Infinity };
  const P0 = 0;
  const P1 = 0.15;
  const B0 = 0.02;
  const B1 = 0.3;
  const N = 9;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const p = P0 + ((P1 - P0) * i) / N;
      const b = B0 + ((B1 - B0) * j) / N;
      const f = objective(p, b);
      if (f < best.f) best = { p, b, f };
    }
  }
  // Neighborhood halving refinement (deterministic; 3 rounds × 3×3 probes).
  let stepP = (P1 - P0) / N;
  let stepB = (B1 - B0) / N;
  for (let round = 0; round < 3; round++) {
    stepP /= 2;
    stepB /= 2;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        const p = Math.min(P1, Math.max(P0, best.p + di * stepP));
        const b = Math.min(B1, Math.max(B0, best.b + dj * stepB));
        const f = objective(p, b);
        if (f < best.f) best = { p, b, f };
      }
    }
  }

  const pred = predictObservables({ pullStrain: best.p, backing: best.b });
  const residualMm =
    entries.reduce((s, ob) => s + Math.abs((measured[ob.key] as number) - pred[ob.key]), 0) /
    entries.length;
  return { pullStrain: best.p, backing: best.b, residualMm, rawErrorMm };
}

// ---------------------------------------------------------------------------
// Saved calibration profiles (localStorage, best-effort like customCharts.ts).
// ---------------------------------------------------------------------------

const STORE_KEY = "bs:calibration:v1";

export function loadCalibrations(): FabricCalibration[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is FabricCalibration =>
        !!c &&
        typeof (c as FabricCalibration).pullStrain === "number" &&
        typeof (c as FabricCalibration).backing === "number",
    );
  } catch {
    return [];
  }
}

/** Save (upsert by fabric + thread weight). */
export function saveCalibration(cal: FabricCalibration): void {
  try {
    const rest = loadCalibrations().filter(
      (c) => !(c.fabric === cal.fabric && c.threadWeight === cal.threadWeight),
    );
    localStorage.setItem(STORE_KEY, JSON.stringify([...rest, cal]));
  } catch {
    // best-effort (private mode, quota)
  }
}

export function removeCalibration(fabric: FabricType, threadWeight: ThreadWeight): void {
  try {
    const rest = loadCalibrations().filter(
      (c) => !(c.fabric === fabric && c.threadWeight === threadWeight),
    );
    localStorage.setItem(STORE_KEY, JSON.stringify(rest));
  } catch {
    // best-effort
  }
}

/** The saved profile matching a project's fabric settings, if any. */
export function calibrationFor(project: Project): FabricCalibration | undefined {
  return loadCalibrations().find(
    (c) => c.fabric === (project.fabric ?? "woven") && c.threadWeight === (project.threadWeight ?? 40),
  );
}
