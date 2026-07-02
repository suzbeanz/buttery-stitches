import type { Point } from "../../types/project";
import type { EngineStitch } from "../engine";

/**
 * FABRIC-PULL SIMULATION + PREDICTIVE COMPENSATION (slices 1–2 of
 * "simulation-in-the-loop").
 *
 * Embroidery thread is laid under tension: each stitch pulls its two penetrations
 * toward each other, gathering the fabric, so the sewn shape ends up DISTORTED from
 * what was digitized — a satin column narrows across its throws, a fill pulls in
 * along its rows. This is exactly why digitizers add "pull compensation"; here we
 * PREDICT it (and then cancel it) instead of guessing.
 *
 * Model: the penetrations are nodes of a mass-spring network. Every stitch is a
 * spring whose REST length is a touch under its drawn length (PULL_STRAIN = the
 * thread's contraction), so taut thread pulls the nodes together. The fabric +
 * backing is a weak anchor pulling each node back toward where the needle placed
 * it (BACKING). Relaxing to equilibrium (position-based, Gauss-Seidel) gives the
 * LANDED positions; the displacement from the placed positions is the distortion.
 *
 * First-order: it captures the dominant ALONG-stitch pull (satin narrowing, row
 * end pull-in). Cross-stitch fabric gathering (a 2D mesh) is a later slice. The
 * two constants are calibratable from a test sew-out.
 *
 * CALIBRATED against a physical sew-out (July 2026): the quality-calibration
 * swatch — tatami squares 10/20/30 mm, circles 15/25 mm, a 40 mm run line, and
 * satin STITCH lettering at 12/8 mm — sewn on hooped woven cotton at 40 wt
 * measured DEAD-ON nominal in both axes (±0.5 mm ruler resolution), with letter
 * terminals at full density. The engine's built-in allowances already cancel net
 * pull on the woven profile, so PREDICTIVE COMPENSATION STAYS OFF there: this
 * model remains a bench/visualization metric. Re-calibrate on stretch knits or
 * fleece before wiring compensation into the pipeline for those profiles.
 */

/** Thread contraction: a stitch's rest length is (1 − strain) × its drawn length. */
export const PULL_STRAIN = 0.06;
/** Fabric/backing stiffness: per-iteration fraction a node is pulled back toward
 *  its placed (anchor) position. Higher = stiffer fabric = less distortion. */
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

type Spring = { a: number; b: number; rest: number };
interface Network {
  /** placed (digitized target) position per fabric node. */
  nodes: Point[];
  springs: Spring[];
}

/** Merge near-coincident penetrations into shared fabric nodes and make a spring
 *  (rest length PULL_STRAIN under the drawn length) per consecutive same-colour
 *  stitch. */
function buildNetwork(design: EngineStitch[]): Network {
  const cell = NODE_MERGE_MM;
  const key = (x: number, y: number) => `${Math.round(x / cell)},${Math.round(y / cell)}`;
  const nodeOf = new Map<string, number>();
  const nodes: Point[] = [];
  const nodeIndex = (p: Point): number => {
    const k = key(p.x, p.y);
    let i = nodeOf.get(k);
    if (i === undefined) { i = nodes.length; nodeOf.set(k, i); nodes.push({ x: p.x, y: p.y }); }
    return i;
  };
  const springs: Spring[] = [];
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
  return { nodes, springs };
}

/** Relax the network to equilibrium: spring distance constraints toward each rest
 *  length, plus a backing pull of every node toward its `anchor` (where the needle
 *  placed it). `start` is the initial guess. Returns the landed positions. */
function relax(start: Point[], anchorX: Float64Array, anchorY: Float64Array, springs: Spring[]): { x: Float64Array; y: Float64Array } {
  const n = start.length;
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) { px[i] = start[i].x; py[i] = start[i].y; }
  for (let it = 0; it < RELAX_ITERS; it++) {
    for (const sp of springs) {
      const dx = px[sp.b] - px[sp.a], dy = py[sp.b] - py[sp.a];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const diff = (len - sp.rest) / len; // >0 ⇒ stretched ⇒ contract
      const ox = 0.5 * diff * dx, oy = 0.5 * diff * dy;
      px[sp.a] += ox; py[sp.a] += oy;
      px[sp.b] -= ox; py[sp.b] -= oy;
    }
    for (let i = 0; i < n; i++) {
      px[i] += BACKING * (anchorX[i] - px[i]);
      py[i] += BACKING * (anchorY[i] - py[i]);
    }
  }
  return { x: px, y: py };
}

/** Predict the fabric pull for a compiled stitch stream. Pure; deterministic. */
export function simulateDistortion(design: EngineStitch[]): DistortionResult {
  const { nodes, springs } = buildNetwork(design);
  const n = nodes.length;
  if (n === 0 || springs.length === 0) return { meanMm: 0, maxMm: 0, pullInMm: 0 };
  const ax = new Float64Array(n), ay = new Float64Array(n);
  for (let i = 0; i < n; i++) { ax[i] = nodes[i].x; ay[i] = nodes[i].y; }
  const { x: px, y: py } = relax(nodes, ax, ay, springs);

  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += nodes[i].x; cy += nodes[i].y; }
  cx /= n; cy /= n;
  let sum = 0, max = 0, pullIn = 0;
  for (let i = 0; i < n; i++) {
    const dx = px[i] - nodes[i].x, dy = py[i] - nodes[i].y;
    const d = Math.hypot(dx, dy);
    sum += d; if (d > max) max = d;
    const txx = cx - nodes[i].x, tyy = cy - nodes[i].y, tl = Math.hypot(txx, tyy);
    if (tl > 1e-6) pullIn += (dx * txx + dy * tyy) / tl;
  }
  return { meanMm: sum / n, maxMm: max, pullInMm: pullIn / n };
}

export interface PrecompResult {
  /** mean landed-vs-target error placing AT the target (mm) — the raw pull. */
  beforeMm: number;
  /** mean landed-vs-target error after pre-compensation (mm) — should be ≈ 0. */
  afterMm: number;
  /** digitized target position per fabric node (parallel to `placed`). */
  target: Point[];
  /** the placed (pre-warped) node positions that sew to the target. */
  placed: Point[];
}

/**
 * PREDICTIVE pull compensation: find PLACED penetration positions whose simulated
 * landing equals the digitized TARGET. An iterated-simulation fixed point —
 * placed ← placed + (target − simulate(placed)) — which converges because the pull
 * map is contractive for realistic tension. Reports the landed-vs-target error
 * before (the raw pull) and after (≈0), so the benefit is measured, not assumed.
 * The returned `placed` positions are the pre-warped geometry the engine would sew.
 */
export function precompensate(design: EngineStitch[], iters = 6): PrecompResult {
  const { nodes: target, springs } = buildNetwork(design);
  const n = target.length;
  if (n === 0 || springs.length === 0) return { beforeMm: 0, afterMm: 0, target, placed: target };
  const tx = new Float64Array(n), ty = new Float64Array(n);
  for (let i = 0; i < n; i++) { tx[i] = target[i].x; ty[i] = target[i].y; }

  // Forward landing of a placed configuration (anchor = where the needle goes).
  const land = (placed: Point[]) => {
    const ax = new Float64Array(n), ay = new Float64Array(n);
    for (let i = 0; i < n; i++) { ax[i] = placed[i].x; ay[i] = placed[i].y; }
    return relax(placed, ax, ay, springs);
  };
  const errorVs = (lx: Float64Array, ly: Float64Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.hypot(lx[i] - tx[i], ly[i] - ty[i]);
    return s / n;
  };

  const land0 = land(target);
  const beforeMm = errorVs(land0.x, land0.y);

  let placed = target.map((p) => ({ x: p.x, y: p.y }));
  for (let k = 0; k < iters; k++) {
    const { x: lx, y: ly } = land(placed);
    placed = placed.map((p, i) => ({ x: p.x + (tx[i] - lx[i]), y: p.y + (ty[i] - ly[i]) }));
  }
  const landF = land(placed);
  return { beforeMm, afterMm: errorVs(landF.x, landF.y), target, placed };
}

/**
 * Produce the EXPORTABLE pre-compensated stitch stream: shift every stitch (real
 * penetrations, and the jumps/ties/trims that ride with them) by the correction of
 * its nearest fabric node, so the sewn-out result lands on the digitized intent.
 * This is what an engine would emit once predictive compensation is enabled.
 *
 * NOTE: the model constants (PULL_STRAIN, BACKING) are physically plausible but not
 * yet CALIBRATED to a real sew-out, so this is provided as the proven pipeline /
 * opt-in path — turning it on by default should wait on calibration and on
 * reconciling with the engine's existing heuristic pullComp (don't double-count).
 */
export function applyPrecompensation(design: EngineStitch[], iters = 6): EngineStitch[] {
  const { target, placed } = precompensate(design, iters);
  if (target.length === 0) return design;
  // Correction field, indexed by the same NODE_MERGE_MM grid buildNetwork used.
  const cell = NODE_MERGE_MM;
  const cellKey = (x: number, y: number) => `${Math.round(x / cell)},${Math.round(y / cell)}`;
  const idxAt = new Map<string, number>();
  target.forEach((t, i) => idxAt.set(cellKey(t.x, t.y), i));
  const nearest = (x: number, y: number): number => {
    const bx = Math.round(x / cell), by = Math.round(y / cell);
    let best = -1, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const i = idxAt.get(`${bx + dx},${by + dy}`);
        if (i !== undefined) {
          const d = Math.hypot(target[i].x - x, target[i].y - y);
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best;
  };
  return design.map((s) => {
    const i = nearest(s.x, s.y);
    if (i < 0) return s;
    return { ...s, x: s.x + (placed[i].x - target[i].x), y: s.y + (placed[i].y - target[i].y) };
  });
}
