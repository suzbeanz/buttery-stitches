import { describe, it, expect } from "vitest";
import {
  makeObject,
  makeNodeObject,
  makeSatinFromRails,
  cloneObject,
  satinWidthOf,
  setSatinWidth,
  convertObjectType,
  DEFAULT_SATIN_WIDTH,
} from "./objects";
import type { EmbObject, Path } from "../types/project";

const line: Path = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 20, y: 0 },
];

describe("makeNodeObject", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 8 },
  ];
  it("keeps control nodes and densifies paths from them", () => {
    const o = makeNodeObject("fill", pts, "c1", false);
    expect(o.nodes).toBeTruthy();
    expect(o.nodes![0]).toHaveLength(3);
    expect(o.nodes![0].every((n) => n.smooth === false)).toBe(true);
    // all corners → paths equal the polyline (closed ring, no densify points)
    expect(o.paths[0]).toHaveLength(3);
  });
  it("smooth seeds curve flags and densifies a curvier path", () => {
    const o = makeNodeObject("fill", pts, "c1", true);
    expect(o.nodes![0].every((n) => n.smooth === true)).toBe(true);
    expect(o.paths[0].length).toBeGreaterThan(3); // sampled curve
  });
  it("clone translates the nodes with the paths", () => {
    const o = makeNodeObject("running", pts, "c1", false);
    const c = cloneObject(o, 5, 0);
    expect(c.nodes![0][0]).toMatchObject({ x: 5, y: 0 });
    expect(o.nodes![0][0]).toMatchObject({ x: 0, y: 0 }); // original untouched
  });
});

describe("makeSatinFromRails", () => {
  const railA: Path = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  it("keeps rails as-is and stores both as the column", () => {
    const railB: Path = [{ x: 0, y: 4 }, { x: 10, y: 4 }];
    const o = makeSatinFromRails(railA, railB, "c1");
    expect(o.type).toBe("satin");
    expect(o.paths).toHaveLength(2);
    expect(o.paths[0]).toEqual(railA);
    expect(o.paths[1][0]).toEqual({ x: 0, y: 4 }); // not flipped (same direction)
  });
  it("flips rail B when it runs opposite, so the column doesn't twist", () => {
    const railBReversed: Path = [{ x: 10, y: 4 }, { x: 0, y: 4 }]; // drawn the other way
    const o = makeSatinFromRails(railA, railBReversed, "c1");
    // After orientation, rail B's start should pair with rail A's start (x≈0).
    expect(o.paths[1][0].x).toBeCloseTo(0);
    expect(o.paths[1][o.paths[1].length - 1].x).toBeCloseTo(10);
  });
});

describe("cloneObject", () => {
  it("gives the clone a fresh id and offsets its geometry", () => {
    const original = makeObject("fill", line, "c1");
    const clone = cloneObject(original, 3, 5);
    expect(clone.id).not.toBe(original.id);
    expect(clone.type).toBe("fill");
    expect(clone.colorId).toBe("c1");
    expect(clone.paths[0][0]).toEqual({ x: 3, y: 5 });
    // Original is untouched (deep copy).
    expect(original.paths[0][0]).toEqual({ x: 0, y: 0 });
  });

  it("deep-copies paths and params so edits don't leak back", () => {
    const original = makeObject("running", line, "c1");
    const clone = cloneObject(original);
    clone.paths[0][0].x = 999;
    expect(original.paths[0][0].x).toBe(0);
  });
});

describe("makeObject", () => {
  it("keeps running/fill geometry as a single path", () => {
    expect(makeObject("running", line, "c").paths).toEqual([line]);
    expect(makeObject("fill", line, "c").paths).toEqual([line]);
  });

  it("builds a rail pair for satin", () => {
    const o = makeObject("satin", line, "c");
    expect(o.paths).toHaveLength(2);
    expect(satinWidthOf(o.paths)).toBeCloseTo(DEFAULT_SATIN_WIDTH);
  });
});

describe("satin width", () => {
  it("measures and resets column width about the centerline", () => {
    const o = makeObject("satin", line, "c");
    const widened = setSatinWidth(o.paths, 8);
    expect(satinWidthOf(widened)).toBeCloseTo(8);
    // centerline (y=0) is preserved
    const midY = (widened[0][0].y + widened[1][0].y) / 2;
    expect(midY).toBeCloseTo(0);
  });

  it("falls back to the default for non-rail geometry", () => {
    expect(satinWidthOf([line])).toBe(DEFAULT_SATIN_WIDTH);
  });
});

describe("convertObjectType", () => {
  const running: EmbObject = {
    id: "o",
    name: "r",
    type: "running",
    colorId: "c",
    paths: [line],
    params: {},
    visible: true,
  };

  it("returns an empty patch when type is unchanged", () => {
    expect(convertObjectType(running, "running")).toEqual({});
  });

  it("running -> fill keeps the same points", () => {
    const patch = convertObjectType(running, "fill");
    expect(patch.type).toBe("fill");
    expect(patch.paths).toBeUndefined(); // geometry untouched
  });

  it("running -> satin produces a rail pair around the line", () => {
    const patch = convertObjectType(running, "satin");
    expect(patch.type).toBe("satin");
    expect(patch.paths).toHaveLength(2);
    expect(satinWidthOf(patch.paths!)).toBeCloseTo(DEFAULT_SATIN_WIDTH);
  });

  it("satin -> running collapses rails back to a centerline", () => {
    const satin = makeObject("satin", line, "c");
    const patch = convertObjectType(satin, "running");
    expect(patch.type).toBe("running");
    expect(patch.paths).toHaveLength(1);
    // centerline matches the original line
    patch.paths![0].forEach((p, i) => {
      expect(p.x).toBeCloseTo(line[i].x);
      expect(p.y).toBeCloseTo(line[i].y);
    });
  });

  it("converting a degenerate (1-point) object to satin doesn't invent empty rails", () => {
    const degenerate: EmbObject = { ...running, paths: [[{ x: 5, y: 5 }]] };
    const patch = convertObjectType(degenerate, "satin");
    expect(patch.type).toBe("satin");
    expect(patch.paths).toBeUndefined(); // keeps original geometry, no [[],[]]
  });
});
