import { describe, it, expect } from "vitest";
import { regularizeRepeats, unifyCircles } from "./idealize";
import { polygonArea } from "./classify";
import { makeObjectFromPaths } from "../objects";
import type { Path } from "../../types/project";

const circle = (cx: number, cy: number, r: number, n = 64): Path =>
  Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; });
const radiusOf = (ring: Path) => { const c = centroid(ring); return Math.hypot(ring[0].x - c.x, ring[0].y - c.y); };

const rect = (cx: number, cy: number, hw: number, hh: number): Path => [
  { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh }, { x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh },
];
const centroid = (r: Path) => ({ x: r.reduce((s, p) => s + p.x, 0) / r.length, y: r.reduce((s, p) => s + p.y, 0) / r.length });

describe("regularizeRepeats", () => {
  it("snaps a slightly-uneven row of boxes to uniform size + even pitch", () => {
    // 7 boxes along x, each size & spacing jittered a little (as a trace would leave them).
    const jig = (i: number) => Math.sin(i * 1.7) * 0.4;
    const rings: Path[] = Array.from({ length: 7 }, (_, i) =>
      rect(10 + i * 8 + jig(i), 20 + jig(i) * 0.3, 2 + jig(i) * 0.15, 3 + jig(i + 1) * 0.15));
    const { rings: out, count } = regularizeRepeats(rings);
    expect(count).toBe(7);
    // equal areas (uniform shape)
    const areas = out.map((r) => Math.abs(polygonArea(r)));
    expect(Math.max(...areas) - Math.min(...areas)).toBeLessThan(1e-6);
    // even pitch
    const xs = out.map((r) => centroid(r).x).sort((a, b) => a - b);
    const pitches = xs.slice(1).map((x, i) => x - xs[i]);
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThan(1e-6);
  });

  it("leaves a scattered set of unrelated shapes UNCHANGED (no false positive)", () => {
    const rings: Path[] = [
      rect(10, 10, 8, 8), rect(50, 12, 2, 9), rect(30, 40, 5, 1),
      rect(70, 60, 12, 3), rect(20, 70, 1, 1),
    ];
    const before = JSON.stringify(rings);
    const { rings: out, count } = regularizeRepeats(rings);
    expect(count).toBe(0);
    expect(JSON.stringify(out)).toBe(before);
  });

  it("does not fire on fewer than 5 members", () => {
    const rings: Path[] = Array.from({ length: 4 }, (_, i) => rect(10 + i * 8, 20, 2, 3));
    expect(regularizeRepeats(rings).count).toBe(0);
  });
});

describe("unifyCircles", () => {
  it("snaps two near-equal circles (two wheels) to one identical radius", () => {
    const objs = [
      makeObjectFromPaths("fill", [circle(0, 0, 5.0)], "c1"),
      makeObjectFromPaths("fill", [circle(40, 0, 5.4)], "c1"),
    ];
    const out = unifyCircles(objs);
    expect(Math.abs(radiusOf(out[0].paths[0]) - radiusOf(out[1].paths[0]))).toBeLessThan(1e-6);
  });

  it("never unifies CONCENTRIC circles (a badge's ring wall)", () => {
    // A badge border traces as an annulus: outer circle + hole a few % smaller,
    // both centred on the design. Unifying them to the median radius collapses
    // the ring wall to zero width — the whole border band vanishes from the
    // sewn design. The white inner disc shares the hole's circle too.
    const objs = [
      makeObjectFromPaths("fill", [circle(50, 50, 47.5), circle(50, 50, 42.8)], "green"),
      makeObjectFromPaths("fill", [circle(50, 50, 42.8)], "white"),
    ];
    const out = unifyCircles(objs);
    expect(radiusOf(out[0].paths[0])).toBeCloseTo(47.5, 3);
    expect(radiusOf(out[0].paths[1])).toBeCloseTo(42.8, 3);
    // the annulus keeps its wall
    const wall = radiusOf(out[0].paths[0]) - radiusOf(out[0].paths[1]);
    expect(wall).toBeGreaterThan(4);
  });

  it("still unifies disjoint near-equal circles when a concentric pair shares the cluster radius-wise", () => {
    // Two far-apart wheels plus one unrelated bigger ring elsewhere: wheels unify.
    const objs = [
      makeObjectFromPaths("fill", [circle(0, 0, 5.0)], "c1"),
      makeObjectFromPaths("fill", [circle(40, 0, 5.4)], "c1"),
    ];
    const out = unifyCircles(objs);
    expect(Math.abs(radiusOf(out[0].paths[0]) - radiusOf(out[1].paths[0]))).toBeLessThan(1e-6);
  });

  it("leaves circles of clearly different size alone", () => {
    const objs = [
      makeObjectFromPaths("fill", [circle(0, 0, 5)], "c1"),
      makeObjectFromPaths("fill", [circle(40, 0, 12)], "c1"),
    ];
    const out = unifyCircles(objs);
    expect(radiusOf(out[0].paths[0])).toBeCloseTo(5, 1);
    expect(radiusOf(out[1].paths[0])).toBeCloseTo(12, 1);
  });
});
