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

export type ShapeId = "circle" | "ellipse" | "rectangle" | "roundedRect" | "polygon";

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

/** A rounded rectangle ring: straight edges joined by quarter-circle corners of
 *  radius rc, in the frame centred at c rotated by rot. */
function makeRoundedRect(c: Point, hw: number, hh: number, rc: number, rot: number): Path {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const put = (x: number, y: number): Point => ({ x: c.x + x * cs - y * sn, y: c.y + x * sn + y * cs });
  const out: Path = [];
  // Corner arc centers (CCW from +x+y corner), each spanning 90°.
  const cornersC: [number, number, number][] = [
    [hw - rc, hh - rc, 0],
    [-(hw - rc), hh - rc, Math.PI / 2],
    [-(hw - rc), -(hh - rc), Math.PI],
    [hw - rc, -(hh - rc), (3 * Math.PI) / 2],
  ];
  const arcSteps = Math.max(3, Math.ceil((Math.PI / 2) * rc / 0.5));
  for (const [cx, cy, a0] of cornersC) {
    for (let s = 0; s <= arcSteps; s++) {
      const a = a0 + ((Math.PI / 2) * s) / arcSteps;
      out.push(put(cx + rc * Math.cos(a), cy + rc * Math.sin(a)));
    }
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
  // The box is centred on the PROJECTION MIDRANGE, not the centroid: an
  // asymmetric outline (a pole that tapers where it meets the ground) has its
  // centroid pulled toward the heavy end, and a primitive fitted symmetrically
  // about the centroid overshoots the light end by the asymmetry — a snapped
  // "ellipse" sticking millimetres above the artwork.
  const obbAt = (rotC: number) => {
    const cs = Math.cos(-rotC);
    const sn = Math.sin(-rotC);
    let loU = Infinity, hiU = -Infinity, loV = Infinity, hiV = -Infinity;
    for (const p of samples) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const u = dx * cs - dy * sn;
      const v = dx * sn + dy * cs;
      if (u < loU) loU = u;
      if (u > hiU) hiU = u;
      if (v < loV) loV = v;
      if (v > hiV) hiV = v;
    }
    const a2 = (hiU - loU) / 2;
    const b2 = (hiV - loV) / 2;
    const mu = (loU + hiU) / 2;
    const mv = (loV + hiV) / 2;
    return {
      a: a2,
      b: b2,
      cb: { x: c.x + mu * cs + mv * sn, y: c.y - mu * sn + mv * cs } as Point,
      fillRatio: a2 > 0 && b2 > 0 ? area / (4 * a2 * b2) : 0,
    };
  };
  const rot = principalAngle(samples, c);
  // The DOMINANT EDGE direction (length-weighted circular mean on the mod-90°
  // torus). For anything rectangular this is the true orientation — the
  // principal axis of a near-square box is ill-conditioned, and a few degrees
  // of tilt inflates the OBB enough that a sharp rectangle reads as a rounded
  // blob and falls through to the ellipse branch (a truck window snapped to an
  // OVAL). Rect-family branches try both candidates and keep the better box.
  const edgePoly = douglasPeucker(open, Math.max(0.3, perim * 0.008));
  let ex4 = 0, ey4 = 0;
  for (let i = 0; i < edgePoly.length; i++) {
    const p1 = edgePoly[i];
    const p2 = edgePoly[(i + 1) % edgePoly.length];
    const len = dist(p1, p2);
    if (len < 1e-6) continue;
    const ang4 = 4 * Math.atan2(p2.y - p1.y, p2.x - p1.x);
    ex4 += len * Math.cos(ang4);
    ey4 += len * Math.sin(ang4);
  }
  const rotEdges = Math.atan2(ey4, ex4) / 4;
  const boxes = [obbAt(rot), obbAt(rotEdges)];
  const rots = [rot, rotEdges];
  // Rect-family candidates prefer the tighter box (higher fill ratio).
  const rectFirst = boxes[1].fillRatio > boxes[0].fillRatio ? [1, 0] : [0, 1];
  const { a, b, cb, fillRatio } = boxes[0];
  if (a < 0.5 || b < 0.5) return null;

  // Fit tolerances must never exceed a fraction of the MINOR half-extent: on a
  // narrow shape (a 3 mm-wide flag pole) an absolute mm tolerance is wider than
  // the shape itself, so EVERY long candidate "fits" — a bar snaps to a cigar
  // ellipse whose pointed ends overshoot the artwork by millimetres. The same
  // relative-cap idea the polygon branch uses below.
  const minor = Math.min(a, b);

  // --- Rounded rectangle: a cartoon window, a badge, a button. Corner radius
  // recovered from the area deficit vs the bounding box (area = 4ab − (4−π)rc²).
  // The rc cap at 0.7·minor mathematically excludes every true ellipse (an
  // ellipse's deficit gives rc = √(ab) ≥ 0.7·minor whenever a ≤ 2b), so this
  // can't eat the ellipse family — while a rounded window, whose fill ratio
  // sinks into ellipse range and previously snapped to a visibly wrong OVAL,
  // is claimed here first with its true straight edges and round corners. ---
  for (const bi of rectFirst) {
    const B = boxes[bi];
    if (B.a < 0.5 || B.b < 0.5) continue;
    const minorB = Math.min(B.a, B.b);
    const rc2 = (4 * B.a * B.b - area) / (4 - Math.PI);
    const rc = rc2 > 0 ? Math.sqrt(rc2) : 0;
    if (rc < minorB * 0.12 || rc > minorB * 0.7 || B.fillRatio <= 0.78) continue;
    // The corners must really be EMPTY: on a rounded rect no outline point comes
    // within ~0.41·rc of the box corner, while a jitter-traced SHARP rectangle
    // (whose noise inflates the area deficit into a phantom rc) reaches its
    // corners — that one belongs to the rectangle branch below.
    const boxCorners = makeRect(B.cb, B.a, B.b, rots[bi]);
    let cornerDist = Infinity;
    for (const p of samples) for (const q of boxCorners) cornerDist = Math.min(cornerDist, dist(p, q));
    if (cornerDist < rc * 0.25) continue;
    const rrect = makeRoundedRect(B.cb, B.a, B.b, rc, rots[bi]);
    const cap = Math.min(tolMm * 1.4, minorB * 0.3);
    if (fitsWithin(samples, rrect, cap, cap * 0.9)) {
      return { kind: "roundedRect", ring: rrect, angleDeg: (rots[bi] * 180) / Math.PI };
    }
  }

  // --- Rectangle: nearly fills its oriented bounding box. Tried in both
  // candidate orientations, tighter box first. ---
  for (const bi of rectFirst) {
    const B = boxes[bi];
    if (B.a < 0.5 || B.b < 0.5 || B.fillRatio <= 0.9) continue;
    const minorB = Math.min(B.a, B.b);
    const rect = makeRect(B.cb, B.a, B.b, rots[bi]);
    if (fitsWithin(samples, rect, Math.min(tolMm * 2, minorB * 0.6))) {
      return { kind: "rectangle", ring: rect, angleDeg: (rots[bi] * 180) / Math.PI };
    }
  }

  // --- Regular polygon: 3–12 corners, equidistant from the centre. ---
  const simp = douglasPeucker(open, Math.max(tolMm * 1.5, perim * 0.012));
  let corners = simp.length > 1 && dist(simp[0], simp[simp.length - 1]) < 1e-6 ? simp.slice(0, -1) : simp;
  // Merge a STUB corner — a vertex separated from its neighbour by far less than the
  // average edge (a trace seam or an open-ring closing artifact) — so it doesn't fake
  // an extra side and skew the edge-uniformity test below.
  if (corners.length >= 4) {
    const avgEdge = corners.reduce((s, p, i) => s + dist(p, corners[(i + 1) % corners.length]), 0) / corners.length;
    const merged: Path = [];
    for (const p of corners) if (!merged.length || dist(p, merged[merged.length - 1]) > avgEdge * 0.33) merged.push(p);
    if (merged.length > 1 && dist(merged[0], merged[merged.length - 1]) < avgEdge * 0.33) merged.pop();
    corners = merged;
  }
  if (corners.length >= 3 && corners.length <= 12) {
    const cr = corners.map((p) => dist(p, c));
    const mr = cr.reduce((s, r) => s + r, 0) / cr.length;
    const crSd = Math.sqrt(cr.reduce((s, r) => s + (r - mr) ** 2, 0) / cr.length);
    // A regular polygon also has UNIFORM EDGE LENGTHS. Without this, a rounded or
    // slanted rectangle (a cartoon window) whose corners happen to sit at similar
    // radii gets mis-snapped to an octagon — its edges alternate long sides / short
    // corner-cuts, so an edge-uniformity gate rejects it (and it straightens cleanly
    // instead), while a true hexagon (equal edges) still passes.
    const edges = corners.map((p, i) => dist(p, corners[(i + 1) % corners.length]));
    const me = edges.reduce((s, e) => s + e, 0) / edges.length;
    const eSd = Math.sqrt(edges.reduce((s, e) => s + (e - me) ** 2, 0) / edges.length);
    if (crSd / mr < 0.08 && me > 0 && eSd / me < 0.22) {
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

  // --- Ellipse: fills ~π/4 of its box and clearly non-circular. The p90 gate
  // rejects the near-miss family (a stadium/rounded bar reads as an ellipse on
  // mean distance but its straight sides deviate >1mm). ---
  if (fillRatio > 0.7 && fillRatio < 0.86 && (a / b > 1.08 || b / a > 1.08)) {
    const ell = makeEllipse(cb, a, b, rot);
    const cap = Math.min(tolMm * 1.6, minor * 0.35);
    if (fitsWithin(samples, ell, cap, cap * 0.9)) {
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

/** Mean nearest-vertex distance from each sample to the candidate ring ≤ tol —
 *  and, when `tolP90` is given, the 90th-percentile distance too. The mean
 *  alone forgives a SYSTEMATIC misfit spread thinly around the ring: a
 *  stadium-shaped bar (straight sides, round caps) "fits" an ellipse on mean
 *  distance because only the mid-sides deviate — but those deviations run over
 *  a millimetre, and the snapped ellipse bulges visibly past the artwork. A
 *  true primitive fits everywhere, so its p90 stays near zero. */
function fitsWithin(samples: Path, candidate: Path, tol: number, tolP90?: number): boolean {
  const dists: number[] = [];
  let sum = 0;
  for (const p of samples) {
    let best = Infinity;
    for (let i = 0; i < candidate.length; i++) {
      const a = candidate[i];
      const b = candidate[(i + 1) % candidate.length];
      best = Math.min(best, pointToSeg(p, a, b));
    }
    sum += best;
    dists.push(best);
  }
  if (sum / samples.length > tol) return false;
  if (tolP90 !== undefined) {
    dists.sort((x, y) => x - y);
    if (dists[Math.floor(dists.length * 0.9)] > tolP90) return false;
  }
  return true;
}

function pointToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
