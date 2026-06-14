import { describe, it, expect } from "vitest";
import type { Path } from "../../types/project";
import { distance } from "../geometry";
import {
  resampleByDistance,
  resampleByCount,
  capSegmentLength,
  dropShortStitches,
  splitLongTravels,
} from "./resample";
import { runningStitch } from "./running";
import { satinColumn } from "./satin";
import { tatamiFill, columnSatinFill, splitFillRegions, orientByDepth } from "./fill";
import { fillUnderlay, satinUnderlay } from "./underlay";

const square = (x: number, y: number, s: number): Path => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe("splitLongTravels", () => {
  it("splits a run at a long travel into separate runs", () => {
    const runs = splitLongTravels(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 20, y: 0 }, // 18mm jump
        { x: 21, y: 0 },
      ],
      5,
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(3);
    expect(runs[1]).toHaveLength(2);
  });

  it("keeps a continuous run intact", () => {
    const runs = splitLongTravels([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }], 5);
    expect(runs).toHaveLength(1);
  });
});

describe("columnSatinFill", () => {
  // A narrow vertical stroke — like a letter stem.
  const stroke: Path = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 20 },
    { x: 0, y: 20 },
  ];

  it("emits zig-zag throws across the stroke width", () => {
    const pts = columnSatinFill([stroke], { density: 0.4, angle: 0 });
    expect(pts.length).toBeGreaterThan(10);
    // Every penetration lands within the stroke's x-range (throws span the width).
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(-0.01);
      expect(p.x).toBeLessThanOrEqual(2.01);
    }
  });

  it("is deterministic", () => {
    const a = columnSatinFill([stroke], { density: 0.4, angle: 0 });
    const b = columnSatinFill([stroke], { density: 0.4, angle: 0 });
    expect(a).toEqual(b);
  });
});

describe("orientByDepth", () => {
  it("orients an outer and its hole to opposite winding", () => {
    const out = orientByDepth([square(0, 0, 20), square(5, 5, 5)]);
    expect(out).toHaveLength(2);
    // The two rings end up with opposite winding (one positive, one negative).
    const sign = (r: Path) => {
      let s = 0;
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        s += a.x * b.y - b.x * a.y;
      }
      return Math.sign(s);
    };
    expect(sign(out[0])).not.toBe(sign(out[1]));
  });
});

describe("splitFillRegions", () => {
  it("keeps a single outer (no holes) as one region", () => {
    const regions = splitFillRegions([square(0, 0, 10)]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveLength(1);
  });

  it("attaches a hole to its containing outer", () => {
    const regions = splitFillRegions([square(0, 0, 20), square(5, 5, 5)]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveLength(2); // outer + hole
  });

  it("splits two disjoint outers into separate regions", () => {
    const regions = splitFillRegions([square(0, 0, 10), square(40, 40, 10)]);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toHaveLength(1);
    expect(regions[1]).toHaveLength(1);
  });

  it("groups two outers each with their own hole", () => {
    const regions = splitFillRegions([
      square(0, 0, 20),
      square(5, 5, 5),
      square(40, 40, 20),
      square(45, 45, 5),
    ]);
    expect(regions).toHaveLength(2);
    for (const r of regions) expect(r).toHaveLength(2);
  });
});

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

describe("dropShortStitches", () => {
  it("merges penetrations closer than the minimum length", () => {
    const out = dropShortStitches(
      [
        { x: 0, y: 0 },
        { x: 0.2, y: 0 }, // 0.2 mm — dropped
        { x: 0.3, y: 0 }, // still < 0.5 from origin — dropped
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      0.5,
    );
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("never has a gap below the minimum between kept interior points", () => {
    const out = dropShortStitches(
      [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        { x: 0.2, y: 0 },
        { x: 1.5, y: 0 },
        { x: 1.6, y: 0 },
        { x: 3, y: 0 },
      ],
      0.5,
    );
    for (let i = 1; i < out.length; i++) {
      expect(distance(out[i - 1], out[i])).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
  });

  it("keeps both endpoints even when the whole path is shorter than minLen", () => {
    // Endpoints are sacrosanct, so a tiny path collapses to start + end only.
    const out = dropShortStitches(
      [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        { x: 0.2, y: 0 },
      ],
      0.5,
    );
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
    ]);
  });

  it("always preserves the first and last point", () => {
    const path: Path = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 10, y: 0 },
    ];
    const out = dropShortStitches(path, 0.5);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it("keeps the endpoint even when it crowds the previous point", () => {
    // last two points are 0.1 mm apart; we drop the previous, keep the endpoint
    const out = dropShortStitches(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5.1, y: 0 },
      ],
      0.5,
    );
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 5.1, y: 0 });
    expect(distance(out[out.length - 2], out[out.length - 1])).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it("leaves an already-legal path untouched", () => {
    const path: Path = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ];
    expect(dropShortStitches(path, 0.5)).toEqual(path);
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

describe("fillUnderlay", () => {
  const square: Path = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ];

  it("returns an edge run plus an interior parallel pass", () => {
    // Edge run alone (a closed 20×20 outline at 2.5 mm) is ~32 points; the
    // combined pass must be longer because of the added parallel pass.
    const edgeOnly = runningStitch([...square, square[0]], 2.5);
    const out = fillUnderlay([square], 0);
    expect(out.length).toBeGreaterThan(edgeOnly.length);
  });

  it("orients the parallel pass perpendicular to the top angle", () => {
    // Top angle 0 → underlay rows run vertically (angle 90), so the pass spans
    // a range of x values rather than collapsing onto one column.
    const out = fillUnderlay([square], 0);
    const interior = out.slice(runningStitch([...square, square[0]], 2.5).length);
    const xs = interior.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5);
  });

  it("is empty for a degenerate region", () => {
    expect(fillUnderlay([[{ x: 0, y: 0 }, { x: 1, y: 0 }]], 0)).toEqual([]);
  });
});

describe("satinUnderlay", () => {
  it("runs just the centerline for a narrow column", () => {
    const left: Path = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
    const right: Path = [{ x: 0, y: 2 }, { x: 20, y: 2 }]; // 2 mm wide
    const out = satinUnderlay(left, right);
    // Every point sits on the centerline (y ≈ 1).
    for (const p of out) expect(p.y).toBeCloseTo(1, 5);
  });

  it("adds an edge run on each rail for a wide column", () => {
    const left: Path = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
    const right: Path = [{ x: 0, y: 6 }, { x: 20, y: 6 }]; // 6 mm wide
    const out = satinUnderlay(left, right);
    const ys = out.map((p) => p.y);
    // Edge runs reach the rails at y≈0 and y≈6, not just the centerline.
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...ys)).toBeCloseTo(6, 5);
  });

  it("is empty for a degenerate column", () => {
    expect(satinUnderlay([{ x: 0, y: 0 }], [{ x: 0, y: 2 }])).toEqual([]);
  });
});
