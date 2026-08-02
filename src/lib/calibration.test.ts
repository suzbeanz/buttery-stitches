import { describe, it, expect } from "vitest";
import {
  SWATCH_OBSERVABLES,
  predictObservables,
  fitCalibration,
  type ObservableKey,
} from "./calibration";
import { PULL_STRAIN, BACKING } from "./bench/distortion";
import { parseProject, serializeProject, createEmptyProject } from "./project";
import { buildTestSwatch } from "./samples/swatch";
import { generateDesign } from "./engine";

/**
 * The calibration loop's promise: feed it ruler measurements produced by a
 * KNOWN physics and it recovers that physics (within ruler quantization),
 * reports its residual honestly, and the fitted constants change what the
 * engine compiles — deterministically, machine-safely.
 */

describe("predictObservables", () => {
  it("predicts near-nominal at zero pull", () => {
    const pred = predictObservables({ pullStrain: 0, backing: 0.3 });
    for (const ob of SWATCH_OBSERVABLES) {
      expect(Math.abs(pred[ob.key] - ob.nominalMm)).toBeLessThan(1.2);
    }
  });

  it("higher pull strain narrows the satin columns monotonically", () => {
    const soft = predictObservables({ pullStrain: 0.1, backing: 0.04 });
    const gentle = predictObservables({ pullStrain: 0.02, backing: 0.04 });
    for (const key of ["satin3", "satin5", "satin7"] as ObservableKey[]) {
      expect(soft[key]).toBeLessThan(gentle[key]);
    }
  });

  it("is deterministic", () => {
    expect(predictObservables({ pullStrain: 0.07, backing: 0.06 })).toEqual(
      predictObservables({ pullStrain: 0.07, backing: 0.06 }),
    );
  });
});

describe("fitCalibration", () => {
  it("recovers a known physics from quantized ruler readings", () => {
    const truth = { pullStrain: 0.09, backing: 0.05 };
    const pred = predictObservables(truth);
    // The user reads a ruler at 0.1mm.
    const measured = Object.fromEntries(
      SWATCH_OBSERVABLES.map((ob) => [ob.key, Math.round(pred[ob.key] * 10) / 10]),
    ) as Record<ObservableKey, number>;
    const fit = fitCalibration(measured);
    // Recovered physics reproduces the readings within ~ruler resolution;
    // exact θ recovery isn't required (the objective has a valley — several
    // physics explain the same rulers, and any of them compensates equally).
    expect(fit.residualMm).toBeLessThan(0.15);
    const refit = predictObservables(fit);
    for (const ob of SWATCH_OBSERVABLES) {
      expect(Math.abs(refit[ob.key] - measured[ob.key])).toBeLessThan(0.3);
    }
    expect(fit.rawErrorMm).toBeGreaterThan(fit.residualMm);
  });

  it("returns the defaults when nothing was measured", () => {
    const fit = fitCalibration({});
    expect(fit.pullStrain).toBe(PULL_STRAIN);
    expect(fit.backing).toBe(BACKING);
  });

  it("ignores skipped observables", () => {
    const truth = { pullStrain: 0.08, backing: 0.06 };
    const pred = predictObservables(truth);
    const fit = fitCalibration({
      satin3: Math.round(pred.satin3 * 10) / 10,
      satin7: Math.round(pred.satin7 * 10) / 10,
      circleX: Math.round(pred.circleX * 10) / 10,
    });
    expect(fit.residualMm).toBeLessThan(0.15);
  });
});

describe("project calibration wire-up", () => {
  it("round-trips through serialize/parse and rejects junk", () => {
    const p = { ...createEmptyProject(), calibration: { pullStrain: 0.09, backing: 0.05 } };
    const back = parseProject(JSON.parse(serializeProject(p)));
    expect(back.calibration).toEqual({ pullStrain: 0.09, backing: 0.05 });
    const junk = parseProject(
      JSON.parse(serializeProject({ ...createEmptyProject(), calibration: { pullStrain: 99, backing: -1 } as never })),
    );
    expect(junk.calibration).toBeUndefined();
  });

  it("a calibration changes the compiled stream (and only then)", () => {
    const swatch = buildTestSwatch();
    const plain = generateDesign(swatch);
    const same = generateDesign({ ...swatch });
    expect(JSON.stringify(same)).toBe(JSON.stringify(plain)); // no calibration → identical
    const calibrated = generateDesign({ ...swatch, calibration: { pullStrain: 0.09, backing: 0.05 } });
    expect(calibrated.length).toBeGreaterThan(0);
    expect(JSON.stringify(calibrated)).not.toBe(JSON.stringify(plain));
    // Machine safety holds on the compensated stream.
    for (let i = 1; i < calibrated.length; i++) {
      const a = calibrated[i - 1];
      const b = calibrated[i];
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      if (b.jump || b.trim || a.jump || a.trim) continue;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(9);
    }
  });
});
