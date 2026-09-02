import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { routeInkPieces, type InkPiece } from "./inkroute";

/**
 * Connector transit phase stagger. The underlay, mend and top routing phases
 * all walk the SAME skeleton chains, and a route that backs out of a dead end
 * transits one chain twice — with nav-sample-verbatim connector emission every
 * such pass re-punched IDENTICAL holes to 0.01mm (a corpus cartoon measured
 * 131 exact top-underlay hole duplicates on one object — same-hole drilling
 * that tipped a junction cell to the committed DENSITY_DANGER_PER_MM2
 * ceiling). Connectors now place penetrations with a deviation-budget sagitta
 * walk whose phase is staggered per transit serial (and per routing-phase
 * salt), so transits interleave their holes — the commercial double-pass
 * treatment — while every stitch stays on the ink.
 */

/** A cross network: four arm pieces meeting at (10,10). The greedy route must
 *  back out over already-sewn arms to reach the later ones, so connectors
 *  transit the same chains that other phases also walk. */
function crossPieces(): { pieces: InkPiece[]; tracks: Path[] } {
  const arm = (from: Point, to: Point): Path => {
    const pts: Path = [];
    const n = 20;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // gentle bow so the chains are curvy like a real skeleton
      const mx = (from.x + to.x) / 2 + (to.y - from.y) * 0.04;
      const my = (from.y + to.y) / 2 + (to.x - from.x) * 0.04;
      const a = (1 - t) * (1 - t);
      const b = 2 * t * (1 - t);
      const c = t * t;
      pts.push({
        x: a * from.x + b * mx + c * to.x,
        y: a * from.y + b * my + c * to.y,
      });
    }
    return pts;
  };
  const J: Point = { x: 10, y: 10 };
  const arms = [
    arm(J, { x: 10, y: 20 }),
    arm(J, { x: 20, y: 10 }),
    arm(J, { x: 10, y: 0 }),
    arm(J, { x: 0, y: 10 }),
  ];
  const pieces: InkPiece[] = arms.map((a) => ({ top: a.map((p) => ({ ...p })), centerline: a, widthMm: 1 }));
  return { pieces, tracks: arms };
}

/** The runs a router emitted that are NOT piece tops (which it may emit
 *  reversed) — the connectors. */
function connectorsOf(runs: Path[], pieces: InkPiece[]): Path[] {
  const same = (a: Path, b: Path): boolean =>
    a.length === b.length &&
    a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < 1e-9);
  return runs.filter((r) => {
    for (const p of pieces) {
      if (same(r, p.top) || same(r, [...p.top].reverse())) return false;
    }
    return true;
  });
}

function distToTracks(p: Point, tracks: Path[]): number {
  let m = Infinity;
  for (const t of tracks) {
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1];
      const b = t[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      let u = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      m = Math.min(m, Math.hypot(a.x + u * dx - p.x, a.y + u * dy - p.y));
    }
  }
  return m;
}

describe("ink connector transit phase stagger", () => {
  const start: Point = { x: 10, y: 20 };

  it("two routing phases over the same network never re-punch a connector hole", () => {
    const { pieces, tracks } = crossPieces();
    // Same pieces routed twice, as the underlay and top phases do (salts 0/2).
    const a = connectorsOf(routeInkPieces(pieces.map((p) => ({ ...p })), start, 3.5, tracks, 0), pieces);
    const b = connectorsOf(routeInkPieces(pieces.map((p) => ({ ...p })), start, 3.5, tracks, 2), pieces);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    // Interior connector penetrations (endpoints legitimately share the
    // piece-end entry holes) must interleave across phases, not stack.
    const interior = (runs: Path[]): Point[] => runs.flatMap((r) => r.slice(1, -1));
    let worst = Infinity;
    for (const p of interior(a)) {
      for (const q of interior(b)) {
        worst = Math.min(worst, Math.hypot(p.x - q.x, p.y - q.y));
      }
    }
    expect(worst).toBeGreaterThan(0.1); // a needle hole is ~0.1mm — no re-punch
  });

  it("staggered connectors still ride the ink within the deviation budget", () => {
    const { pieces, tracks } = crossPieces();
    for (const salt of [0, 1, 2]) {
      const conns = connectorsOf(routeInkPieces(pieces.map((p) => ({ ...p })), start, 3.5, tracks, salt), pieces);
      for (const run of conns) {
        for (let i = 0; i < run.length; i++) {
          expect(distToTracks(run[i], tracks)).toBeLessThanOrEqual(0.35); // chamfer + walk budget
          if (i > 0) {
            const mid = { x: (run[i].x + run[i - 1].x) / 2, y: (run[i].y + run[i - 1].y) / 2 };
            expect(distToTracks(mid, tracks)).toBeLessThanOrEqual(0.35);
            // machine-safe pitch band
            const seg = Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
            expect(seg).toBeLessThanOrEqual(3.5 + 1e-6);
          }
        }
      }
    }
  });
});
