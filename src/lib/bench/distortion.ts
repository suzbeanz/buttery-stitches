import type { Point } from "../../types/project";
import type { EngineStitch } from "../engine";

/**
 * FABRIC-PULL SIMULATION (first slice of "simulation-in-the-loop").
 *
 * Embroidery thread is laid under tension: each stitch pulls its two penetrations
 * toward each other, gathering the fabric, so the sewn shape ends up DISTORTED from
 * what was digitized — a satin column narrows across its throws, a fill pulls in
 * along its rows. This is exactly why digitizers add "pull compensation"; here we
 * PREDICT it instead of guessing.
 *
 * Model: the penetrations are nodes of a mass-spring network. Every stitch is a
 * spring whose REST length is a touch under its drawn length (PULL_STRAIN = the
 * thread's contraction), so taut thread pulls the nodes together. The fabric +
 * backing is a weak anchor pulling each node back toward where it was placed
 * (BACKING). Relaxing to equilibrium (position-based, Gauss-Seidel) gives the
 * landed positions; the displacement from the placed positions is the distortion.
 *
 * First-order: it captures the dominant ALONG-stitch pull (satin narrowing, row
 * end pull-in). Cross-stitch fabric gathering (a 2D mesh) is a later slice. The
 * two constants are calibratable from a test sew-out. Output feeds a metric now;
 * next slice pre-distorts the geometry to cancel the predicted pull.
 */

/** Thread contraction: a stitch's rest length is (1 − strain) × its drawn length. */
export const PULL_STRAIN = 0.06;
/** Fabric/backing stiffness: per-iteration fraction a node is pulled back toward
 *  its placed position. Higher = stiffer fabric = less distortion. */
export const BACKING = 0.08;
/** Relaxation iterations (equilibrium of a few-thousand-node network is cheap). */
export const RELAX_ITERS = 80;
/** Penetrations closer than this (mm) are the same fabric node (ties, overlaps). */
export const NODE_MERGE_MM = 0.3;

export interface DistortionResult {
  /** mean displacement of a penetration from where it was placed (mm). */
  meanMm: number;
  /** worst single displacement (mm). */
  maxMm: number;
  /** mean displacement projected toward the design centroid — the net "pull-in"
   *  (mm). Positive = the shape gathers inward (the usual case). */
  pullInMm: number;
}

function isReal(s: EngineStitch): boolean {
  return !s.jump && !s.trim && !s.stop;
}

/**
 * Predict the fabric pull for a compiled stitch stream. Pure; deterministic.
 */
export function simulateDistortion(design: EngineStitch[]): DistortionResult {
  // Merge near-coincident penetrations into shared nodes (a spatial hash on a
  // NODE_MERGE_MM grid). Each real penetration maps to a node index.
  const cell = NODE_MERGE_MM;
  const key = (x: number, y: number) => `${Math.round(x / cell)},${Math.round(y / cell)}`;
  const nodeOf = new Map<string, number>();
  const orig: Point[] = [];
  const nodeIndex = (p: Point): number => {
    const k = key(p.x, p.y);
    let i = nodeOf.get(k);
    if (i === undefined) {
      i = orig.length;
      nodeOf.set(k, i);
      orig.push({ x: p.x, y: p.y });
    }
    return i;
  };

  // Springs from consecutive real same-colour penetrations.
  const springs: { a: number; b: number; rest: number }[] = [];
  let prev: EngineStitch | null = null;
  for (const s of design) {
    if (isReal(s)) {
      const ni = nodeIndex(s);
      if (prev && isReal(prev) && prev.colorId === s.colorId) {
        const a = nodeIndex(prev);
        if (a !== ni) {
          const L = Math.hypot(s.x - prev.x, s.y - prev.y);
          springs.push({ a, b: ni, rest: L * (1 - PULL_STRAIN) });
        }
      }
    }
    prev = s;
  }
  const n = orig.length;
  if (n === 0 || springs.length === 0) return { meanMm: 0, maxMm: 0, pullInMm: 0 };

  // Relax: position-based distance constraints toward each spring's rest length,
  // plus a backing pull toward the placed position.
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) { px[i] = orig[i].x; py[i] = orig[i].y; }
  for (let it = 0; it < RELAX_ITERS; it++) {
    for (const sp of springs) {
      const dx = px[sp.b] - px[sp.a];
      const dy = py[sp.b] - py[sp.a];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const diff = (len - sp.rest) / len; // >0 ⇒ stretched ⇒ contract
      const ox = 0.5 * diff * dx;
      const oy = 0.5 * diff * dy;
      px[sp.a] += ox; py[sp.a] += oy;
      px[sp.b] -= ox; py[sp.b] -= oy;
    }
    for (let i = 0; i < n; i++) {
      px[i] += BACKING * (orig[i].x - px[i]);
      py[i] += BACKING * (orig[i].y - py[i]);
    }
  }

  // Centroid for the inward projection.
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += orig[i].x; cy += orig[i].y; }
  cx /= n; cy /= n;

  let sum = 0, max = 0, pullIn = 0;
  for (let i = 0; i < n; i++) {
    const dx = px[i] - orig[i].x;
    const dy = py[i] - orig[i].y;
    const d = Math.hypot(dx, dy);
    sum += d;
    if (d > max) max = d;
    // inward = toward centroid
    const tx = cx - orig[i].x, ty = cy - orig[i].y;
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-6) pullIn += (dx * tx + dy * ty) / tl;
  }
  return { meanMm: sum / n, maxMm: max, pullInMm: pullIn / n };
}
