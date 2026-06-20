import type { Path, Project } from "../../types/project";
import { resolveParams } from "../../types/project";
import { distance } from "../geometry";
import { polygonArea } from "../trace/classify";
import { resampleByCount } from "./resample";
import { SATIN_MAX_WIDTH } from "./satin";
import { countStitches, type EngineStitch } from "./index";

/** Machine / quality limits used for validation warnings. */
export const LIMITS = {
  minStitch: 0.25, // mm — below this the needle re-punches a hole (skip/jam).
  // Note: satin and dense fills legitimately run ~0.3–0.4 mm rows, which is NOT a
  // skip risk; only a near-same-hole (< 0.25 mm) punch is. The engine already
  // floors stitches at 0.3 mm, so this warns only if something truly tiny slips in.
  maxStitch: 12, // mm — above this stitches are loose and snag
  minDensity: 0.3, // mm/row — denser than this risks puckering
  maxStitchCount: 25000,
  maxSatinWidth: SATIN_MAX_WIDTH, // mm — wider satin sews loose; use a fill
  largeFillAreaMm2: 200, // mm² — a fill this big really wants underlay
};

export interface Warning {
  level: "warn";
  message: string;
  /** The object at fault, when one can be pinpointed — lets the UI select it on
   *  click. Omitted for design-wide warnings (e.g. total stitch count). */
  objectId?: string;
}

/** Mean rail-to-rail width (mm) of a satin object's two rails. */
function meanSatinWidthMm(paths: Path[]): number {
  const [left, right] = paths;
  if (!left || !right || left.length < 2 || right.length < 2) return 0;
  const n = Math.max(left.length, right.length);
  const l = resampleByCount(left, n);
  const r = resampleByCount(right, n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += distance(l[i], r[i]);
  return sum / n;
}

/**
 * Non-blocking quality checks (Section 6). These never stop an export — they
 * just tell the user where a design might pucker, run off the hoop, or stress
 * the machine, so they can decide.
 */
export function validateDesign(design: EngineStitch[], project: Project): Warning[] {
  const warnings: Warning[] = [];

  // Stitch lengths between consecutive penetrations of the same object. Track the
  // first offender of each kind so the warning can jump straight to it.
  let tooShort = 0;
  let tooLong = 0;
  let shortId: string | undefined;
  let longId: string | undefined;
  for (let i = 1; i < design.length; i++) {
    const a = design[i - 1];
    const b = design[i];
    if (b.jump || a.objectId !== b.objectId) continue;
    const d = distance(a, b);
    if (d > 0 && d < LIMITS.minStitch) {
      tooShort++;
      shortId ??= b.objectId;
    } else if (d > LIMITS.maxStitch) {
      tooLong++;
      longId ??= b.objectId;
    }
  }
  if (tooShort > 0)
    warnings.push({
      level: "warn",
      objectId: shortId,
      message: `${tooShort} stitch${tooShort === 1 ? "" : "es"} shorter than ${LIMITS.minStitch} mm (machine may skip).`,
    });
  if (tooLong > 0)
    warnings.push({
      level: "warn",
      objectId: longId,
      message: `${tooLong} stitch${tooLong === 1 ? "" : "es"} longer than ${LIMITS.maxStitch} mm (may snag).`,
    });

  // Penetrations outside the hoop.
  const outsideStitches = design.filter(
    (s) => !s.jump && (s.x < 0 || s.y < 0 || s.x > project.hoop.wMm || s.y > project.hoop.hMm),
  );
  if (outsideStitches.length > 0)
    warnings.push({
      level: "warn",
      objectId: outsideStitches[0].objectId,
      message: `${outsideStitches.length} stitch${outsideStitches.length === 1 ? "" : "es"} fall outside the ${project.hoop.name} hoop.`,
    });

  // Per-object density that risks puckering.
  for (const o of project.objects) {
    if (o.type === "running") continue;
    const { density } = resolveParams(o.type, o.params);
    if (density < LIMITS.minDensity) {
      warnings.push({
        level: "warn",
        objectId: o.id,
        message: `"${o.name}" density ${density.toFixed(2)} mm is very high — puckering risk.`,
      });
    }
  }

  // A satin column wider than a single throw can span sews loose and floats —
  // past this it should really be a fill (the engine splits it, but warn anyway).
  for (const o of project.objects) {
    if (o.type !== "satin") continue;
    const width = meanSatinWidthMm(o.paths);
    if (width > LIMITS.maxSatinWidth) {
      warnings.push({
        level: "warn",
        objectId: o.id,
        message: `"${o.name}" satin column is ${width.toFixed(1)} mm wide — wider than ${LIMITS.maxSatinWidth} mm sews loose; consider a fill.`,
      });
    }
  }

  // A large fill with underlay turned off tends to pucker and sits flat (no loft).
  for (const o of project.objects) {
    if (o.type !== "fill" && o.type !== "satin") continue;
    const params = resolveParams(o.type, o.params);
    if (params.underlay) continue; // underlay on — fine
    const outer = o.paths[0];
    const area = outer && outer.length >= 3 ? polygonArea(outer) : 0;
    if (area > LIMITS.largeFillAreaMm2) {
      warnings.push({
        level: "warn",
        objectId: o.id,
        message: `"${o.name}" is a large fill with underlay off — may pucker and sit flat. Turn underlay on.`,
      });
    }
  }

  // Overall stitch count.
  const total = countStitches(design);
  if (total > LIMITS.maxStitchCount)
    warnings.push({
      level: "warn",
      message: `${total.toLocaleString()} stitches is a lot — long run time and thread use.`,
    });

  return warnings;
}
