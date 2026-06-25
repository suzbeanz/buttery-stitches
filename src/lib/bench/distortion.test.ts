import { describe, it, expect } from "vitest";
import type { EngineStitch } from "../engine";
import { designFor } from "../engine";
import { DEFAULT_PARAMS } from "../../types/project";
import type { Project } from "../../types/project";
import { simulateDistortion, precompensate } from "./distortion";

const s = (x: number, y: number, extra: Partial<EngineStitch> = {}): EngineStitch => ({
  x, y, colorId: "c1", objectId: "o1", ...extra,
});

describe("fabric-pull simulation", () => {
  it("is zero without any stitched springs", () => {
    expect(simulateDistortion([]).meanMm).toBe(0);
    expect(simulateDistortion([s(0, 0, { jump: true })]).pullInMm).toBe(0);
  });

  it("a taut line of stitches contracts (positive displacement)", () => {
    // 20 penetrations 4mm apart along a line; tension gathers them.
    const line = Array.from({ length: 20 }, (_, i) => s(i * 4, 0));
    const d = simulateDistortion(line);
    expect(d.meanMm).toBeGreaterThan(0);
    expect(d.maxMm).toBeGreaterThan(d.meanMm - 1e-9);
  });

  function rectFill(density: number): Project {
    return {
      version: 1,
      widthMm: 100,
      heightMm: 100,
      hoop: { wMm: 100, hMm: 100, name: "t" },
      colors: [{ id: "c-green", rgb: [64, 158, 52], name: "Green" }],
      objects: [
        {
          id: "rect",
          name: "rect",
          type: "fill",
          colorId: "c-green",
          paths: [[
            { x: 30, y: 38 }, { x: 70, y: 38 }, { x: 70, y: 62 }, { x: 30, y: 62 },
          ]],
          params: { ...DEFAULT_PARAMS, fillStyle: "tatami", density },
          visible: true,
        },
      ],
    };
  }

  it("a solid fill predicts a net inward pull near real pull-comp (~0.2mm)", () => {
    const d = simulateDistortion(designFor(rectFill(0.4)));
    expect(d.pullInMm).toBeGreaterThan(0.05);
    expect(d.pullInMm).toBeLessThan(0.6); // sane magnitude, not runaway
  });

  it("a denser fill pulls in at least as much as a sparser one", () => {
    const dense = simulateDistortion(designFor(rectFill(0.3))).pullInMm;
    const sparse = simulateDistortion(designFor(rectFill(0.6))).pullInMm;
    expect(dense).toBeGreaterThanOrEqual(sparse - 1e-6);
  });

  it("pre-compensation drives the landed-vs-target error toward zero", () => {
    const r = precompensate(designFor(rectFill(0.4)));
    expect(r.beforeMm).toBeGreaterThan(0.1); // the raw pull is real
    expect(r.afterMm).toBeLessThan(r.beforeMm * 0.3); // cancelled to <30% of it
    expect(r.placed.length).toBeGreaterThan(0);
  });

  it("pre-compensation is a no-op on an empty design", () => {
    expect(precompensate([])).toMatchObject({ beforeMm: 0, afterMm: 0 });
  });
});
