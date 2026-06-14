import { describe, it, expect } from "vitest";
import {
  makeObject,
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
  it("measures and resets column width about the centreline", () => {
    const o = makeObject("satin", line, "c");
    const widened = setSatinWidth(o.paths, 8);
    expect(satinWidthOf(widened)).toBeCloseTo(8);
    // centreline (y=0) is preserved
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

  it("satin -> running collapses rails back to a centreline", () => {
    const satin = makeObject("satin", line, "c");
    const patch = convertObjectType(satin, "running");
    expect(patch.type).toBe("running");
    expect(patch.paths).toHaveLength(1);
    // centreline matches the original line
    patch.paths![0].forEach((p, i) => {
      expect(p.x).toBeCloseTo(line[i].x);
      expect(p.y).toBeCloseTo(line[i].y);
    });
  });
});
