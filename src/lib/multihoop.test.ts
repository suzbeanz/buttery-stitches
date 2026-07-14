import { describe, it, expect } from "vitest";
import {
  planHoopSplit,
  buildTileProject,
  hoopingName,
  ALIGN_COLOR_ID,
  ALIGN_COLOR_NAME,
} from "./multihoop";
import { makeObjectFromPaths } from "./objects";
import { createEmptyProject } from "./project";
import { pathsBounds } from "./geometry";
import type { EmbObject, Point, Project } from "../types/project";

const HOOP = { wMm: 100, hMm: 100 };

/** A closed axis-aligned rectangle object (fill) spanning [x0,x1]×[y0,y1]. */
function rect(x0: number, y0: number, x1: number, y1: number, name?: string): EmbObject {
  return makeObjectFromPaths(
    "fill",
    [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
    "c1",
    name,
  );
}

function projectWith(objects: EmbObject[]): Project {
  const p = createEmptyProject();
  p.hoop = { ...HOOP, name: "test 4×4" };
  p.widthMm = HOOP.wMm;
  p.heightMm = HOOP.hMm;
  objects.forEach((o) => (o.colorId = p.colors[0].id));
  p.objects = objects;
  return p;
}

/** All mark objects (the dedicated alignment color) of a tile project. */
function marksOf(p: Project): EmbObject[] {
  return p.objects.filter((o) => o.colorId === ALIGN_COLOR_ID);
}

/** Round a point set to a comparable, order-independent key list. */
function pointKeys(pts: Point[]): string[] {
  return pts.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).sort();
}

describe("planHoopSplit — grid math", () => {
  it("splits a 150×80 design in a 100×100 hoop into 2 tiles side by side", () => {
    // Two objects so both tiles are populated (assignment is by bbox center).
    const objs = [rect(0, 0, 30, 80), rect(120, 0, 150, 80)];
    const tiles = planHoopSplit(objs, HOOP); // usable 90×90 → 2 cols × 1 row
    expect(tiles).toHaveLength(2);
    expect(tiles.map((t) => [t.col, t.row])).toEqual([[0, 0], [1, 0]]);
    expect(tiles.map((t) => t.index)).toEqual([0, 1]);
    // Cells split the 150×80 bounds evenly: 75 mm wide, centers at 37.5 / 112.5.
    expect(tiles[0].centerMm).toEqual({ x: 37.5, y: 40 });
    expect(tiles[1].centerMm).toEqual({ x: 112.5, y: 40 });
    expect(tiles[0].cellMm.w).toBeCloseTo(75);
    expect(tiles[0].cellMm.h).toBeCloseTo(80);
  });

  it("assigns each object to the tile containing its bbox center", () => {
    const left = rect(0, 0, 30, 80, "left");
    const right = rect(120, 0, 150, 80, "right");
    // Straddles the 75 mm boundary but its center (70) is in the left cell.
    const straddler = rect(60, 10, 80, 30, "straddler");
    const tiles = planHoopSplit([left, right, straddler], HOOP);
    expect(tiles).toHaveLength(2);
    expect(tiles[0].objectIds).toEqual([left.id, straddler.id]);
    expect(tiles[1].objectIds).toEqual([right.id]);
  });

  it("drops empty tiles and renumbers the rest", () => {
    // 250 mm span → 3 columns; nothing lands in the middle one.
    const a = rect(0, 0, 10, 10);
    const b = rect(240, 0, 250, 10);
    const tiles = planHoopSplit([a, b], HOOP);
    expect(tiles).toHaveLength(2);
    expect(tiles.map((t) => t.col)).toEqual([0, 2]);
    expect(tiles.map((t) => t.index)).toEqual([0, 1]);
  });

  it("a fitting design yields a single tile; empty design yields none", () => {
    const tiles = planHoopSplit([rect(10, 10, 60, 60)], HOOP);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ index: 0, col: 0, row: 0 });
    expect(planHoopSplit([], HOOP)).toEqual([]);
  });
});

describe("buildTileProject — translation", () => {
  it("lands an object whose bbox center is the tile center at the hoop center", () => {
    // Left cell of the 150×80 split is [0,75]×[0,80], center (37.5, 40).
    const centered = rect(27.5, 30, 47.5, 50, "centered"); // bbox center (37.5, 40)
    const other = rect(120, 0, 150, 80);
    const anchorL = rect(0, 0, 5, 5); // pins design bounds to x=0
    const project = projectWith([anchorL, centered, other]);
    const tiles = planHoopSplit(project.objects, project.hoop);
    expect(pathsBounds(project.objects.flatMap((o) => o.paths))!.maxX).toBe(150);

    const tp = buildTileProject(project, tiles[0], tiles);
    const moved = tp.objects.find((o) => o.name === "centered")!;
    const mb = pathsBounds(moved.paths)!;
    expect((mb.minX + mb.maxX) / 2).toBeCloseTo(50); // hoop center x
    expect((mb.minY + mb.maxY) / 2).toBeCloseTo(50); // hoop center y
    expect(mb.maxX - mb.minX).toBeCloseTo(20); // pure translation, no scaling
  });

  it("keeps hoop and colors, suffixes the hooping name, and never mutates the input", () => {
    const project = projectWith([rect(0, 0, 30, 80), rect(120, 0, 150, 80)]);
    const before = JSON.stringify(project);
    const tiles = planHoopSplit(project.objects, project.hoop);
    const tp = buildTileProject(project, tiles[1], tiles);

    expect(tp.hoop).toEqual(project.hoop);
    expect(tp.hoop).not.toBe(project.hoop);
    // Original palette preserved (plus the alignment thread).
    for (const c of project.colors) expect(tp.colors).toContainEqual(c);
    expect(hoopingName("design", tiles[1], tiles)).toBe("design — hooping 2 of 2");
    expect(JSON.stringify(project)).toBe(before); // input untouched
  });

  it("preserves object ids and document order after the prepended marks", () => {
    const a = rect(0, 0, 30, 40, "a");
    const b = rect(5, 45, 30, 80, "b");
    const far = rect(120, 0, 150, 80);
    const project = projectWith([a, b, far]);
    const tiles = planHoopSplit(project.objects, project.hoop);
    const tp = buildTileProject(project, tiles[0], tiles);
    const nonMarks = tp.objects.filter((o) => o.colorId !== ALIGN_COLOR_ID);
    expect(nonMarks.map((o) => o.id)).toEqual([a.id, b.id]);
    // Marks come first in the sew order.
    expect(tp.objects.findIndex((o) => o.colorId === ALIGN_COLOR_ID)).toBe(0);
  });
});

describe("buildTileProject — alignment marks", () => {
  it("adjacent tiles carry crosses at identical WORLD positions on shared corners", () => {
    const project = projectWith([rect(0, 0, 30, 80), rect(120, 0, 150, 80)]);
    const tiles = planHoopSplit(project.objects, project.hoop);
    expect(tiles).toHaveLength(2);

    // Un-translate each tile's mark points back to world space and compare.
    const worldMarkPoints = (tileIdx: number): Point[] => {
      const tile = tiles[tileIdx];
      const dx = project.hoop.wMm / 2 - tile.centerMm.x;
      const dy = project.hoop.hMm / 2 - tile.centerMm.y;
      const tp = buildTileProject(project, tile, tiles);
      return marksOf(tp)
        .flatMap((o) => o.paths.flat())
        .map((p) => ({ x: p.x - dx, y: p.y - dy }));
    };

    const w0 = worldMarkPoints(0);
    const w1 = worldMarkPoints(1);
    expect(w0.length).toBeGreaterThan(0);
    expect(pointKeys(w0)).toEqual(pointKeys(w1));

    // The shared corners are (75, 0) and (75, 80) — each cross spans ±4 mm.
    expect(pointKeys(w0)).toContain("71.0000,0.0000");
    expect(pointKeys(w0)).toContain("79.0000,0.0000");
    expect(pointKeys(w0)).toContain("75.0000,84.0000");
  });

  it("marks sew first, are thin running crosses, and add the dedicated color", () => {
    const project = projectWith([rect(0, 0, 30, 80), rect(120, 0, 150, 80)]);
    const tiles = planHoopSplit(project.objects, project.hoop);
    const tp = buildTileProject(project, tiles[0], tiles);

    const marks = marksOf(tp);
    // 2 shared corners × 2 crossing lines each.
    expect(marks).toHaveLength(4);
    expect(tp.objects.slice(0, 4)).toEqual(marks); // prepended
    for (const m of marks) {
      expect(m.type).toBe("running");
      expect(m.paths).toHaveLength(1);
      expect(m.paths[0]).toHaveLength(2); // a single thin line
    }
    const align = tp.colors.find((c) => c.id === ALIGN_COLOR_ID);
    expect(align?.name).toBe(ALIGN_COLOR_NAME);
  });

  it("single-tile passthrough: design fits → 1 tile, no marks, no extra color", () => {
    const project = projectWith([rect(10, 10, 60, 60)]);
    const tiles = planHoopSplit(project.objects, project.hoop);
    expect(tiles).toHaveLength(1);

    const tp = buildTileProject(project, tiles[0], tiles);
    expect(marksOf(tp)).toHaveLength(0);
    expect(tp.colors).toEqual(project.colors);
    expect(tp.objects).toHaveLength(1);
    expect(hoopingName("design", tiles[0], tiles)).toBe("design — hooping 1 of 1");
    // The lone tile still re-centers the design in the hoop.
    const b = pathsBounds(tp.objects[0].paths)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(50);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(50);
  });
});
