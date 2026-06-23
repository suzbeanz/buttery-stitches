import type { EmbObject, Path, Point } from "../../types/project";
import { polygonArea } from "./classify";
import { recognizeShape } from "./recognize";

/**
 * Design-level idealization — the "smart" half of Image-Trace-grade tracing. After
 * each ring is individually cleaned (primitives snapped, edges straightened), this
 * pass looks ACROSS a shape's rings to recover the artwork's mathematical structure:
 *
 *  • Even/uniform repeats: a row of congruent, evenly-spaced shapes (a ladder's rungs,
 *    a grille) is snapped to ONE canonical shape at a single regular pitch — so the
 *    rungs come out identical and evenly spaced, the way they were drawn, instead of
 *    eight slightly-different traced blobs.
 *
 * Pure and deterministic. STRICT detection gates keep it from ever "regularizing" a
 * set of unrelated shapes (an early loose version scattered boxes across the design —
 * a false positive is far worse than a missed repeat), so it is a safe no-op on
 * anything that isn't a genuine regular row.
 */

const centroid = (r: Path): Point => {
  let x = 0, y = 0;
  for (const p of r) { x += p.x; y += p.y; }
  return { x: x / r.length, y: y / r.length };
};
const ringArea = (r: Path) => Math.abs(polygonArea(r));
const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1] ?? 0; };

/** Oriented bounding box of a ring: principal-axis angle + half-extents. */
function orientedBox(r: Path): { c: Point; rot: number; a: number; b: number } {
  const c = centroid(r);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of r) { const dx = p.x - c.x, dy = p.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cs = Math.cos(-rot), sn = Math.sin(-rot);
  let a = 0, b = 0;
  for (const p of r) { const dx = p.x - c.x, dy = p.y - c.y; a = Math.max(a, Math.abs(dx * cs - dy * sn)); b = Math.max(b, Math.abs(dx * sn + dy * cs)); }
  return { c, rot, a, b };
}

function makeRect(c: Point, hw: number, hh: number, rot: number): Path {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const).map(([x, y]) => ({ x: c.x + x * cs - y * sn, y: c.y + x * sn + y * cs }));
}

/** Angles within 15° (mod π, since a box has 180° symmetry). */
function angleClose(a: number, b: number): boolean {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d < (15 * Math.PI) / 180;
}

/**
 * Find and regularize the largest LINEAR REPEAT among a set of rings. Returns the new
 * rings (others untouched) and how many were regularized (0 = nothing qualified).
 *
 * Gates (all required): ≥5 congruent members (half-extents within 28 %, orientation
 * within 15°), tightly collinear centroids (perpendicular spread < 0.6·height), and an
 * already-roughly-even pitch (CV < 0.3). The detected row is then EXTENDED along its
 * fitted line+pitch to capture end members the congruence gate missed, and every
 * member is replaced by a canonical median rectangle at an exact even pitch.
 */
export function regularizeRepeats(rings: Path[]): { rings: Path[]; count: number } {
  const items = rings
    .map((r, i) => ({ i, r, c: centroid(r), A: ringArea(r), box: orientedBox(r) }))
    .filter((it) => it.A > 0.5);

  let best: typeof items = [];
  for (const seed of items) {
    const grp = items.filter((it) =>
      Math.abs(it.box.a - seed.box.a) / seed.box.a < 0.28 &&
      Math.abs(it.box.b - seed.box.b) / seed.box.b < 0.28 &&
      angleClose(it.box.rot, seed.box.rot));
    if (grp.length < 5) continue;
    const cc = centroidOf(grp.map((g) => g.c));
    const { dir, nrm } = principalDir(grp.map((g) => g.c), cc);
    const perp = grp.map((g) => Math.abs((g.c.x - cc.x) * nrm.x + (g.c.y - cc.y) * nrm.y));
    const medH = median(grp.map((g) => g.box.b));
    if (Math.max(...perp) > medH * 0.6) continue; // not on a tight line
    const along = grp.map((g) => (g.c.x - cc.x) * dir.x + (g.c.y - cc.y) * dir.y).sort((a, b) => a - b);
    const pitches = along.slice(1).map((t, k) => t - along[k]);
    const mp = pitches.reduce((s, p) => s + p, 0) / pitches.length;
    if (mp <= 0) continue;
    const cv = Math.sqrt(pitches.reduce((s, p) => s + (p - mp) ** 2, 0) / pitches.length) / mp;
    if (cv > 0.3) continue; // spacing not regular → not a clean repeat
    if (grp.length > best.length) best = grp;
  }
  if (best.length < 5) return { rings, count: 0 };

  const cc = centroidOf(best.map((g) => g.c));
  const { dir, nrm } = principalDir(best.map((g) => g.c), cc);
  const proj = (p: Point) => (p.x - cc.x) * dir.x + (p.y - cc.y) * dir.y;
  const ts = best.map((g) => proj(g.c)).sort((a, b) => a - b);
  const pitch = median(ts.slice(1).map((t, k) => t - ts[k]));
  if (pitch <= 0) return { rings, count: 0 };
  const t0 = ts[0], tEnd = ts[ts.length - 1];
  // Orient the canonical shape to the ROW's own frame (along `dir`, across `nrm`), not
  // each member's noisy principal axis — a near-square gap has a degenerate principal
  // angle that would tilt every rung into a diamond. Measure each member's extent in
  // that frame and take the medians.
  const rot = Math.atan2(dir.y, dir.x);
  const extentsOf = (r: Path) => {
    let aMin = Infinity, aMax = -Infinity, nMin = Infinity, nMax = -Infinity;
    for (const v of r) {
      const al = (v.x - cc.x) * dir.x + (v.y - cc.y) * dir.y;
      const pe = (v.x - cc.x) * nrm.x + (v.y - cc.y) * nrm.y;
      if (al < aMin) aMin = al; if (al > aMax) aMax = al;
      if (pe < nMin) nMin = pe; if (pe > nMax) nMax = pe;
    }
    return { hw: (aMax - aMin) / 2, hh: (nMax - nMin) / 2 };
  };
  const hw = median(best.map((g) => extentsOf(g.r).hw));
  const hh = median(best.map((g) => extentsOf(g.r).hh));
  const medH = hh * 2;

  // Extend the row: any ring collinear with the line and on a grid slot (within the
  // span ± 1.5 pitch) joins, even if its traced size was a bit off (catches end rungs).
  // One member per grid slot, nearest wins.
  const bySlot = new Map<number, { i: number; resid: number }>();
  for (const it of items) {
    const t = proj(it.c), perp = Math.abs((it.c.x - cc.x) * nrm.x + (it.c.y - cc.y) * nrm.y);
    if (perp > medH * 0.7) continue;
    if (t < t0 - 1.5 * pitch || t > tEnd + 1.5 * pitch) continue;
    const k = Math.round((t - t0) / pitch), resid = Math.abs(t - (t0 + k * pitch));
    if (resid > 0.32 * pitch) continue;
    const prev = bySlot.get(k);
    if (!prev || resid < prev.resid) bySlot.set(k, { i: it.i, resid });
  }
  if (bySlot.size < 5) return { rings, count: 0 };

  const out = rings.slice();
  for (const [k, { i }] of bySlot) {
    const t = t0 + k * pitch;
    out[i] = makeRect({ x: cc.x + dir.x * t, y: cc.y + dir.y * t }, hw, hh, rot);
  }
  return { rings: out, count: bySlot.size };
}

function centroidOf(pts: Point[]): Point {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

/** Principal direction (and its normal) of a point set about a centre. */
function principalDir(pts: Point[], c: Point): { dir: Point; nrm: Point } {
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - c.x, dy = p.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { dir: { x: Math.cos(ang), y: Math.sin(ang) }, nrm: { x: -Math.sin(ang), y: Math.cos(ang) } };
}

function makeCircle(c: Point, r: number, n = 64): Path {
  const out: Path = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
  return out;
}

/**
 * Congruence/symmetry: across ALL rings, find circles whose radii are near-equal
 * (within 12 %) and snap each such group to its median radius — so a design's paired
 * elements (a vehicle's two wheels, two hub-caps) come out truly IDENTICAL rather than
 * each independently round. Centres are kept; only the radius is unified. A lone circle
 * (no congruent partner) and circles of clearly different size are left untouched.
 */
export function unifyCircles(objects: EmbObject[]): EmbObject[] {
  const found: { oi: number; ri: number; c: Point; r: number }[] = [];
  objects.forEach((o, oi) =>
    o.paths.forEach((ring, ri) => {
      const rec = recognizeShape(ring, 1.0);
      if (rec && rec.kind === "circle") {
        const c = centroidOf(rec.ring);
        found.push({ oi, ri, c, r: Math.hypot(rec.ring[0].x - c.x, rec.ring[0].y - c.y) });
      }
    }),
  );
  if (found.length < 2) return objects;
  // cluster by ascending radius; compare to the cluster's SMALLEST member so the whole
  // cluster stays within 12 % (no "chaining" a gradient of sizes into one group).
  const sorted = [...found].sort((a, b) => a.r - b.r);
  const clusters: (typeof found)[] = [];
  for (const f of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && f.r <= last[0].r * 1.12) last.push(f);
    else clusters.push([f]);
  }
  const paths = objects.map((o) => o.paths.slice());
  let changed = false;
  for (const cl of clusters) {
    if (cl.length < 2) continue;
    const R = median(cl.map((f) => f.r));
    for (const f of cl) { paths[f.oi][f.ri] = makeCircle(f.c, R); changed = true; }
  }
  return changed ? objects.map((o, oi) => ({ ...o, paths: paths[oi] })) : objects;
}

/** Apply the design-level idealizations to traced objects: even/uniform repeats, then
 *  unify congruent circles (identical wheels/hubs). */
export function idealizeDesign(objects: EmbObject[]): EmbObject[] {
  const regularized = objects.map((o) => {
    const reg = regularizeRepeats(o.paths);
    return reg.count ? { ...o, paths: reg.rings } : o;
  });
  return unifyCircles(regularized);
}
