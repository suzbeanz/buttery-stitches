/**
 * Foundation guarantees the whole app rests on:
 *  - the `.embproj` JSON round-trips LOSSLESSLY (it is the source of truth);
 *  - the stitch engine is deterministic, reference-memoized, and never emits
 *    NaN/Infinity — even on degenerate geometry — so no garbage reaches a file.
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyProject,
  serializeProject,
  parseProject,
} from "../lib/project";
import { makeObject, makeObjectFromPaths } from "../lib/objects";
import { generateDesign, designFor } from "../lib/engine";
import { planFromProject } from "../lib/export";
import type { EmbObject, Project } from "../types/project";

/** A project exercising every recent field: fabric, groups, contour, all types. */
function richProject(): Project {
  const base = createEmptyProject();
  const cId = base.colors[0].id;
  const red = { id: "red", rgb: [200, 30, 30] as [number, number, number], name: "Red" };

  const fill = makeObjectFromPaths(
    "fill",
    [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }]],
    cId,
  );
  fill.params = { fillStyle: "contour", density: 0.4 };
  fill.groupId = "g1";

  const satin = makeObject("satin", [{ x: 5, y: 40 }, { x: 35, y: 40 }], red.id);
  satin.groupId = "g1";

  const run = makeObject("running", [{ x: 0, y: 60 }, { x: 40, y: 60 }], cId);

  return {
    ...base,
    fabric: "knit",
    colors: [...base.colors, red],
    objects: [fill, satin, run],
  };
}

describe("foundation: .embproj is a lossless source of truth", () => {
  it("round-trips every field (fabric, groupId, contour fillStyle, colors)", () => {
    const project = richProject();
    const restored = parseProject(JSON.parse(serializeProject(project)));
    // Deep-equal: nothing dropped, nothing silently defaulted.
    expect(restored).toEqual(project);
    // Specifics that recently broke other tools:
    expect(restored.fabric).toBe("knit");
    expect(restored.objects[0].groupId).toBe("g1");
    expect(restored.objects[0].params.fillStyle).toBe("contour");
    expect(restored.objects[1].groupId).toBe("g1");
  });

  it("produces a byte-identical export plan after a round trip", () => {
    const project = richProject();
    const restored = parseProject(JSON.parse(serializeProject(project)));
    expect(planFromProject(restored)).toEqual(planFromProject(project));
  });

  it("rejects a wrong-version or malformed file (fails loud, not silent)", () => {
    expect(() => parseProject({ version: 2, colors: [], objects: [], widthMm: 1, heightMm: 1 })).toThrow();
    expect(() => parseProject(null)).toThrow();
    expect(() => parseProject({ version: 1, colors: [], objects: [] })).toThrow();
    // Unrecoverable per-object problems fail loud (caught by the loader → toast).
    expect(() =>
      parseProject({ version: 1, widthMm: 100, heightMm: 100, colors: [{ id: "c", rgb: [0, 0, 0] }], objects: [{ type: "blob", colorId: "c", paths: [] }] }),
    ).toThrow();
    expect(() =>
      parseProject({ version: 1, widthMm: 100, heightMm: 100, colors: [], objects: [{ type: "fill", paths: [] }] }),
    ).toThrow();
  });

  it("recovers a slightly-malformed object (missing params/paths/visible) instead of crashing the engine", () => {
    const restored = parseProject({
      version: 1,
      widthMm: 100,
      heightMm: 100,
      colors: [{ id: "c", rgb: [10, 20, 30] }],
      // object missing params, paths, visible, id, name entirely
      objects: [{ type: "fill", colorId: "c" }],
    });
    const o = restored.objects[0];
    expect(o.params).toEqual({});
    expect(o.paths).toEqual([]);
    expect(o.visible).toBe(true);
    expect(typeof o.id).toBe("string");
    // And the engine must run on it without throwing.
    expect(() => generateDesign(restored)).not.toThrow();
  });

  it("strips non-finite points on load and clamps rgb / dimensions", () => {
    const restored = parseProject({
      version: 1,
      widthMm: -5,
      heightMm: 100,
      colors: [{ id: "c", rgb: [300, -1, NaN] }],
      objects: [
        {
          type: "fill",
          colorId: "c",
          params: {},
          visible: true,
          paths: [[{ x: 0, y: 0 }, { x: Infinity, y: 1 }, { x: 5, y: 5 }]],
        },
      ],
    });
    expect(restored.widthMm).toBeGreaterThan(0);
    expect(restored.colors[0].rgb).toEqual([255, 0, 0]);
    // The non-finite vertex is dropped.
    expect(restored.objects[0].paths[0]).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  });
});

describe("foundation: engine determinism + memoization", () => {
  it("is deterministic for the same project", () => {
    const p = richProject();
    expect(generateDesign(p)).toEqual(generateDesign(p));
  });

  it("designFor returns the SAME array for the same project reference", () => {
    const p = richProject();
    expect(designFor(p)).toBe(designFor(p)); // identity, not just equality
  });
});

describe("foundation: no NaN/Infinity ever reaches the design or the file", () => {
  const finite = (n: number) => Number.isFinite(n);

  it("every penetration in a normal design has finite coordinates", () => {
    const design = generateDesign(richProject());
    expect(design.length).toBeGreaterThan(0);
    for (const s of design) expect(finite(s.x) && finite(s.y)).toBe(true);
  });

  it("degenerate geometry never throws and never emits NaN", () => {
    const base = createEmptyProject();
    const cId = base.colors[0].id;
    const degenerate: EmbObject[] = [
      makeObjectFromPaths("fill", [], cId), // no rings
      makeObjectFromPaths("fill", [[{ x: 5, y: 5 }]], cId), // 1-point "polygon"
      makeObjectFromPaths("fill", [[{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]], cId), // zero area
      makeObjectFromPaths("satin", [[{ x: 0, y: 0 }]], cId), // 1 rail point
      makeObjectFromPaths("running", [[{ x: 1, y: 1 }]], cId), // 1 point
    ];
    for (const o of degenerate) {
      const p: Project = { ...base, objects: [o] };
      let design: ReturnType<typeof generateDesign> = [];
      expect(() => (design = generateDesign(p))).not.toThrow();
      for (const s of design) expect(finite(s.x) && finite(s.y)).toBe(true);
    }
  });

  it("a reckless 0 density still yields finite, bounded output", () => {
    const base = createEmptyProject();
    const o = makeObjectFromPaths(
      "fill",
      [[{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }]],
      base.colors[0].id,
    );
    o.params = { density: 0 };
    const design = generateDesign({ ...base, objects: [o] });
    for (const s of design) expect(finite(s.x) && finite(s.y)).toBe(true);
  });
});
