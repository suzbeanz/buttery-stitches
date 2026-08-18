import { describe, it, expect } from "vitest";
import { generateObjectRuns } from "./index";
import { fixStitches } from "../fix";
import { createEmptyProject } from "../project";
import type { EmbObject, Project } from "../../types/project";

/** A rectangle fill object. */
function rect(x: number, y: number, w: number, h: number, params: EmbObject["params"] = {}): EmbObject {
  return {
    id: `o${x}_${y}`,
    name: "r",
    type: "fill",
    colorId: "c1",
    paths: [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]],
    params,
    visible: true,
  };
}

/** Dominant row angles (deg, mod 180, 10° bins) of a run set's long segments. */
function angleBins(runs: { pts: { x: number; y: number }[] }[]): Set<number> {
  const bins = new Map<number, number>();
  for (const r of runs) {
    for (let i = 1; i < r.pts.length; i++) {
      const dx = r.pts[i].x - r.pts[i - 1].x;
      const dy = r.pts[i].y - r.pts[i - 1].y;
      if (Math.hypot(dx, dy) < 2) continue; // row segments only
      const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
      const bin = Math.round(a / 10) * 10 % 180;
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
  }
  const total = [...bins.values()].reduce((s, v) => s + v, 0);
  return new Set([...bins.entries()].filter(([, v]) => v >= total * 0.15).map(([k]) => k));
}

describe("sketch / crosshatch fills", () => {
  it("sketch lays open single-angle rows at the requested wide spacing, with no underlay or edge run", () => {
    const o = rect(10, 10, 30, 20, { fillStyle: "sketch", density: 1.0, angle: 0 });
    const runs = generateObjectRuns(o);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some((r) => r.underlay), "no underlay under an open fill").toBe(false);
    // Row count reflects the open spacing: a 20mm-tall rect at 1.0mm/row lays
    // ~20 rows (a solid 0.32 fill would need 60+). Estimate rows by thread
    // length: serpentine length ≈ rows × width.
    let len = 0;
    for (const r of runs)
      for (let i = 1; i < r.pts.length; i++)
        len += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
    const approxRows = len / 30;
    expect(approxRows).toBeGreaterThan(12);
    expect(approxRows).toBeLessThan(32);
    // One dominant row direction.
    expect(angleBins(runs).size).toBeLessThanOrEqual(2);
  });

  it("crosshatch lays two row families at crossing angles", () => {
    const o = rect(10, 10, 30, 20, { fillStyle: "crosshatch", density: 1.0, angle: 0 });
    const runs = generateObjectRuns(o);
    const bins = angleBins(runs);
    // Two distinct families ~60° apart (each may straddle two 10° bins).
    expect(bins.size).toBeGreaterThanOrEqual(2);
    const list = [...bins].sort((a, b) => a - b);
    const spread = Math.min(
      180 - (list[list.length - 1] - list[0]),
      list[list.length - 1] - list[0],
    );
    expect(spread).toBeGreaterThanOrEqual(40);
  });

  it("fixStitches allows open spacing for sketch styles but clamps solids at 0.5", () => {
    const project: Project = {
      ...createEmptyProject(),
      widthMm: 100,
      heightMm: 100,
      colors: [{ id: "c1", rgb: [40, 40, 40] }],
      objects: [
        rect(5, 5, 20, 10, { fillStyle: "sketch", density: 1.2 }),
        rect(5, 40, 20, 10, { density: 1.2 }),
      ],
    };
    const fixed = fixStitches(project);
    expect(fixed.objects[0].params.density).toBe(1.2);
    expect(fixed.objects[1].params.density).toBe(0.5);
    expect(fixed.objects[0].params.underlay, "open style defaults underlay off").toBe(false);
  });
});

describe("per-region auto fill angle", () => {
  it("elongated regions of one object each sew along their own grain", () => {
    // One object, two long bars: horizontal and vertical. With a single shared
    // grain one of them sews ACROSS its length; per-region each follows its own.
    const o: EmbObject = {
      id: "bars",
      name: "bars",
      type: "fill",
      colorId: "c1",
      paths: [
        [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 18 }, { x: 10, y: 18 }],
        [{ x: 80, y: 10 }, { x: 88, y: 10 }, { x: 88, y: 60 }, { x: 80, y: 60 }],
      ],
      params: { fillStyle: "tatami", underlay: false },
      visible: true,
    };
    const runs = generateObjectRuns(o);
    // Split runs by which bar they're in.
    const inBar1 = runs.filter((r) => r.pts.length && r.pts[0].x < 70);
    const inBar2 = runs.filter((r) => r.pts.length && r.pts[0].x >= 70);
    expect(inBar1.length).toBeGreaterThan(0);
    expect(inBar2.length).toBeGreaterThan(0);
    const dominant = (rs: typeof runs): number => {
      let hx = 0;
      let hy = 0;
      for (const r of rs)
        for (let i = 1; i < r.pts.length; i++) {
          const dx = r.pts[i].x - r.pts[i - 1].x;
          const dy = r.pts[i].y - r.pts[i - 1].y;
          if (Math.hypot(dx, dy) < 2) continue;
          hx += Math.abs(dx);
          hy += Math.abs(dy);
        }
      return (Math.atan2(hy, hx) * 180) / Math.PI;
    };
    // Horizontal bar rows run mostly horizontal; vertical bar rows mostly vertical.
    expect(dominant(inBar1)).toBeLessThan(35);
    expect(dominant(inBar2)).toBeGreaterThan(55);
  });
});
