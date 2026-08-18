import { describe, it, expect } from "vitest";
import { routeInkPieces, partitionInkComponents, type InkPiece } from "./inkroute";
import type { Path, Point } from "../../types/project";

/** A straight-bar piece: top = centerline (a bean-like run for the test). */
function bar(a: Point, b: Point): InkPiece {
  const line: Path = [a, b];
  return { top: line, centerline: line };
}

/** Largest gap between consecutive runs in an emission sequence. */
function maxInterRunGap(runs: Path[], start: Point | null): number {
  let worst = 0;
  let prev = start;
  for (const r of runs) {
    if (prev) worst = Math.max(worst, Math.hypot(r[0].x - prev.x, r[0].y - prev.y));
    prev = r[r.length - 1];
  }
  return worst;
}

describe("routeInkPieces", () => {
  // A plus-sign network: four arms meeting at the origin. Euclidean nearest
  // ordering can leave opposite arm-ends 40mm apart; the skeleton walk must
  // chain every hop through the junction so no inter-run gap is ever bare.
  const arms = [
    bar({ x: 0, y: 0 }, { x: 20, y: 0 }),
    bar({ x: 0, y: 0 }, { x: -20, y: 0 }),
    bar({ x: 0, y: 0 }, { x: 0, y: 20 }),
    bar({ x: 0, y: 0 }, { x: 0, y: -20 }),
  ];

  it("chains a connected network with connectors — no bare inter-run gaps", () => {
    const runs = routeInkPieces(arms, { x: 25, y: 0 }, 3.5);
    // All four arms sewn.
    expect(runs.length).toBeGreaterThanOrEqual(4);
    // Every consecutive hop is stitched or negligible: the assembler's plain
    // continuation threshold is 3mm, and connectors land runs end-to-start.
    expect(maxInterRunGap(runs, null)).toBeLessThanOrEqual(3);
  });

  it("emits connectors that ride the skeleton, not chords across open ground", () => {
    const runs = routeInkPieces(arms, { x: 25, y: 0 }, 3.5);
    // A connector from arm-end (20,0) to arm-end (0,20) must pass near the
    // junction — the straight chord's midpoint (10,10) is 14mm off-network.
    // Every stitch of every run stays within 1.5mm of some centerline.
    const onNetwork = (p: Point) =>
      Math.min(Math.abs(p.x), Math.abs(p.y)) <= 1.5 &&
      Math.max(Math.abs(p.x), Math.abs(p.y)) <= 21.5;
    for (const r of runs) for (const p of r) expect(onNetwork(p), `(${p.x},${p.y})`).toBe(true);
  });

  it("an island is entered without inventing a connector (the assembler trims)", () => {
    const island = bar({ x: 60, y: 60 }, { x: 70, y: 60 });
    const runs = routeInkPieces([...arms, island], { x: 25, y: 0 }, 3.5);
    // Exactly one big hop — the island transition; everything else chains.
    let big = 0;
    let prev: Point | null = null;
    for (const r of runs) {
      if (prev && Math.hypot(r[0].x - prev.x, r[0].y - prev.y) > 3) big++;
      prev = r[r.length - 1];
    }
    expect(big).toBe(1);
    // No run stitches across the void between network and island (the fixture's
    // own bars are up to 20mm; the void is ~57mm).
    for (const r of runs) {
      for (let i = 1; i < r.length; i++) {
        expect(Math.hypot(r[i].x - r[i - 1].x, r[i].y - r[i - 1].y)).toBeLessThanOrEqual(25);
      }
    }
  });

  it("a cursor already on the network is entered through it (pass transitions chain)", () => {
    // Needle sits at an arm end (previous pass ended there); the walk must
    // reach the far arm with a connector, not leave a gap for the assembler.
    const runs = routeInkPieces(arms, { x: 20, y: 0 }, 3.5);
    expect(maxInterRunGap(runs, { x: 20, y: 0 })).toBeLessThanOrEqual(3);
  });
});

describe("partitionInkComponents", () => {
  it("labels connected tracks together and islands apart, and assigns nearby points", () => {
    const tracks: Path[] = [
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      [{ x: 20.5, y: 0.5 }, { x: 20, y: 20 }], // glued to the first (≤1.4mm)
      [{ x: 60, y: 60 }, { x: 80, y: 60 }], // island
    ];
    const { labels, assign } = partitionInkComponents(tracks);
    expect(labels[0]).toBe(labels[1]);
    expect(labels[2]).not.toBe(labels[0]);
    expect(assign({ x: 10, y: 1 })).toBe(labels[0]);
    expect(assign({ x: 70, y: 61 })).toBe(labels[2]);
    expect(assign({ x: 40, y: 40 })).toBe(-1); // nothing within reach
  });
});
