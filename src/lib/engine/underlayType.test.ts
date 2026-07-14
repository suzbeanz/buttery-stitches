import { describe, it, expect } from "vitest";
import type { EmbObject, Path, UnderlayType } from "../../types/project";
import { generateObjectRuns } from "./index";
import { makeShapeObject } from "../shapes";
import { columnUnderlay, fillUnderlayRuns, fillEdgeUnderlay } from "./underlay";
import { polylineLength } from "../geometry";

/** Explicit per-object underlay TYPE override (pro-software style). */

// A straight 5 mm-wide satin column, 20 mm tall — wide enough that AUTO lays
// the full tier stack (centerline + zig-zag + edge-walk pair).
const centerline: Path = Array.from({ length: 11 }, (_, i) => ({ x: 0, y: i * 2 }));
const WIDTH = 5;

const totalLength = (runs: Path[]) => runs.reduce((s, r) => s + polylineLength(r), 0);

/** Every point of every run inside the column's bounds (x ∈ ±width/2, y ∈ [0,20]). */
function expectInsideColumn(runs: Path[], widthMm: number) {
  for (const run of runs) {
    for (const q of run) {
      expect(Math.abs(q.x)).toBeLessThanOrEqual(widthMm / 2 + 1e-6);
      expect(q.y).toBeGreaterThanOrEqual(-1e-6);
      expect(q.y).toBeLessThanOrEqual(20 + 1e-6);
    }
  }
}

describe("satin column underlayType overrides", () => {
  const auto = columnUnderlay(centerline, WIDTH, "standard", "auto");

  it('"auto" is byte-identical to omitting the argument', () => {
    expect(auto).toEqual(columnUnderlay(centerline, WIDTH, "standard"));
  });

  it("each explicit type lays a different, non-empty pass than auto", () => {
    const types: UnderlayType[] = ["center", "edge", "zigzag", "double-zigzag"];
    for (const type of types) {
      const runs = columnUnderlay(centerline, WIDTH, "standard", type);
      expect(runs.length).toBeGreaterThan(0);
      for (const r of runs) expect(r.length).toBeGreaterThanOrEqual(2);
      expect(runs).not.toEqual(auto);
    }
  });

  it("center = one centerline run; edge = the rail pair; zigzag = one crossing pass", () => {
    const center = columnUnderlay(centerline, WIDTH, "standard", "center");
    expect(center).toHaveLength(1);
    // The centerline run hugs x = 0.
    for (const q of center[0]) expect(Math.abs(q.x)).toBeLessThan(0.1);

    const edge = columnUnderlay(centerline, WIDTH, "standard", "edge");
    expect(edge).toHaveLength(2);
    // Each edge walk hugs ONE inset rail (never crosses the center).
    for (const rail of edge) {
      const xs = rail.map((q) => q.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.5);
      expect(Math.min(...xs.map((x) => Math.abs(x)))).toBeGreaterThan(1);
    }

    const zig = columnUnderlay(centerline, WIDTH, "standard", "zigzag");
    expect(zig).toHaveLength(1);
    // The zig-zag spans rail to rail.
    const xs = zig[0].map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
  });

  it("double-zigzag lays the zig-zag twice, phase-shifted, at ~2x the length", () => {
    const zig = columnUnderlay(centerline, WIDTH, "standard", "zigzag");
    const dbl = columnUnderlay(centerline, WIDTH, "standard", "double-zigzag");
    expect(dbl).toHaveLength(2);
    // First pass is the plain zig-zag; the second is shifted (starts on the
    // opposite rail), so the passes differ.
    expect(dbl[0]).toEqual(zig[0]);
    expect(dbl[1]).not.toEqual(dbl[0]);
    expect(dbl[1][0].x).toBeCloseTo(-dbl[0][0].x, 5);
    const ratio = totalLength(dbl) / totalLength(zig);
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  it("every override stays inside the column (inset from the rails)", () => {
    const types: UnderlayType[] = ["center", "edge", "zigzag", "double-zigzag", "tatami"];
    for (const type of types) {
      expectInsideColumn(columnUnderlay(centerline, WIDTH, "standard", type), WIDTH);
    }
  });

  it("inapplicable / impossible picks degrade gracefully, never empty", () => {
    // Tatami has no meaning on a rail column → nearest coverage pass (zig-zag).
    expect(columnUnderlay(centerline, WIDTH, "standard", "tatami")).toEqual(
      columnUnderlay(centerline, WIDTH, "standard", "zigzag"),
    );
    // A 1 mm column's inset rails would cross → every pick degrades to center run.
    for (const type of ["edge", "zigzag", "double-zigzag", "tatami"] as UnderlayType[]) {
      const runs = columnUnderlay(centerline, 1.0, "standard", type);
      expect(runs).toHaveLength(1);
      for (const q of runs[0]) expect(Math.abs(q.x)).toBeLessThan(0.1);
    }
  });
});

describe("fill underlayType overrides", () => {
  // A 20×20 mm square (closed ring), same fixture as the tiering tests.
  const square: Path = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
    { x: 0, y: 0 },
  ];
  const auto = fillUnderlayRuns([square], 0, "standard", "auto");

  it('"auto" is byte-identical to omitting the argument', () => {
    expect(auto).toEqual(fillUnderlayRuns([square], 0, "standard"));
  });

  it("each explicit type lays a different, non-empty pass than auto", () => {
    const types: UnderlayType[] = ["edge", "tatami", "zigzag", "double-zigzag", "center"];
    for (const type of types) {
      const runs = fillUnderlayRuns([square], 0, "standard", type);
      expect(runs.length).toBeGreaterThan(0);
      for (const r of runs) expect(r.length).toBeGreaterThanOrEqual(2);
      expect(runs).not.toEqual(auto); // auto = edge + parallel; each pick is just its pass
    }
  });

  it("edge = the inset edge run only; tatami = the parallel pass only", () => {
    const edge = fillUnderlayRuns([square], 0, "standard", "edge");
    expect(edge).toEqual([fillEdgeUnderlay([square])]);

    const tatami = fillUnderlayRuns([square], 0, "standard", "tatami");
    expect(tatami.length).toBeGreaterThan(0);
    // No edge loop in a tatami-only underlay.
    expect(tatami).not.toContainEqual(fillEdgeUnderlay([square]));
  });

  it("zigzag lays the crossing-angle pass (differs from tatami's straight pass)", () => {
    const tatami = fillUnderlayRuns([square], 0, "standard", "tatami");
    const zig = fillUnderlayRuns([square], 0, "standard", "zigzag");
    expect(zig.length).toBeGreaterThan(0);
    expect(zig).not.toEqual(tatami);
    // Double-zigzag stacks the two crossing angles → more thread than one pass.
    const dbl = fillUnderlayRuns([square], 0, "standard", "double-zigzag");
    expect(totalLength(dbl)).toBeGreaterThan(totalLength(zig) * 1.5);
  });

  it("center maps to edge for fills (no cheap medial centerline at this layer)", () => {
    expect(fillUnderlayRuns([square], 0, "standard", "center")).toEqual(
      fillUnderlayRuns([square], 0, "standard", "edge"),
    );
  });

  it("every override stays strictly inside the region (inset, like auto)", () => {
    const types: UnderlayType[] = ["edge", "tatami", "zigzag", "double-zigzag", "center"];
    for (const type of types) {
      for (const run of fillUnderlayRuns([square], 0, "standard", type)) {
        const xs = run.map((p) => p.x);
        const ys = run.map((p) => p.y);
        expect(Math.min(...xs, ...ys)).toBeGreaterThan(0.2);
        expect(Math.max(...xs, ...ys)).toBeLessThan(19.8);
      }
    }
  });
});

describe("underlayType through the engine (generateObjectRuns)", () => {
  const satinObject = (type?: UnderlayType): EmbObject => ({
    id: "s1",
    name: "column",
    type: "satin",
    colorId: "c1",
    paths: [
      Array.from({ length: 11 }, (_, i) => ({ x: 0, y: i * 2 })),
      Array.from({ length: 11 }, (_, i) => ({ x: 5, y: i * 2 })),
    ],
    params: type === undefined ? { underlay: true } : { underlay: true, underlayType: type },
    visible: true,
  });

  const fillObject = (type?: UnderlayType): EmbObject => {
    const o = makeShapeObject("rectangle", { width: 20, height: 20 }, "c1");
    o.params =
      type === undefined
        ? { underlay: true, fillStyle: "tatami" }
        : { underlay: true, fillStyle: "tatami", underlayType: type };
    return o;
  };

  it('absent vs explicit "auto" is deep-equal (default output unchanged)', () => {
    expect(generateObjectRuns(satinObject("auto"))).toEqual(generateObjectRuns(satinObject()));
    expect(generateObjectRuns(fillObject("auto"))).toEqual(generateObjectRuns(fillObject()));
  });

  it("an explicit type changes the underlay runs but never empties them", () => {
    for (const [make, types] of [
      [satinObject, ["center", "edge", "zigzag", "double-zigzag"]],
      [fillObject, ["edge", "tatami", "zigzag"]],
    ] as const) {
      const autoUl = generateObjectRuns(make()).filter((r) => r.underlay);
      for (const type of types) {
        const ul = generateObjectRuns(make(type as UnderlayType)).filter((r) => r.underlay);
        expect(ul.length).toBeGreaterThan(0);
        expect(ul.map((r) => r.pts)).not.toEqual(autoUl.map((r) => r.pts));
      }
    }
  });

  it("the top layer is untouched by the underlay type", () => {
    const tops = (o: EmbObject) =>
      generateObjectRuns(o).filter((r) => !r.underlay).map((r) => r.pts);
    // Satin's top is a single column pass — identical stitch for stitch.
    expect(tops(satinObject("double-zigzag"))).toEqual(tops(satinObject()));
    // A fill's top pieces are re-ORDERED (and possibly reversed) nearest-neighbor
    // from wherever the underlay ended, and the short-stitch filter then keeps a
    // slightly different point subset of the same geometry — so compare shape
    // invariants, not exact points: same piece count, same thread length (±2%).
    const a = tops(fillObject("zigzag"));
    const b = tops(fillObject());
    expect(a.length).toBe(b.length);
    const len = (runs: Path[]) => runs.reduce((s, r) => s + polylineLength(r), 0);
    expect(len(a)).toBeGreaterThan(len(b) * 0.98);
    expect(len(a)).toBeLessThan(len(b) * 1.02);
  });
});
