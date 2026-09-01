import { describe, it, expect } from "vitest";
import type { Path, Point } from "../../types/project";
import { turningFill, PRO_TURNED_STAGGER_COHERENCE } from "./turning";

/**
 * TURNED-FILL penetration phase coherence. A turned fill's rows curve with the
 * shape's spine; the commercial references still keep their penetrations on a
 * repeating brick ALONG the sweep (stagger coherence ~0.94+, the same bar the
 * straight tatami holds — see PRO_TURNED_STAGGER_COHERENCE). Rows that divide
 * their own boundary-to-boundary length evenly re-derive pitch and phase per
 * row, so adjacent rows drift against each other and the fill reads as
 * penetration noise (a corpus arch region measured ~0.17). The fix anchors
 * each row's interior lattice at its spine crossing.
 */

/** An annular arc band (a clean curved stroke a turning fill accepts). */
function arcBand(r0: number, r1: number, degSpan: number): Path[] {
  const ring: Path = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const a = ((i / n) * degSpan * Math.PI) / 180;
    ring.push({ x: r1 * Math.cos(a), y: r1 * Math.sin(a) });
  }
  for (let i = n; i >= 0; i--) {
    const a = ((i / n) * degSpan * Math.PI) / 180;
    ring.push({ x: r0 * Math.cos(a), y: r0 * Math.sin(a) });
  }
  return [ring];
}

/** Split a serpentine run into its straight rows: a segment leaving the row's
 *  own line by >50° is the row-end connector (or the turnaround), so it closes
 *  the row. Each row runs boundary → boundary. */
function rowsOf(run: Point[]): Point[][] {
  const rows: Point[][] = [];
  let cur: Point[] = [run[0]];
  for (let i = 1; i < run.length; i++) {
    const sx = run[i].x - run[i - 1].x;
    const sy = run[i].y - run[i - 1].y;
    const sl = Math.hypot(sx, sy);
    if (sl < 1e-9) continue;
    if (cur.length >= 2) {
      const rx = cur[cur.length - 1].x - cur[0].x;
      const ry = cur[cur.length - 1].y - cur[0].y;
      const rl = Math.hypot(rx, ry) || 1;
      const cos = (rx * sx + ry * sy) / (rl * sl);
      if (cos < Math.cos((50 * Math.PI) / 180)) {
        rows.push(cur);
        cur = [run[i - 1]];
      }
    }
    cur.push(run[i]);
  }
  rows.push(cur);
  return rows.filter((r) => r.length >= 4);
}

/** Interior penetrations of a row — boundary crossings and clearance-slid
 *  points (both legitimately off-lattice) excluded. */
function interiorOf(row: Point[]): Point[] {
  const a = row[0];
  const b = row[row.length - 1];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  return row.filter((p) => {
    const s = (p.x - a.x) * ux + (p.y - a.y) * uy;
    return s > 0.7 && s < L - 0.7;
  });
}

/** Circular resultant of adjacent-row phase steps (1 = exact repeating brick).
 *  Row directions are oriented consistently — the serpentine reverses every
 *  other row's sew order, and projecting on the raw sew direction would flip
 *  the step's sign row by row and cancel a perfect brick to zero. */
function staggerCoherence(rows: Point[][], stitch: number): number {
  let sx = 0;
  let sy = 0;
  let n = 0;
  let refX = 0;
  let refY = 0;
  for (let k = 1; k < rows.length; k++) {
    const prev = rows[k - 1];
    const pu = interiorOf(prev);
    if (pu.length < 1) continue;
    const a = prev[0];
    const b = prev[prev.length - 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let ux = (b.x - a.x) / L;
    let uy = (b.y - a.y) / L;
    if (ux * refX + uy * refY < 0) {
      ux = -ux;
      uy = -uy;
    }
    refX = ux;
    refY = uy;
    for (const p of interiorOf(rows[k])) {
      let best: Point | null = null;
      let bd = Infinity;
      for (const q of pu) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      if (!best || bd > stitch) continue;
      const step = ((((p.x - best.x) * ux + (p.y - best.y) * uy) / stitch) % 1) * 2 * Math.PI;
      sx += Math.cos(step);
      sy += Math.sin(step);
      n++;
    }
  }
  return n ? Math.hypot(sx, sy) / n : NaN;
}

describe("turned-fill stagger coherence (spine-anchored lattice)", () => {
  const stitch = 3.5;

  it("a curved band's rows hold the commercial brick along the sweep", () => {
    const runs = turningFill(arcBand(12, 20, 150), { density: 0.65, angle: 0, stitchLength: stitch });
    expect(runs).not.toBeNull();
    const rows = runs!.flatMap(rowsOf);
    expect(rows.length).toBeGreaterThan(30);
    const coh = staggerCoherence(rows, stitch);
    expect(coh).toBeGreaterThanOrEqual(PRO_TURNED_STAGGER_COHERENCE);
  });

  it("rows still span the wall and no stitch exceeds the pitch + clearance slide", () => {
    const runs = turningFill(arcBand(12, 20, 150), { density: 0.65, angle: 0, stitchLength: stitch });
    expect(runs).not.toBeNull();
    // Segment-length safety on the whole serpentine (row-end connectors are far
    // shorter than the pitch).
    for (const run of runs!) {
      for (let i = 1; i < run.length; i++) {
        const seg = Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
        expect(seg).toBeLessThanOrEqual(stitch + 0.55 + 1e-6);
      }
    }
    // The typical row still sweeps the band's full 8mm wall.
    const spans = runs!
      .flatMap(rowsOf)
      .map((r) => Math.hypot(r[r.length - 1].x - r[0].x, r[r.length - 1].y - r[0].y))
      .sort((a, b) => a - b);
    expect(spans[spans.length >> 1]).toBeGreaterThan(6.5);
  });
});
