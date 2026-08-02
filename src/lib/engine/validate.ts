import type { Path, Project } from "../../types/project";
import { resolveParams } from "../../types/project";
import { distance } from "../geometry";
import { buriedPairs } from "../fix";
import { polygonArea } from "../trace/classify";
import { fillCoverage } from "../bench/metrics";
import { resampleByCount } from "./resample";
import { SATIN_MAX_WIDTH } from "./satin";
import { countStitches, type EngineStitch } from "./index";

/** Machine / quality limits used for validation warnings. */
export const LIMITS = {
  minStitch: 0.25, // mm — below this the needle re-punches a hole (skip/jam).
  // Note: satin and dense fills legitimately run ~0.3–0.4 mm rows, which is NOT a
  // skip risk; only a near-same-hole (< 0.25 mm) punch is. The engine already
  // floors stitches at 0.3 mm, so this warns only if something truly tiny slips in.
  //
  // maxStitch: professionally digitized files top out ~7 mm on satin (see
  // docs/pes-benchmark.md), and the engine caps its own output at 6.5 mm — so
  // this warning fires only on RAW stitches (imported machine files, photo
  // mode), which bypass the engine cap. The previous 12 mm value was
  // unreachable even for those in practice and the warning was dead code.
  maxStitch: 7, // mm — above this stitches are loose and snag
  minDensity: 0.3, // mm/row — denser than this risks puckering
  maxStitchCount: 25000,
  maxSatinWidth: SATIN_MAX_WIDTH, // mm — wider satin sews loose; use a fill
  // Below this a column is thinner than the needle can separate: the engine
  // auto-widens to its 1.0 mm sewable floor, but the result reads bolder than
  // drawn — typical of text under ~4 mm cap height at 40 wt. Physical limit;
  // warn and suggest finer thread or a bigger size rather than pretend.
  minSatinWidth: 1.2,
  largeFillAreaMm2: 200, // mm² — a fill this big really wants underlay
  // Measured (not parameter-derived) quality gates over the compiled stream:
  /** fills covering less than this fraction of their region show fabric gaps. */
  minFillCoverage: 0.97,
  /** penetrations landing in one 1 mm² cell beyond this is a thread pile-up
   *  (pucker / thread-nest risk) regardless of what the parameters claim. */
  maxPenetrationsPerMm2: 25,
};

export interface Warning {
  level: "warn";
  message: string;
  /** The object at fault, when one can be pinpointed — lets the UI select it on
   *  click. Omitted for design-wide warnings (e.g. total stitch count). */
  objectId?: string;
}

/** Worst 1 mm² penetration pile-up in the design: bin real penetrations into a
 *  1 mm grid and return the fullest cell (with a resident object for the UI to
 *  select). Pure over the stream, O(n). */
export function penetrationPileup(
  design: EngineStitch[],
): { count: number; x: number; y: number; objectId?: string } | null {
  const cells = new Map<string, { count: number; objectId?: string }>();
  let worst: { count: number; x: number; y: number; objectId?: string } | null = null;
  for (const s of design) {
    if (s.jump) continue;
    const cx = Math.floor(s.x);
    const cy = Math.floor(s.y);
    const key = `${cx},${cy}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { count: 0, objectId: s.objectId };
      cells.set(key, cell);
    }
    cell.count++;
    if (!worst || cell.count > worst.count) {
      worst = { count: cell.count, x: cx + 0.5, y: cy + 0.5, objectId: cell.objectId };
    }
  }
  return worst;
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
  // And one NARROWER than a needle can separate gets auto-widened to the 1 mm
  // sewable floor — tiny lettering will read bolder than drawn (physics, not a
  // bug): say so and point at the real fixes.
  for (const o of project.objects) {
    if (o.type !== "satin") continue;
    const width = meanSatinWidthMm(o.paths);
    if (width > LIMITS.maxSatinWidth) {
      warnings.push({
        level: "warn",
        objectId: o.id,
        message: `"${o.name}" satin column is ${width.toFixed(1)} mm wide — wider than ${LIMITS.maxSatinWidth} mm sews loose; consider a fill.`,
      });
    } else if (width > 0 && width < LIMITS.minSatinWidth) {
      warnings.push({
        level: "warn",
        objectId: o.id,
        message: `"${o.name}" is only ${width.toFixed(1)} mm wide — thinner than a needle can separate, so it sews at the 1 mm minimum and reads bolder than drawn. Use 60 wt thread or make it larger.`,
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

  // MEASURED coverage of the fills — the parameter checks above trust what the
  // params claim; this checks what the compiled stitches actually deliver.
  // Coarser cell than the bench harness (0.3 vs 0.15 mm) keeps it interactive.
  const coverage = fillCoverage(project, design, 0.3);
  if (coverage !== null && coverage < LIMITS.minFillCoverage) {
    warnings.push({
      level: "warn",
      message: `Fills cover ${(coverage * 100).toFixed(1)}% of their regions — gaps may show fabric. Check fill density and shape.`,
    });
  }

  // MEASURED penetration pile-up: too many needle punches in one spot puckers
  // the fabric and nests thread no matter what the per-object densities say.
  const pileup = penetrationPileup(design);
  if (pileup && pileup.count > LIMITS.maxPenetrationsPerMm2) {
    warnings.push({
      level: "warn",
      objectId: pileup.objectId,
      message: `${pileup.count} needle penetrations land within 1 mm² near (${pileup.x.toFixed(0)}, ${pileup.y.toFixed(0)}) mm — pile-up puckers fabric and can nest thread.`,
    });
  }

  // Overall stitch count.
  const total = countStitches(design);
  if (total > LIMITS.maxStitchCount)
    warnings.push({
      level: "warn",
      message: `${total.toLocaleString()} stitches is a lot — long run time and thread use.`,
    });

  // BURIED DETAILS. Thread has no z-order: whatever sews LAST wins. A detail
  // sewn before a broad fill that covers it simply vanishes in the stitch-out —
  // the single most heartbreaking surprise a design can hide, because the canvas
  // preview shows shapes, not sew order. Aggregate per covering fill so a word's
  // 13 letters read as one warning, not 13.
  const visible = project.objects.filter((o) => o.visible);
  const pairs = buriedPairs(visible);
  if (pairs.length > 0) {
    const byCover = new Map<number, number[]>();
    for (const p of pairs) {
      if (!byCover.has(p.cover)) byCover.set(p.cover, []);
      byCover.get(p.cover)!.push(p.buried);
    }
    for (const [cover, buried] of byCover) {
      const f = visible[cover];
      const first = visible[buried[0]];
      const fname = f.name ?? "a fill";
      const bname = first.name ?? "a detail";
      warnings.push({
        level: "warn",
        objectId: first.id,
        message:
          buried.length === 1
            ? `"${bname}" sews before "${fname}", which stitches right over it — it will be buried. Clean up automatically moves it on top.`
            : `${buried.length} details (like "${bname}") sew before "${fname}", which stitches right over them — they'll be buried. Clean up automatically moves them on top.`,
      });
    }
  }

  // A traced region the auto-digitizer flagged as possible leftover page
  // background, still undecided (the digitize dialog clears the flag on an
  // explicit keep). It may be a wanted rim — so it sews — but the user should
  // rule on it before spending ~2000 stitches on what might be the page.
  for (const o of visible) {
    if (o.suspectedBackground) {
      warnings.push({
        level: "warn",
        objectId: o.id,
        message: `"${o.name}" may be leftover page background traced as a ring — delete it if it isn't part of the design.`,
      });
    }
  }

  return warnings;
}
