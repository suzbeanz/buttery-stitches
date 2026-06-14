import type { Project } from "../../types/project";
import { resolveParams } from "../../types/project";
import { distance } from "../geometry";
import { countStitches, type EngineStitch } from "./index";

/** Machine / quality limits used for validation warnings. */
export const LIMITS = {
  minStitch: 0.5, // mm — below this the machine may skip or jam
  maxStitch: 12, // mm — above this stitches are loose and snag
  minDensity: 0.3, // mm/row — denser than this risks puckering
  maxStitchCount: 25000,
};

export interface Warning {
  level: "warn";
  message: string;
}

/**
 * Non-blocking quality checks (Section 6). These never stop an export — they
 * just tell the user where a design might pucker, run off the hoop, or stress
 * the machine, so they can decide.
 */
export function validateDesign(design: EngineStitch[], project: Project): Warning[] {
  const warnings: Warning[] = [];

  // Stitch lengths between consecutive penetrations of the same object.
  let tooShort = 0;
  let tooLong = 0;
  for (let i = 1; i < design.length; i++) {
    const a = design[i - 1];
    const b = design[i];
    if (b.jump || a.objectId !== b.objectId) continue;
    const d = distance(a, b);
    if (d > 0 && d < LIMITS.minStitch) tooShort++;
    else if (d > LIMITS.maxStitch) tooLong++;
  }
  if (tooShort > 0)
    warnings.push({
      level: "warn",
      message: `${tooShort} stitch${tooShort === 1 ? "" : "es"} shorter than ${LIMITS.minStitch} mm (machine may skip).`,
    });
  if (tooLong > 0)
    warnings.push({
      level: "warn",
      message: `${tooLong} stitch${tooLong === 1 ? "" : "es"} longer than ${LIMITS.maxStitch} mm (may snag).`,
    });

  // Penetrations outside the hoop.
  const outside = design.filter(
    (s) => !s.jump && (s.x < 0 || s.y < 0 || s.x > project.hoop.wMm || s.y > project.hoop.hMm),
  ).length;
  if (outside > 0)
    warnings.push({
      level: "warn",
      message: `${outside} stitch${outside === 1 ? "" : "es"} fall outside the ${project.hoop.name} hoop.`,
    });

  // Per-object density that risks puckering.
  for (const o of project.objects) {
    if (o.type === "running") continue;
    const { density } = resolveParams(o.type, o.params);
    if (density < LIMITS.minDensity) {
      warnings.push({
        level: "warn",
        message: `"${o.name}" density ${density.toFixed(2)} mm is very high — puckering risk.`,
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
