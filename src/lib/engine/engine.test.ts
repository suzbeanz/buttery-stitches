import { describe, it, expect } from "vitest";
import type { Path } from "../../types/project";
import { distance } from "../geometry";
import {
  resampleByDistance,
  resampleByCount,
  capSegmentLength,
} from "./resample";
import { runningStitch } from "./running";
import { satinColumn } from "./satin";
import { tatamiFill } from "./fill";

function maxSeg(path: Path): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m = Math.max(m, distance(path[i - 1], path[i]));
  return m;
}

describe("resample", () => {
  it("places points every spacing mm and lands on the last vertex", () => {
    const out = resampleByDistance(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2.5,
    );
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 0 });
    // 0, 2.5, 5, 7.5, 10
    expect(out).toHaveLength(5);
  });

  it("always finishes exactly on the final vertex even with a remainder", () => {
    const out = resampleByDistance(
      [
        { x: 0, y: 0 },
        { x: 7, y: 0 },
      ],
      2.5,
    );
    expect(out[out.length - 1]).toEqual({ x: 7, y: 0 });
  });

  it("resamples to an exact count spaced equally", () => {
    const out = resampleByCount(
      [
        { x: 0, y: 0 },
        { x: 9, y: 0 },
      ],
      4,
    );
    expect(out).toHaveLength(4);
    expect(out[1].x).toBeCloseTo(3);
    expect(out[2].x).toBeCloseTo(6);
  });

  it("caps segment length by inserting midpoints", () => {
    const out = capSegmentLength(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      3,
    );
    expect(maxSeg(out)).toBeLessThanOrEqual(3 + 1e-9);
  });
});

describe("runningStitch", () => {
  it("spaces penetrations by the stitch length", () => {
    const out = runningStitch(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      2.5,
    );
    expect(maxSeg(out)).toBeLessThanOrEqual(2.5 + 1e-6);
    // ends on the final corner
    expect(out[out.length - 1]).toEqual({ x: 5, y: 5 });
  });
});

describe("satinColumn", () => {
  const left: Path = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ];
  const right: Path = [
    { x: 0, y: 4 },
    { x: 20, y: 4 },
  ];

  it("zig-zags between the two rails", () => {
    const out = satinColumn(left, right, { density: 0.4, pullComp: 0 });
    expect(out.length).toBeGreaterThan(10);
    // alternates between the two rail y-values (0 and 4)
    expect(out[0].y).toBeCloseTo(0);
    expect(out[1].y).toBeCloseTo(4);
  });

  it("widens the column with pull compensation", () => {
    const out = satinColumn(left, right, { density: 0.4, pullComp: 1 });
    const ys = out.map((p) => p.y);
    // with +1 mm pull comp the rails sit near -0.5 and 4.5
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 1);
    expect(Math.max(...ys)).toBeCloseTo(4.5, 1);
  });

  it("splits throws wider than the max width", () => {
    const wideRight: Path = [
      { x: 0, y: 12 },
      { x: 20, y: 12 },
    ];
    const out = satinColumn(left, wideRight, { density: 1, pullComp: 0, maxWidth: 7 });
    expect(maxSeg(out)).toBeLessThanOrEqual(7 + 1e-6);
  });
});

describe("tatamiFill", () => {
  // A 20×20 mm square.
  const square: Path = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ];

  it("fills the region with rows at the given density", () => {
    const out = tatamiFill([square], { density: 2, angle: 0 });
    expect(out.length).toBeGreaterThan(0);
    // every penetration lands inside the square
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(20 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(20 + 1e-6);
    }
  });

  it("denser rows produce more stitches (re-densification)", () => {
    const sparse = tatamiFill([square], { density: 4, angle: 0 });
    const dense = tatamiFill([square], { density: 1, angle: 0 });
    expect(dense.length).toBeGreaterThan(sparse.length);
  });

  it("leaves a hole unstitched (even-odd rule)", () => {
    const hole: Path = [
      { x: 8, y: 8 },
      { x: 12, y: 8 },
      { x: 12, y: 12 },
      { x: 8, y: 12 },
    ];
    const out = tatamiFill([square, hole], { density: 1, angle: 0 });
    // No penetration should land strictly inside the hole.
    const inHole = out.filter((p) => p.x > 8.01 && p.x < 11.99 && p.y > 8.01 && p.y < 11.99);
    expect(inHole).toHaveLength(0);
  });
});
