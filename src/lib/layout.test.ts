import { describe, it, expect } from "vitest";
import { designSize, designBounds, resizeToWidth, fitToHoop, scaleAllPaths } from "./layout";
import { makeObjectFromPaths, makeNodeObject } from "./objects";
import { generateDesign, countStitches } from "./engine";
import { createEmptyProject } from "./project";
import type { EmbObject } from "../types/project";

describe("resize keeps the node model in sync", () => {
  it("scales nodes together with paths (curves survive a resize)", () => {
    const o = makeNodeObject(
      "fill",
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      "c1",
      true,
    );
    const before = Math.max(...o.paths[0].map((p) => p.x));
    const [scaled] = scaleAllPaths([o], 2, 2, { x: 0, y: 0 });
    expect(scaled.nodes![0][1]).toMatchObject({ x: 20, y: 0, smooth: true });
    // paths scale in lock-step with the nodes (≈2×), curve overshoot included.
    expect(Math.max(...scaled.paths[0].map((p) => p.x))).toBeCloseTo(before * 2, 1);
  });
});

function square(x0: number, y0: number, s: number): EmbObject {
  return makeObjectFromPaths(
    "fill",
    [
      [
        { x: x0, y: y0 },
        { x: x0 + s, y: y0 },
        { x: x0 + s, y: y0 + s },
        { x: x0, y: y0 + s },
      ],
    ],
    "c1",
  );
}

describe("layout", () => {
  it("measures design size and bounds", () => {
    const objs = [square(10, 10, 20)];
    expect(designSize(objs)).toEqual({ w: 20, h: 20 });
    expect(designBounds(objs)).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 30 });
  });

  it("resizes uniformly to a target width about the center", () => {
    const resized = resizeToWidth([square(0, 0, 10)], 20);
    expect(designSize(resized).w).toBeCloseTo(20);
    expect(designSize(resized).h).toBeCloseTo(20);
  });

  it("fits the design inside the hoop and centers it", () => {
    const hoop = { wMm: 100, hMm: 100 };
    const fitted = fitToHoop([square(0, 0, 500)], hoop, 0.9);
    const b = designBounds(fitted)!;
    expect(b.maxX - b.minX).toBeLessThanOrEqual(90 + 1e-6);
    // centered
    expect((b.minX + b.maxX) / 2).toBeCloseTo(50);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(50);
  });
});

describe("re-densification (acceptance criterion)", () => {
  it("scales stitch count with area, not leaving it identical", () => {
    const p = createEmptyProject();
    const small = square(10, 10, 20);
    small.colorId = p.colors[0].id;

    p.objects = [small];
    const before = countStitches(generateDesign(p));

    // Double the size → ~4× the area → materially more stitches.
    p.objects = resizeToWidth(p.objects, 40);
    const after = countStitches(generateDesign(p));

    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(before * 2); // not a naive point-scale
  });
});
