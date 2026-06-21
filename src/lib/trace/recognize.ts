import type { Path, Point } from "../../types/project";
import { polygonArea, polygonPerimeter } from "./classify";
import { douglasPeucker } from "./simplify";

/**
 * Smart-shape recognition: decide whether a closed outline (freehand, or traced
 * from artwork) is really a clean primitive — a circle, regular polygon,
 * rectangle, or ellipse — and if so return the EXACT primitive's geometry. A
 * recognized shape stitches perfectly (true-circle satin, square corners) instead
 * of as a wobbly blob, and gives the engine a clean medial/principal axis.
 *
 * Pure geometry, deterministic: fit each candidate, accept the best one whose
 * residual is within tolerance, else return null (keep the original outline).
 */

export type ShapeId = "circle" | "ellipse" | "rectangle" | "polygon";

export interface Recognized {
  kind: ShapeId;
  /** the exact primitive's ring (closed, CCW). */
  ring: Path;
  /** rotation of the primitive in degrees (rectangle/ellipse/polygon). */
  angleDeg: number;
}

function centroid(ring: Path): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Resample a closed ring to `n` evenly-spaced points by arc length. */
function resampleClosed(ring: Path, n: number): Path {
  const pts = ring.length > 1 && dist(ring[0], ring[ring.length - 1]) < 1e-6 ? ring.slice(0, -1) : ring;
  const m = pts.length;
  const cum = [0];
  for (let i = 1; i <= m; i++) cum.push(cum[i - 1] + dist(pts[i % m], pts[i - 1]));
  const total = cum[m];
  if (total <= 0) return pts;
  const out: Path = [];
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total;
    let i = 1;
    while (i < m && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1e-9;
    const t = (s - cum[i - 1]) / seg;
    const a = pts[(i - 1) % m];
    const b = pts[i % m];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Principal-axis angle (rad) of a point set from its covariance. */
function principalAngle(pts: Path, c: Point): number {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

function makeCircle(c: Point, r: number, n = 64): Path {
  const out: Path = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

function makeEllipse(c: Point, a: number, b: number, rot: number, n = 72): Path {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const out: Path = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ex = a * Math.cos(t);
    const ey = b * Math.sin(t);
    out.push({ x: c.x + ex * cs - ey * sn, y: c.y + ex * sn + ey * cs });
  }
  return out;
}

function makeRegular(c: Point, r: number, sides: number, rot: number): Path {
  const out: Path = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

/** A (possibly rotated) rectangle ring from center, half-extents, and angle. */
function makeRect(c: Point, hw: number, hh: number, rot: number): Path {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return corners.map(([x, y]) => ({ x: c.x + x * cs - y * sn, y: c.y + x * sn + y * cs }));
}

/**
 * Recognize a closed ring as a clean primitive, or return null. `tolMm` is the
 * mean allowed deviation of the outline from the fitted shape (default 0.6 mm).
 */
export function recognizeShape(ring: Path, tolMm = 0.6): Recognized | null {
  if (ring.length < 4) return null;
  const open = dist(ring[0], ring[ring.length - 1]) < 1e-6 ? ring.slice(0, -1) : ring.slice();
  if (open.length < 4) return null;
  const c = centroid(open);
  const area = Math.abs(polygonArea(open));
  const perim = polygonPerimeter(open);
  if (area < 4 || perim < 4) return null;
  const samples = resampleClosed(open, 96);
  const radii = samples.map((p) => dist(p, c));
  const meanR = radii.reduce((s, r) => s + r, 0) / radii.length;
  if (meanR < 1) return null;

  // --- Circle: high CIRCULARITY (4π·area/perimeter² → 1 for a circle, 0.91 for a
  // hexagon, 0.79 for a square) AND a near-constant radius. Circularity cleanly
  // separates a circle from a regular polygon, which equal-radius alone can't. ---
  let sampPerim = 0;
  for (let i = 0; i < samples.length; i++) sampPerim += dist(samples[i], samples[(i + 1) % samples.length]);
  const circularity = sampPerim > 0 ? (4 * Math.PI * area) / (sampPerim * sampPerim) : 0;
  const radSd = Math.sqrt(radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length);
  if (circularity > 0.945 && radSd / meanR < 0.05) {
    return { kind: "circle", ring: makeCircle(c, meanR), angleDeg: 0 };
  }

  // Principal frame + the shape's oriented bounding box (half-extents a, b).
  const rot = principalAngle(samples, c);
  const cs = Math.cos(-rot);
  const sn = Math.sin(-rot);
  let a = 0;
  let b = 0;
  for (const p of samples) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    a = Math.max(a, Math.abs(dx * cs - dy * sn));
    b = Math.max(b, Math.abs(dx * sn + dy * cs));
  }
  if (a < 0.5 || b < 0.5) return null;
  const boxArea = 4 * a * b;
  const fillRatio = area / boxArea; // 1.0 = fills its box (rectangle), 0.785 = ellipse

  // --- Rectangle: nearly fills its oriented bounding box. ---
  if (fillRatio > 0.9) {
    const rect = makeRect(c, a, b, rot);
    if (fitsWithin(samples, rect, tolMm * 2)) {
      return { kind: "rectangle", ring: rect, angleDeg: (rot * 180) / Math.PI };
    }
  }

  // --- Regular polygon: 3–12 corners, equidistant from the centre. ---
  const simp = douglasPeucker(open, Math.max(tolMm * 1.5, perim * 0.012));
  const corners = simp.length > 1 && dist(simp[0], simp[simp.length - 1]) < 1e-6 ? simp.slice(0, -1) : simp;
  if (corners.length >= 3 && corners.length <= 12) {
    const cr = corners.map((p) => dist(p, c));
    const mr = cr.reduce((s, r) => s + r, 0) / cr.length;
    const crSd = Math.sqrt(cr.reduce((s, r) => s + (r - mr) ** 2, 0) / cr.length);
    if (crSd / mr < 0.08) {
      const rot0 = Math.atan2(corners[0].y - c.y, corners[0].x - c.x);
      const ringP = makeRegular(c, mr, corners.length, rot0);
      // Fit tolerance RELATIVE to size: a real polygon's edges sit on its samples
      // (≈0 residual), but a small round blob approximated by an inscribed polygon
      // bows out by ~0.19·radius — a fixed mm tolerance is far too loose on a tiny
      // feature (an eye), so it gets mis-snapped to a pentagon. Capping at a small
      // fraction of the radius rejects the blob while still accepting true polygons.
      if (fitsWithin(samples, ringP, Math.min(tolMm * 2.2, mr * 0.06))) {
        return { kind: "polygon", ring: ringP, angleDeg: (rot0 * 180) / Math.PI };
      }
    }
  }

  // --- Ellipse: fills ~π/4 of its box and clearly non-circular. ---
  if (fillRatio > 0.7 && fillRatio < 0.86 && (a / b > 1.08 || b / a > 1.08)) {
    const ell = makeEllipse(c, a, b, rot);
    if (fitsWithin(samples, ell, tolMm * 1.6)) {
      return { kind: "ellipse", ring: ell, angleDeg: (rot * 180) / Math.PI };
    }
  }

  // --- Small round dot (golf ball, eye, polka dot): almost certainly MEANT to be a
  // circle, but a shadow notch or trace noise can nudge it just past the strict
  // circle test above, leaving a faceted decagon that reads as a bug. Snap a SMALL,
  // round-aspect, circle-like blob to a true circle on a looser bar. Runs after the
  // polygon/rectangle checks so a clean hexagon (circularity ~0.91) is already
  // claimed as a polygon, not rounded off here. ---
  const aspect = a > b ? a / b : b / a;
  if (meanR <= 6 && aspect < 1.15 && circularity > 0.92 && radSd / meanR < 0.1) {
    return { kind: "circle", ring: makeCircle(c, meanR), angleDeg: 0 };
  }
  return null;
}

/** Mean nearest-vertex distance from each sample to the candidate ring ≤ tol. */
function fitsWithin(samples: Path, candidate: Path, tol: number): boolean {
  let sum = 0;
  for (const p of samples) {
    let best = Infinity;
    for (let i = 0; i < candidate.length; i++) {
      const a = candidate[i];
      const b = candidate[(i + 1) % candidate.length];
      best = Math.min(best, pointToSeg(p, a, b));
    }
    sum += best;
  }
  return sum / samples.length <= tol;
}

function pointToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
