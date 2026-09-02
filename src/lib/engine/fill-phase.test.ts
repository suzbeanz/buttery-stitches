import { describe, it, expect } from "vitest";
import { tatamiFill, tatamiConcaveRuns, PRO_TATAMI_STAGGER_COHERENCE } from "./fill";
import type { Path, Point } from "../../types/project";

/**
 * TATAMI PENETRATION-PHASE COHERENCE — the "woven texture" gate.
 *
 * Commercial tatami reads as a woven surface because the needle-split pattern
 * is COHERENT: every row's interior penetrations sit on one region-global
 * lattice, offset row-to-row by an exactly repeating brick. Measured on the
 * decoded commercial reference corpus (six designs), the cross-row stagger
 * coherence — the circular resultant of adjacent-row (position-ordered) phase
 * steps, 1 for a perfect brick, ~0 for random phase — is 0.74–0.86 aggregated
 * per design and ~0.99 in the cleanest straight-tatami blocks
 * ({@link PRO_TATAMI_STAGGER_COHERENCE} sits above every commercial
 * per-design aggregate, at the clean-block texture this engine targets). Our
 * fills measured 0.49–0.83 on the same corpus statistic: the span-anchored
 * penetration grid drifted with every oblique/curved boundary and a
 * ±0.1-stitch per-row jitter scrambled the brick — the visible "scraggly
 * fill" noise.
 *
 * Fail-before verification (this file, engine before the region-global
 * lattice): circle stagger coherence 0.863 (< 0.94 gate), U-shape pooled
 * within-row lattice regularity 0.805 (< 0.94 gate) because each
 * boustrophedon cell re-anchored its grid to its own span starts.
 */

const STITCH = 4;
const DENSITY = 0.4;

/** Circular phase statistics over scan rows (angle-0 fills: rows share a y).
 *  `coherence`: resultant of adjacent-row phase steps (brick regularity).
 *  `lattice`: mean per-row resultant of interior phases (grid evenness —
 *  pooled across cells, so cross-cell lattice mismatch drags it down). */
function phaseStats(
  pts: Point[],
  interior: (p: Point) => boolean,
): { coherence: number; lattice: number } {
  const rows = new Map<number, number[]>();
  for (const p of pts) {
    if (!interior(p)) continue;
    const key = Math.round(p.y * 1000) / 1000;
    let xs = rows.get(key);
    if (!xs) rows.set(key, (xs = []));
    xs.push(p.x);
  }
  const perRow: { y: number; th: number; r: number }[] = [];
  for (const [y, xs] of rows) {
    if (xs.length < 2) continue;
    let cx = 0;
    let cy = 0;
    for (const x of xs) {
      const ph = (2 * Math.PI * x) / STITCH;
      cx += Math.cos(ph);
      cy += Math.sin(ph);
    }
    perRow.push({ y, th: Math.atan2(cy, cx), r: Math.hypot(cx, cy) / xs.length });
  }
  perRow.sort((a, b) => a.y - b.y);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 1; i < perRow.length; i++) {
    if (perRow[i].y - perRow[i - 1].y > 1.5 * DENSITY) continue; // non-adjacent
    const d = perRow[i].th - perRow[i - 1].th;
    sx += Math.cos(d);
    sy += Math.sin(d);
    n++;
  }
  expect(n).toBeGreaterThan(20); // the fixture must actually exercise many rows
  return {
    coherence: Math.hypot(sx, sy) / n,
    lattice: perRow.reduce((s, r) => s + r.r, 0) / perRow.length,
  };
}

describe("tatami penetration-phase coherence (commercial woven-texture bar)", () => {
  it("curved boundaries do not de-phase the brick (region-global lattice)", () => {
    // A circle: both span ends drift nonlinearly row to row, the worst case for
    // a span-anchored grid. Interior = safely away from the boundary crossings.
    const N = 128;
    const circle: Path = Array.from({ length: N }, (_, i) => ({
      x: 20 + 15 * Math.cos((2 * Math.PI * i) / N),
      y: 20 + 15 * Math.sin((2 * Math.PI * i) / N),
    }));
    const out = tatamiFill([circle], { density: DENSITY, angle: 0, stitchLength: STITCH });
    const edge = (p: Point) => {
      const dy = p.y - 20;
      const half = Math.sqrt(Math.max(0, 15 * 15 - dy * dy));
      return Math.abs(p.x - (20 - half)) < 1 || Math.abs(p.x - (20 + half)) < 1;
    };
    const { coherence } = phaseStats(out, (p) => !edge(p));
    expect(coherence).toBeGreaterThanOrEqual(PRO_TATAMI_STAGGER_COHERENCE);
  });

  it("boustrophedon cells share one lattice (no per-cell re-anchoring)", () => {
    // A U: the two arms sew as separate cells over the same scan rows. Pooling
    // each row across BOTH arms only reads as one even grid when the cells
    // share the region-global lattice.
    const U: Path = [
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 24 }, { x: 21, y: 24 },
      { x: 21, y: 8 }, { x: 9, y: 8 }, { x: 9, y: 24 }, { x: 0, y: 24 },
    ];
    const runs = tatamiConcaveRuns([U], { density: DENSITY, angle: 0, stitchLength: STITCH });
    const ends = (y: number) => (y > 8 ? [0, 9, 21, 30] : [0, 30]);
    const interior = (p: Point) => ends(p.y).every((e) => Math.abs(p.x - e) > 0.7);
    const { coherence, lattice } = phaseStats(runs.flat(), interior);
    expect(coherence).toBeGreaterThanOrEqual(PRO_TATAMI_STAGGER_COHERENCE);
    expect(lattice).toBeGreaterThanOrEqual(PRO_TATAMI_STAGGER_COHERENCE);
  });
});
