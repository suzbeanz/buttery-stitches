import { describe, it, expect } from "vitest";
import type { Path } from "../../types/project";
import {
  satinUnderlay,
  columnUnderlay,
  fillUnderlayRuns,
  fillEdgeUnderlay,
  fillParallelUnderlay,
} from "./underlay";

describe("satinUnderlay", () => {
  it("spans the whole column even when the rails have different vertex counts", () => {
    // Left rail described with many points, right rail with only its endpoints —
    // a realistic edited/imported satin. The centerline underlay run must still
    // run the full length of the column, not stop short where the shorter rail ends.
    const left: Path = Array.from({ length: 21 }, (_, i) => ({ x: 0, y: i }));
    const right: Path = [
      { x: 4, y: 0 },
      { x: 4, y: 20 },
    ];
    const runs = satinUnderlay(left, right);
    // Returns separate runs (centerline + tiers); the first is the centerline run.
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const center = runs[0];
    const ys = center.map((p) => p.y);
    // Centerline runs from y≈0 to y≈20 (full height), centered near x=2.
    expect(Math.min(...ys)).toBeLessThanOrEqual(1);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(19);
  });

  it("returns nothing for degenerate rails", () => {
    expect(satinUnderlay([{ x: 0, y: 0 }], [{ x: 1, y: 0 }])).toEqual([]);
  });
});

describe("columnUnderlay tiers by width", () => {
  const centerline: Path = Array.from({ length: 11 }, (_, i) => ({ x: 0, y: i * 2 }));

  it("thin columns (light) get only the centerline run", () => {
    expect(columnUnderlay(centerline, 1.5, "light")).toHaveLength(1);
  });

  it("a ~3 mm column adds an edge-walk (centerline + two rail runs)", () => {
    // standard weight, width ≥ 2 mm but < 4 mm: center + edge-walk, no zig-zag.
    expect(columnUnderlay(centerline, 3, "standard")).toHaveLength(3);
  });

  it("a 2 mm column earns the edge-walk too (thin/mid satin gets a crisp edge foundation)", () => {
    // A center run alone left the thin/mid ladder rungs reading rough on a sew-out.
    // From ~2 mm up the inset rails clear, so the edge walk lays a border foundation.
    expect(columnUnderlay(centerline, 2, "standard")).toHaveLength(3);
  });

  it("a wide column adds a zig-zag pass on top of the edge-walk", () => {
    // width ≥ 4 mm: center + edge-walk (×2) + zig-zag = 4 runs.
    expect(columnUnderlay(centerline, 4, "standard")).toHaveLength(4);
  });

  it("heavy weight forces extra tiers a standard column wouldn't get", () => {
    // At 1.8 mm a standard column is centerline-only; heavy adds edge-walk + zig-zag.
    expect(columnUnderlay(centerline, 1.8, "standard")).toHaveLength(1);
    expect(columnUnderlay(centerline, 1.8, "heavy")).toHaveLength(4);
  });

  it("lays the zig-zag BEFORE the edge walk (so the edge isn't pulled in)", () => {
    // Wide column → [centerline, zig-zag, edge-R, edge-L]. The zig-zag crosses
    // the whole column (spans both rails); the edge walks each hug one rail.
    const runs = columnUnderlay(centerline, 5, "standard");
    expect(runs).toHaveLength(4);
    const xspan = (p: Path) =>
      Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x));
    expect(xspan(runs[1])).toBeGreaterThan(xspan(runs[2]) + 1); // zig-zag is run #1
    expect(xspan(runs[1])).toBeGreaterThan(xspan(runs[3]) + 1);
  });
});

describe("fill underlay stays inside the region", () => {
  // A 20×20 mm square (closed ring).
  const square: Path = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
    { x: 0, y: 0 },
  ];

  it("the inset edge run sits strictly inside the outer ring", () => {
    // Inset ~1 mm, so every penetration must be comfortably inside the 0–20 box.
    const edge = fillEdgeUnderlay([square]);
    expect(edge.length).toBeGreaterThan(2);
    const xs = edge.map((p) => p.x);
    const ys = edge.map((p) => p.y);
    expect(Math.min(...xs, ...ys)).toBeGreaterThan(0.2);
    expect(Math.max(...xs, ...ys)).toBeLessThan(19.8);
  });

  it("the parallel pass stays inset inside the region (no row-end pokes past the edge)", () => {
    // The parallel underlay must sit under the top fill, never reaching the
    // boundary — an underlay row-end at the edge is what pokes a stray whisker
    // past a convex tip. Inset means its extent is strictly inside the 0–20 box.
    const par = fillParallelUnderlay([square], 0);
    expect(par.length).toBeGreaterThan(2);
    const xs = par.map((p) => p.x);
    const ys = par.map((p) => p.y);
    expect(Math.min(...xs, ...ys)).toBeGreaterThan(0.2);
    expect(Math.max(...xs, ...ys)).toBeLessThan(19.8);
  });

  it("standard fill underlay is edge + one parallel pass; heavy adds another", () => {
    const std = fillUnderlayRuns([square], 0, "standard");
    const heavy = fillUnderlayRuns([square], 0, "heavy");
    expect(std.length).toBe(2);
    expect(heavy.length).toBe(3);
  });
});
