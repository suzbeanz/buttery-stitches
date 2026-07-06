import type { Path, Point } from "../../types/project";
import { resampleByDistance } from "./resample";
import { distance } from "../geometry";

/**
 * Running stitch: walk the path placing a needle penetration every
 * `stitchLength` mm — SHORTENING the stitch where the path curves, the way the
 * professional references sew every curved outline. A fixed pitch chords across
 * a curve and reads faceted; the hand-digitized rule is geometric: keep each
 * chord's SAGITTA (its bow off the true curve) under a visual tolerance, so the
 * local pitch is √(8·R·e) for curvature radius R. Straight runs are untouched
 * (R → ∞ ⇒ full pitch), and every stitch still lands exactly on the final
 * vertex and on hard corners (resampleByDistance's corner rule).
 */

/** Max chord sagitta (mm) a stitch may bow off a curve — the smoothness the
 *  reference outlines hold. */
const CURVE_SAGITTA_MM = 0.07;
/** Never shorten below this (mm): curve packing must stay above the jam floor. */
const CURVE_MIN_PITCH_MM = 0.8;

export function runningStitch(path: Path, stitchLength: number): Path {
  if (path.length < 2) return path.map((p) => ({ ...p }));

  // Fine pass: sample well below the target pitch so local curvature is
  // measurable, then walk it placing penetrations at the curvature-scaled pitch.
  const fineStep = Math.max(0.25, Math.min(stitchLength / 4, 0.6));
  const fine = resampleByDistance(path, fineStep);
  if (fine.length < 3) return resampleByDistance(path, stitchLength);

  // Turn (rad) across fine vertex i, and the curvature-scaled pitch there.
  const turnAt = (i: number): number => {
    if (i <= 0 || i >= fine.length - 1) return 0;
    const a = fine[i - 1];
    const b = fine[i];
    const c = fine[i + 1];
    const l1 = distance(a, b);
    const l2 = distance(b, c);
    if (l1 < 1e-9 || l2 < 1e-9) return 0;
    const cos = Math.max(
      -1,
      Math.min(1, ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (l1 * l2)),
    );
    return Math.acos(cos);
  };
  const pitchAt = (i: number): number => {
    const dTheta = turnAt(i);
    if (dTheta < 1e-4) return stitchLength;
    const a = fine[i - 1];
    const b = fine[i];
    const c = fine[i + 1];
    const R = ((distance(a, b) + distance(b, c)) / 2) / dTheta;
    const pitch = Math.sqrt(8 * R * CURVE_SAGITTA_MM);
    return Math.max(CURVE_MIN_PITCH_MM, Math.min(stitchLength, pitch));
  };
  const CORNER_RAD = (28 * Math.PI) / 180; // resampleByDistance's hard-corner rule

  // Walk the fine polyline placing penetrations by EXACT interpolation at the
  // locally-evaluated pitch (never at fine vertices, which would overshoot the
  // pitch by up to a fine step and break the ≤ stitchLength invariant).
  const out: Point[] = [{ ...fine[0] }];
  let need = pitchAt(1);
  for (let i = 1; i < fine.length; i++) {
    const a = fine[i - 1];
    const b = fine[i];
    const segLen = distance(a, b);
    if (segLen < 1e-9) continue;
    const dx = (b.x - a.x) / segLen;
    const dy = (b.y - a.y) / segLen;
    let off = 0;
    while (need <= segLen - off + 1e-9) {
      off += need;
      out.push({ x: a.x + dx * off, y: a.y + dy * off });
      need = pitchAt(i);
    }
    need -= segLen - off;
    // A hard corner always gets its own penetration (crisp turn, no chord cut);
    // spacing restarts there, exactly like resampleByDistance.
    if (i < fine.length - 1 && turnAt(i) >= CORNER_RAD) {
      if (distance(out[out.length - 1], b) > 1e-9) out.push({ ...b });
      need = pitchAt(i + 1);
    }
  }
  // Always finish exactly on the last vertex.
  const last = fine[fine.length - 1];
  if (distance(out[out.length - 1], last) > 1e-6) out.push({ ...last });
  return out;
}
