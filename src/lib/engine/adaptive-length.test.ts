import { describe, it, expect } from "vitest";
import type { EmbObject, Project, ThreadColor } from "../../types/project";
import { designFor, adaptiveFillStitchLength } from "./index";

/**
 * Professional size scaling, measured from a 9-size reference series of one
 * design (25→120mm): fill stitch length grows with the object's size and
 * saturates at the 4mm default (≈2.1mm @25mm, ≈2.9 @50, ≈3.9 @80+), while row
 * spacing stays constant. These tests pin our fitted curve to those measured
 * numbers, and that an explicit user value always wins over the adaptation.
 */
const RED: ThreadColor = { id: "red", rgb: [196, 40, 40], name: "Red" };

function square(sizeMm: number, params: EmbObject["params"] = {}): Project {
  const o = 60 - sizeMm / 2;
  const ring = [
    { x: o, y: o }, { x: o + sizeMm, y: o }, { x: o + sizeMm, y: o + sizeMm }, { x: o, y: o + sizeMm },
  ];
  const obj: EmbObject = {
    id: "sq", name: "sq", type: "fill", colorId: RED.id,
    paths: [ring], params: { fillStyle: "tatami", ...params }, visible: true,
  };
  return {
    version: 1, widthMm: 120, heightMm: 120,
    hoop: { wMm: 120, hMm: 120, name: "x" }, fabric: "woven", threadWeight: 40,
    colors: [RED], objects: [obj],
  };
}

function medianRealSegment(project: Project): number {
  const d = designFor(project);
  const L: number[] = [];
  for (let i = 1; i < d.length; i++) {
    const a = d[i - 1], b = d[i];
    if (a.jump || b.jump || a.trim || b.trim || a.stop || b.stop) continue;
    L.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  L.sort((x, y) => x - y);
  return L[Math.floor(L.length / 2)];
}

describe("size-adaptive fill stitch length (professional multi-size curve)", () => {
  it("matches the measured professional lengths across sizes", () => {
    // Reference series: ~2.1mm @25, ~2.9 @50, saturating ~4 @80+.
    expect(medianRealSegment(square(25))).toBeGreaterThan(1.9);
    expect(medianRealSegment(square(25))).toBeLessThan(2.4);
    expect(medianRealSegment(square(50))).toBeGreaterThan(2.7);
    expect(medianRealSegment(square(50))).toBeLessThan(3.2);
    expect(medianRealSegment(square(100))).toBeGreaterThan(3.7);
  });

  it("an explicit user fill stitch length always wins", () => {
    const med = medianRealSegment(square(25, { fillStitchLength: 4 }));
    expect(med).toBeGreaterThan(3.7); // no adaptation when the user set it
  });

  it("the fitted curve itself: clamped linear-to-cap", () => {
    const ring = (s: number) => [[{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }]];
    expect(adaptiveFillStitchLength(ring(25), 4)).toBeCloseTo(2.13, 1);
    expect(adaptiveFillStitchLength(ring(50), 4)).toBeCloseTo(2.97, 1);
    expect(adaptiveFillStitchLength(ring(200), 4)).toBe(4); // capped at base
    expect(adaptiveFillStitchLength(ring(5), 4)).toBe(2); // floor: jam-safe minimum
  });
});
