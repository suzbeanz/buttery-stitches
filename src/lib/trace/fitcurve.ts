import type { Point } from "../../types/project";

/**
 * Least-squares cubic Bézier fitting for the native tracer's crack polylines —
 * Schneider's algorithm (Graphics Gems, "An Algorithm for Automatically
 * Fitting Digitized Curves") adapted to closed rings with forced breakpoints.
 *
 * This is the denoiser the raw crack polylines need: Douglas–Peucker ANCHORS
 * on jitter extremes (it keeps the max-deviation vertex, i.e. the noise
 * peaks), while a least-squares fit AVERAGES the ±half-pixel crack/snap
 * jitter into the smooth curve that was actually drawn. Corners are detected
 * first and never rounded; junction vertices (where three fills meet) are
 * forced breakpoints, so a boundary section shared by two rings — the same
 * dense point sequence between the same two junctions — fits to the same
 * curve on both sides, and the shared-boundary guarantee survives fitting.
 *
 * Everything is deterministic and section-local (no context beyond a
 * section's own points crosses a breakpoint).
 */

export interface FitOptions {
  /** max fit error (px) before a section splits. */
  tolPx: number;
  /** corner detection: chord half-window (px) … */
  cornerWindowPx: number;
  /** … and the turn angle (deg) between back/forward chords that makes a corner. */
  cornerAngleDeg: number;
  /** chord length (px) when sampling fitted curves back to a polyline. */
  samplePx: number;
  /** indices of vertices that MUST be breakpoints (junctions). */
  forced?: boolean[];
}

type Cubic = [Point, Point, Point, Point];

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const len = (a: Point): number => Math.hypot(a.x, a.y);
const norm = (a: Point): Point => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

function bezierPoint(c: Cubic, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const cc = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + cc * c[2].x + d * c[3].x,
    y: a * c[0].y + b * c[1].y + cc * c[2].y + d * c[3].y,
  };
}

/** Q(t) and its first/second derivatives — for Newton reparameterization. */
function bezierDerivatives(c: Cubic, t: number): { q: Point; q1: Point; q2: Point } {
  const d1: [Point, Point, Point] = [
    scale(sub(c[1], c[0]), 3),
    scale(sub(c[2], c[1]), 3),
    scale(sub(c[3], c[2]), 3),
  ];
  const d2: [Point, Point] = [scale(sub(d1[1], d1[0]), 2), scale(sub(d1[2], d1[1]), 2)];
  const mt = 1 - t;
  return {
    q: bezierPoint(c, t),
    q1: add(add(scale(d1[0], mt * mt), scale(d1[1], 2 * mt * t)), scale(d1[2], t * t)),
    q2: add(scale(d2[0], mt), scale(d2[1], t)),
  };
}

function chordLengthParameterize(pts: Point[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) {
    u.push(u[u.length - 1] + len(sub(pts[i], pts[i - 1])));
  }
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

/** Least-squares placement of the two inner control points along the endpoint
 *  tangents (the heart of Schneider's algorithm). */
function generateBezier(
  pts: Point[],
  first: number,
  last: number,
  u: number[],
  tHat1: Point,
  tHat2: Point,
): Cubic {
  const p0 = pts[first];
  const p3 = pts[last];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i <= last - first; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const a1 = scale(tHat1, b1);
    const a2 = scale(tHat2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[first + i], {
      x: (b0 + b1) * p0.x + (b2 + b3) * p3.x,
      y: (b0 + b1) * p0.y + (b2 + b3) * p3.y,
    });
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1 = 0;
  let alpha2 = 0;
  if (Math.abs(det) > 1e-12) {
    alpha1 = (c11 * x0 - c01 * x1) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  }
  const segLen = len(sub(p3, p0));
  // Degenerate/negative alphas: fall back to the Wu/Barsky heuristic.
  if (alpha1 <= 1e-6 * segLen || alpha2 <= 1e-6 * segLen) {
    alpha1 = alpha2 = segLen / 3;
  }
  return [p0, add(p0, scale(tHat1, alpha1)), add(p3, scale(tHat2, alpha2)), p3];
}

function maxError(
  pts: Point[],
  first: number,
  last: number,
  c: Cubic,
  u: number[],
): { error: number; split: number } {
  let error = 0;
  let split = (first + last) >> 1;
  for (let i = first + 1; i < last; i++) {
    const d = len(sub(bezierPoint(c, u[i - first]), pts[i]));
    if (d * d > error) {
      error = d * d;
      split = i;
    }
  }
  return { error: Math.sqrt(error), split };
}

function reparameterize(pts: Point[], first: number, last: number, u: number[], c: Cubic): number[] {
  return u.map((t, i) => {
    const p = pts[first + i];
    const { q, q1, q2 } = bezierDerivatives(c, t);
    const num = dot(sub(q, p), q1);
    const den = dot(q1, q1) + dot(sub(q, p), q2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - num / den));
  });
}

/** Left tangent at `first` / right tangent at `last`, averaged over a few
 *  points so single-vertex jitter doesn't steer the fit. */
function tangent(pts: Point[], at: number, dir: 1 | -1): Point {
  const span = Math.min(4, dir === 1 ? pts.length - 1 - at : at);
  let acc = { x: 0, y: 0 };
  for (let k = 1; k <= Math.max(1, span); k++) {
    const j = at + dir * k;
    if (j < 0 || j >= pts.length) break;
    acc = add(acc, norm(sub(pts[j], pts[at])));
  }
  return norm(acc);
}

/** Schneider fit of pts[first..last] (inclusive); appends cubics to `out`. */
function fitCubic(
  pts: Point[],
  first: number,
  last: number,
  tHat1: Point,
  tHat2: Point,
  tolPx: number,
  out: Cubic[],
  depth = 0,
): void {
  if (last - first === 1) {
    const p0 = pts[first];
    const p3 = pts[last];
    const d = len(sub(p3, p0)) / 3;
    out.push([p0, add(p0, scale(tHat1, d)), add(p3, scale(tHat2, d)), p3]);
    return;
  }
  let u = chordLengthParameterize(pts, first, last);
  let c = generateBezier(pts, first, last, u, tHat1, tHat2);
  let { error, split } = maxError(pts, first, last, c, u);
  if (error <= tolPx) {
    out.push(c);
    return;
  }
  // Close: try Newton reparameterization a few times before splitting.
  if (error <= tolPx * 4) {
    for (let i = 0; i < 4; i++) {
      u = reparameterize(pts, first, last, u, c);
      c = generateBezier(pts, first, last, u, tHat1, tHat2);
      const m = maxError(pts, first, last, c, u);
      error = m.error;
      split = m.split;
      if (error <= tolPx) {
        out.push(c);
        return;
      }
    }
  }
  if (depth > 24) {
    out.push(c); // pathological — accept rather than recurse forever
    return;
  }
  // Split at the max-error point with a smooth center tangent.
  const center = norm(sub(pts[split - 1], pts[split + 1]));
  const tHatCenter = center;
  fitCubic(pts, first, split, tHat1, tHatCenter, tolPx, out, depth + 1);
  fitCubic(pts, split, last, scale(tHatCenter, -1), tHat2, tolPx, out, depth + 1);
}

/** Arc-length walk: index of the point ~`dist` along the ring from i (dir ±1). */
function walk(pts: Point[], i: number, dist: number, dir: 1 | -1): number {
  const n = pts.length;
  let acc = 0;
  let j = i;
  for (let steps = 0; steps < n && acc < dist; steps++) {
    const k = (j + dir + n) % n;
    acc += len(sub(pts[k], pts[j]));
    j = k;
  }
  return j;
}

/** Detect corners on a closed ring: turn angle between the back-chord and
 *  forward-chord over an arc-length window, local maxima above the threshold.
 *  Returns a sorted list of corner indices. */
export function detectCorners(
  pts: Point[],
  windowPx: number,
  angleDeg: number,
  forced?: boolean[],
): number[] {
  const n = pts.length;
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = walk(pts, i, windowPx, -1);
    const f = walk(pts, i, windowPx, 1);
    const back = norm(sub(pts[i], pts[b]));
    const fwd = norm(sub(pts[f], pts[i]));
    const cos = Math.min(1, Math.max(-1, dot(back, fwd)));
    turn[i] = (Math.acos(cos) * 180) / Math.PI;
  }
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (forced?.[i]) {
      corners.push(i);
      continue;
    }
    if (turn[i] < angleDeg) continue;
    // Local max within the window (ties broken toward the lower index so the
    // choice is deterministic and traversal-order independent).
    const b = walk(pts, i, windowPx, -1);
    const f = walk(pts, i, windowPx, 1);
    let isMax = true;
    for (let j = b; j !== (f + 1) % n; j = (j + 1) % n) {
      if (turn[j] > turn[i] || (turn[j] === turn[i] && j < i)) {
        if (j !== i) {
          isMax = false;
          break;
        }
      }
    }
    if (isMax) corners.push(i);
  }
  return [...new Set(corners)].sort((a, b) => a - b);
}

/** Sample the cubics of one fitted section back to a polyline (excluding the
 *  section's last point — sections are concatenated). */
function sampleCubics(cubics: Cubic[], samplePx: number): Point[] {
  const out: Point[] = [];
  for (const c of cubics) {
    const approxLen =
      len(sub(c[1], c[0])) + len(sub(c[2], c[1])) + len(sub(c[3], c[2]));
    const steps = Math.max(1, Math.ceil(approxLen / samplePx));
    for (let s = 0; s < steps; s++) out.push(bezierPoint(c, s / steps));
  }
  return out;
}

/** Least-squares line through points → (point, unit direction), or null. */
function fitLine(points: Point[]): { p: Point; d: Point } | null {
  if (points.length < 2) return null;
  const c = { x: 0, y: 0 };
  for (const p of points) {
    c.x += p.x;
    c.y += p.y;
  }
  c.x /= points.length;
  c.y /= points.length;
  let xx = 0, xy = 0, yy = 0;
  for (const p of points) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const tr = xx + yy;
  const det = xx * yy - xy * xy;
  const l = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const d = Math.abs(xy) > 1e-12 ? norm({ x: l - yy, y: xy }) : xx >= yy ? { x: 1, y: 0 } : { x: 0, y: 1 };
  return { p: c, d };
}

/**
 * Sharpen a corner: the measured corner vertex is biased by the corner's own
 * anti-aliasing (a corner pixel's coverage ramp is not an edge's), so replace
 * it with the INTERSECTION of straight fits to the points flanking it —
 * skipping the few points nearest the corner, which carry the bias. Clamped
 * so a genuinely-curved "corner" barely moves.
 */
function sharpenCorner(pts: Point[], ci: number, windowPx: number): Point {
  const n = pts.length;
  const side = (dir: 1 | -1): Point[] => {
    const out: Point[] = [];
    let acc = 0;
    let j = ci;
    for (let steps = 0; steps < n && acc < windowPx; steps++) {
      const k = (j + dir + n) % n;
      acc += len(sub(pts[k], pts[j]));
      j = k;
      if (acc >= 2) out.push(pts[j]); // skip the corner-polluted first ~2 px
    }
    return out;
  };
  const l1 = fitLine(side(-1));
  const l2 = fitLine(side(1));
  const orig = pts[ci];
  if (!l1 || !l2) return orig;
  const cross = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(cross) < 0.4) return orig; // near-parallel: not a sharp corner
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / cross;
  const ix = l1.p.x + l1.d.x * t;
  const iy = l1.p.y + l1.d.y * t;
  const d = Math.hypot(ix - orig.x, iy - orig.y);
  const MAX_SHARPEN_PX = 1.5;
  if (d > MAX_SHARPEN_PX) {
    const s = MAX_SHARPEN_PX / d;
    return { x: orig.x + (ix - orig.x) * s, y: orig.y + (iy - orig.y) * s };
  }
  return { x: ix, y: iy };
}

/**
 * Fit a closed ring: detect corners (plus forced junction breakpoints), fit
 * each corner-to-corner section with Schneider's algorithm, and return the
 * fitted curve resampled as a polyline. Detected corners are SHARPENED to the
 * intersection of their flanking straight fits (junction breakpoints stay
 * exactly put — every ring through them must agree); a ring with no corners is
 * split at two extremal points and fitted as two smooth halves.
 */
export function fitClosedPolyline(pts: Point[], opts: FitOptions): Point[] {
  const n = pts.length;
  if (n < 4) return pts.slice();
  let breaks = detectCorners(pts, opts.cornerWindowPx, opts.cornerAngleDeg, opts.forced);
  // Sharpen non-junction corners in place (before sections are cut, so both
  // adjacent sections see the corrected endpoint).
  if (breaks.length > 0) {
    const sharpened = breaks
      .filter((ci) => !opts.forced?.[ci])
      .map((ci) => [ci, sharpenCorner(pts, ci, opts.cornerWindowPx)] as const);
    if (sharpened.length > 0) {
      pts = pts.slice();
      for (const [ci, p] of sharpened) pts[ci] = p;
    }
  }
  if (breaks.length === 0) {
    // Smooth closed curve: break at the bottom-most point and its arc-length
    // antipode (deterministic, geometry-derived).
    let bi = 0;
    for (let i = 1; i < n; i++) {
      if (pts[i].y > pts[bi].y || (pts[i].y === pts[bi].y && pts[i].x < pts[bi].x)) bi = i;
    }
    breaks = [bi, (bi + (n >> 1)) % n].sort((a, b) => a - b);
  } else if (breaks.length === 1) {
    const only = breaks[0];
    breaks = [only, (only + (n >> 1)) % n].sort((a, b) => a - b);
  }

  const out: Point[] = [];
  for (let s = 0; s < breaks.length; s++) {
    const from = breaks[s];
    const to = breaks[(s + 1) % breaks.length];
    // Unroll the section into a linear array (closed ring).
    const sec: Point[] = [];
    for (let i = from; ; i = (i + 1) % n) {
      sec.push(pts[i]);
      if (i === to) break;
    }
    if (sec.length < 2) continue;
    const cubics: Cubic[] = [];
    fitCubic(
      sec,
      0,
      sec.length - 1,
      tangent(sec, 0, 1),
      tangent(sec, sec.length - 1, -1),
      opts.tolPx,
      cubics,
    );
    out.push(...sampleCubics(cubics, opts.samplePx));
  }
  return out;
}
