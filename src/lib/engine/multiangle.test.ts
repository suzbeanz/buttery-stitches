import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { multiAngleFill, guidanceFieldFill } from "./field";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import { generateDesign, generateObjectRuns } from "./index";
import { fillCoverage } from "../bench/metrics";

/** Smallest angle between two grain orientations (a line, so mod 180°). */
function angDist(a: number, b: number): number {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
}

/** Orientation (deg, [0..180)) of the segment a→b. */
function segAngle(a: Point, b: Point): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return ((deg % 180) + 180) % 180;
}

/** All segments of the runs at least `minLen` mm long (skips the short
 *  serpentine connectors between rows, which run at arbitrary angles). */
function longSegments(runs: Path[], minLen = 3): { a: Point; b: Point; len: number }[] {
  const out: { a: Point; b: Point; len: number }[] = [];
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len >= minLen) out.push({ a, b, len });
    }
  }
  return out;
}

function rect(w: number, h: number): Path {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 1e-12 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const opts = { density: 0.4, angle: 0, stitchLength: 4, pullCompMm: 0 };

describe("multiAngleFill", () => {
  it("two identical-angle guides reduce to a straight single-angle fill", () => {
    // Both guides pin 30°: the phase blend collapses to the plain linear phase,
    // so every row segment must run at ~30°.
    const runs = multiAngleFill([rect(40, 20)], {
      ...opts,
      guides: [
        [10, 10, 30],
        [30, 10, 30],
      ],
    });
    expect(runs).not.toBeNull();
    const segs = longSegments(runs!);
    expect(segs.length).toBeGreaterThan(50);
    for (const s of segs) {
      expect(angDist(segAngle(s.a, s.b), 30)).toBeLessThanOrEqual(5);
    }
  });

  it("two orthogonal guides sweep the rows from one angle to the other", () => {
    // Long 60×20 rectangle; 90° pinned near the left end, 0° near the right.
    // Rows near end A must be near-vertical, near end B near-horizontal, with
    // a smooth sweep between (measured by binning segment angles by x).
    const runs = multiAngleFill([rect(60, 20)], {
      ...opts,
      guides: [
        [3, 10, 90],
        [57, 10, 0],
      ],
    });
    expect(runs).not.toBeNull();
    const segs = longSegments(runs!, 2.5);
    let nearA = 0, nearB = 0;
    for (const s of segs) {
      const mx = (s.a.x + s.b.x) / 2;
      const ang = segAngle(s.a, s.b);
      if (mx < 9) {
        nearA++;
        expect(angDist(ang, 90)).toBeLessThanOrEqual(15);
      } else if (mx > 51) {
        nearB++;
        expect(angDist(ang, 0)).toBeLessThanOrEqual(15);
      }
    }
    // Both ends must actually contain measured rows.
    expect(nearA).toBeGreaterThan(10);
    expect(nearB).toBeGreaterThan(10);
  });

  it("leaves no gap: every interior sample sits within 1.5×density of a row", () => {
    const density = 0.4;
    const runs = multiAngleFill([rect(40, 20)], {
      ...opts,
      density,
      guides: [
        [4, 10, 20],
        [36, 10, 70],
      ],
    });
    expect(runs).not.toBeNull();
    const segs: { a: Point; b: Point }[] = [];
    for (const run of runs!) {
      for (let i = 1; i < run.length; i++) segs.push({ a: run[i - 1], b: run[i] });
    }
    // 1 mm sample lattice, slightly inset so boundary raster rounding isn't measured.
    for (let y = 1; y <= 19; y++) {
      for (let x = 1; x <= 39; x++) {
        let best = Infinity;
        for (const s of segs) {
          const d = distToSeg({ x, y }, s.a, s.b);
          if (d < best) best = d;
          if (best <= density * 1.5) break;
        }
        expect(best, `gap at (${x},${y}): nearest row ${best.toFixed(2)}mm`).toBeLessThanOrEqual(
          density * 1.5,
        );
      }
    }
  });

  it("keeps every stitch inside the region (small raster tolerance)", () => {
    const runs = multiAngleFill([rect(40, 20)], {
      ...opts,
      guides: [
        [4, 10, 20],
        [36, 10, 70],
      ],
    });
    expect(runs).not.toBeNull();
    const tol = 0.8; // solve-raster cell rounding at the boundary (pullComp 0)
    for (const run of runs!) {
      for (const p of run) {
        expect(p.x).toBeGreaterThanOrEqual(-tol);
        expect(p.x).toBeLessThanOrEqual(40 + tol);
        expect(p.y).toBeGreaterThanOrEqual(-tol);
        expect(p.y).toBeLessThanOrEqual(20 + tol);
      }
    }
  });

  it("is deterministic (two runs deep-equal)", () => {
    const g: [number, number, number][] = [
      [3, 10, 90],
      [57, 10, 0],
    ];
    const a = multiAngleFill([rect(60, 20)], { ...opts, guides: g });
    const b = multiAngleFill([rect(60, 20)], { ...opts, guides: g });
    expect(a).toEqual(b);
  });

  it("declines fewer than two guides or degenerate input", () => {
    expect(multiAngleFill([rect(40, 20)], { ...opts, guides: [[10, 10, 30]] })).toBeNull();
    expect(multiAngleFill([rect(40, 20)], { ...opts, guides: [] })).toBeNull();
    expect(
      multiAngleFill([rect(40, 20)], {
        ...opts,
        guides: [
          [10, 10, NaN],
          [30, 10, 30],
        ],
      }),
    ).toBeNull();
  });

  it("does not disturb guidanceFieldFill (regression: crescent still sweeps)", () => {
    const D = Math.PI / 180;
    const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): Path =>
      Array.from({ length: n + 1 }, (_, i) => {
        const a = a0 + ((a1 - a0) * i) / n;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      });
    const crescent: Path = [
      ...arc(50, 55, 40, 200 * D, 340 * D, 60),
      ...arc(50, 55, 26, 340 * D, 200 * D, 60),
    ];
    const runs = guidanceFieldFill([crescent], opts);
    expect(runs).not.toBeNull();
    expect(runs!.length).toBeGreaterThan(20);
  });
});

describe("angleGuides through the engine", () => {
  function projectWith(o: ReturnType<typeof makeObjectFromPaths>) {
    const p = createEmptyProject();
    p.colors = [{ id: "c1", rgb: [0, 0, 0] }];
    p.objects = [o];
    return p;
  }

  it("a two-guide fill compiles with honest coverage ≥ 0.90 on a 40×20 rectangle", () => {
    const o = makeObjectFromPaths("fill", [rect(40, 20)], "c1", "guided");
    // Guides normalized to the object's bbox, exactly as the Direction tool stores
    // them. Density 0.3 (the default) — the honest 0.3mm-thread coverage metric
    // caps ideal coverage at threadWidth/density, so wider spacings can't hit 0.9.
    o.params = {
      density: 0.3,
      angleGuides: [
        [0.1, 0.5, 20],
        [0.9, 0.5, 70],
      ],
    };
    const p = projectWith(o);
    const cov = fillCoverage(p, generateDesign(p));
    expect(cov).not.toBeNull();
    expect(cov!).toBeGreaterThanOrEqual(0.9);
  });

  it("rows genuinely turn between two orthogonal guides (engine end-to-end)", () => {
    const o = makeObjectFromPaths("fill", [rect(60, 20)], "c1", "guided");
    o.params = {
      density: 0.4,
      underlay: false,
      angleGuides: [
        [0.05, 0.5, 90],
        [0.95, 0.5, 0],
      ],
    };
    const runs = generateObjectRuns(o)
      .filter((r) => !r.underlay)
      .map((r) => r.pts);
    const segs = longSegments(runs, 2.5);
    const spread = new Set<number>();
    for (const s of segs) spread.add(Math.floor(segAngle(s.a, s.b) / 20));
    // A fixed-angle tatami clusters in one 20° bin; a real sweep spans several.
    expect(spread.size).toBeGreaterThanOrEqual(3);
  });

  it("exactly one guide degrades to a straight manual direction at its angle", () => {
    const o = makeObjectFromPaths("fill", [rect(40, 40)], "c1", "one-guide");
    o.params = { density: 0.4, underlay: false, angleGuides: [[0.5, 0.5, 30]] };
    const bins = new Array(180).fill(0);
    for (const r of generateObjectRuns(o)) {
      if (r.underlay) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 2) continue;
        bins[Math.round(segAngle(a, b)) % 180] += len;
      }
    }
    const dominant = bins.indexOf(Math.max(...bins));
    expect(angDist(dominant, 30)).toBeLessThanOrEqual(3);
  });
});
