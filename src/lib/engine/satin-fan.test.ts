import { describe, it, expect } from "vitest";
import { medialColumns } from "./medial";
import type { Path, Point } from "../../types/project";

/**
 * SATIN COVERAGE AROUND A TIGHT SHOULDER — the wave-2 visible-defect class.
 *
 * On a curved letter bowl whose OUTER edge turns on a radius smaller than the
 * stroke width (the crest's big C: 3.8mm stroke, ~2.5mm outer shoulder radius),
 * the anti-crossing pass dropped every throw that still crossed the accepted
 * fan after one pivot nudge. Each dropped throw doubles the pitch at the outer
 * rail right at the shoulder, and the sewn letter shows the ground colour
 * through radial V-slits at its most visible feature (measured 1.09mm² bare on
 * the corpus C). Each slit is ~0.25mm², under the residual mend pass's 0.5mm²
 * patch floor — so the fan itself must stay dense.
 *
 * Geometry class (synthetic): a C-band bent around a rounded rectangle with a
 * tight outer corner radius — thick stroke, outer turn radius below the stroke
 * width. The gate: near-total coverage by the throws alone, measured on a fine
 * grid against the thread's own half-width.
 */

/** Rounded-rectangle C-band: outer 14×18 rect with r=3 corners, 3.8mm-wide
 *  band, mouth cut open on the right side. Sampled at ~0.3mm like a trace. */
function roundedCBand(): Path {
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, out: Point[]) => {
    const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / 360) * 2 * Math.PI * r * 3));
    for (let s = 0; s <= steps; s++) {
      const a = ((a0 + ((a1 - a0) * s) / steps) * Math.PI) / 180;
      out.push({ x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) });
    }
  };
  const line = (a: Point, b: Point, out: Point[]) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(L / 0.3));
    for (let s = 1; s <= n; s++) out.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
  };
  const W = 3.8; // band width
  const R = 3.0; // outer corner radius (tighter than the band width)
  const ring: Point[] = [];
  // Outer contour, clockwise from the mouth's upper lip (right side, y=4):
  ring.push({ x: 14, y: 4 });
  line({ x: 14, y: 4 }, { x: 14, y: R }, ring); // up the right edge to the top-right corner
  arc(14 - R, R, R, 0, 90, ring); // top-right corner
  line({ x: 14 - R, y: 0 }, { x: R, y: 0 }, ring); // top edge
  arc(R, R, R, 90, 180, ring); // top-left corner
  line({ x: 0, y: R }, { x: 0, y: 18 - R }, ring); // left edge
  arc(R, 18 - R, R, 180, 270, ring); // bottom-left corner
  line({ x: R, y: 18 }, { x: 14 - R, y: 18 }, ring); // bottom edge
  arc(14 - R, 18 - R, R, 270, 360, ring); // bottom-right corner
  line({ x: 14, y: 18 - R }, { x: 14, y: 11 }, ring); // up to the mouth's lower lip
  // Inner contour, back the way we came (band width W inside):
  const rIn = Math.max(0.5, R - W + 1.2); // inner corners tighter, like a traced letter
  line({ x: 14 - W, y: 11 }, { x: 14 - W, y: 18 - W }, ring);
  line({ x: 14 - W, y: 18 - W }, { x: W + rIn, y: 18 - W }, ring);
  arc(W + rIn, 18 - W - rIn, rIn, 270, 180, ring);
  line({ x: W, y: 18 - W - rIn }, { x: W, y: W + rIn }, ring);
  arc(W + rIn, W + rIn, rIn, 180, 90, ring);
  line({ x: W + rIn, y: W }, { x: 14 - W - rIn, y: W }, ring);
  arc(14 - W - rIn, W + rIn, rIn, 90, 0, ring);
  line({ x: 14 - W, y: W + rIn }, { x: 14 - W, y: 4 }, ring);
  return ring;
}

function pointInRings(p: Point, rings: Path[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
  }
  return inside;
}

describe("satin around a tight outer shoulder stays covered", () => {
  it("throws alone cover a rounded-C band — no dropped-throw slits", () => {
    const ring = roundedCBand();
    const cols = medialColumns([ring], { density: 0.35, pullScale: 1 });
    expect(cols.length).toBeGreaterThan(0);
    const segs: [Point, Point][] = [];
    for (const c of cols) {
      for (let i = 1; i < c.throws.length; i++) segs.push([c.throws[i - 1], c.throws[i]]);
    }
    expect(segs.length).toBeGreaterThan(100);
    const distToSegs = (p: Point): number => {
      let best = Infinity;
      for (const [a, b] of segs) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L2 = dx * dx + dy * dy || 1;
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
        if (d < best) best = d;
        if (best < 0.05) return best;
      }
      return best;
    };
    // Fine-grid bare fraction, judged against the thread's own half-width. An
    // interior sample further than 0.2mm from every throw shows ground colour.
    // Stay 0.25mm off the boundary so pull-comp/edge quantization noise doesn't
    // count — this measures INTERIOR slits, the visible defect.
    let bare = 0;
    let total = 0;
    for (let y = 0.25; y <= 18; y += 0.12) {
      for (let x = 0.25; x <= 14; x += 0.12) {
        const p = { x, y };
        if (!pointInRings(p, [ring])) continue;
        if (
          !pointInRings({ x: x - 0.25, y }, [ring]) ||
          !pointInRings({ x: x + 0.25, y }, [ring]) ||
          !pointInRings({ x, y: y - 0.25 }, [ring]) ||
          !pointInRings({ x, y: y + 0.25 }, [ring])
        )
          continue; // boundary margin
        total++;
        if (distToSegs(p) > 0.2) bare++;
      }
    }
    expect(total).toBeGreaterThan(2000);
    const frac = bare / total;
    expect(frac, `bare interior fraction ${(100 * frac).toFixed(2)}%`).toBeLessThanOrEqual(0.003);
  });
});
