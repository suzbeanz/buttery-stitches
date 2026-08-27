import type { EmbObject, Path } from "../../types/project";
import type { DigitizeOptions, DigitizeResult } from "./types";
import { imageDataToObjects } from "./index";
import { polygonArea, polygonPerimeter } from "./classify";
import { pathsBounds } from "../geometry";
import { rgbToLab } from "../thread/match";
import { seamTrap } from "../boolean";
import { stackSmallFeatures } from "./stack";
import { recognizeShape } from "./recognize";

/**
 * FUR / PAINTERLY digitizing — the commercial layered-fur model, measured from
 * a Wilcom-digitized reference (production worksheet + stitch-level decode):
 *
 *  • FUR-MASS shades sew strictly DARK → LIGHT (reference L* 99→135→180→216):
 *    the base coat first, lighter locks layered over it.
 *  • Small DETAIL features (eyes, tongue, nose, highlight sparkles) sew AFTER
 *    all fur, regardless of lightness.
 *  • Adjacent shades OVERLAP ~1mm — the earlier (darker) region extends under
 *    the later (lighter) one, so no seam can open and no outline is needed.
 *  • Spiky lock silhouettes are the fur texture: the trace must not shape-snap
 *    or straighten them away.
 *  • Each elongated lock fills along its own flow (the engine's per-region
 *    turning, unlocked by `fillStyle: "fur"`).
 *
 * This module is ASSEMBLY only: it reuses the standard tracer for segmentation
 * (with spike-preserving options) and then orders, splits fur from detail,
 * bakes the overlap, and maps the sparkle color.
 */

/** How far an earlier (darker) fur shade tucks under the next (lighter) one.
 *  The reference measures ~1mm of shared coverage at shade boundaries. */
export const FUR_OVERLAP_MM = 0.9;
/** seamTrap raster cell — fine enough that 1–2mm sawtooth teeth survive the
 *  marching-squares retrace. */
const FUR_TRAP_CELL_MM = 0.15;
/** A color is a FUR MASS only when it holds a real share of the subject… */
const FUR_MASS_MIN_AREA_SHARE = 0.06;
/** …and its largest region spans a real fraction of the subject (locks sweep
 *  across the animal; a tongue doesn't). */
const FUR_MASS_MIN_DIM_FRAC = 0.25;
/** Sparkle candidates: thin… */
const SPARKLE_MAX_MEAN_WIDTH_MM = 1.6;
/** …elongated highlight strokes… */
const SPARKLE_MIN_ELONGATION = 3;
/** …that are actually HIGHLIGHTS — near-white in absolute terms (the reference
 *  sparkle measures L* ≈ 97). Without this floor a small dark eye can slip in:
 *  the perimeter²-based elongation rates even a disc at π, and a ~3mm eye sits
 *  right at the width bar. */
const SPARKLE_MIN_L = 80;
/** Fewer qualifying fur shades than this → not fur art; decline to standard. */
const MIN_FUR_COLORS = 2;

interface ColorStats {
  colorId: string;
  L: number;
  areaMm2: number;
  largestDimMm: number;
  meanWidthMm: number;
  elongation: number;
  furMass: boolean;
  sparkle: boolean;
}

/** Area/size/shape stats for one color's FILL objects. */
function statsFor(colorId: string, L: number, objects: EmbObject[]): ColorStats {
  let area = 0;
  let largestDim = 0;
  let perim = 0;
  let maxElong = 0;
  for (const o of objects) {
    if (o.colorId !== colorId) continue;
    for (const ring of o.paths) {
      const a = Math.abs(polygonArea(ring));
      const p = polygonPerimeter(ring);
      area += a;
      perim += p;
      const b = pathsBounds([ring]);
      if (b) largestDim = Math.max(largestDim, b.maxX - b.minX, b.maxY - b.minY);
      const w = p > 0 ? (2 * a) / p : 0;
      const len = p / 2;
      if (w > 0) maxElong = Math.max(maxElong, len / w);
    }
  }
  const meanWidth = perim > 0 ? (2 * area) / perim : 0;
  return {
    colorId,
    L,
    areaMm2: area,
    largestDimMm: largestDim,
    meanWidthMm: meanWidth,
    elongation: maxElong,
    furMass: false,
    sparkle: false,
  };
}

/**
 * Digitize as layered fur. Falls back to the PLAIN standard trace when the art
 * doesn't read as fur (fewer than two fur-mass shades) — never worse than the
 * Standard method the user could have picked.
 */
export function furObjects(
  imageData: ImageData,
  numberOfColors: number,
  opts: DigitizeOptions,
): DigitizeResult {
  // Spike-preserving, lock-keeping trace. `idealize` would regularize repeated
  // locks into one canonical shape (wrong here); the global 0.4mm underlap pass
  // is superseded by the fur overlap below; primitives/straightening would
  // erase the sawtooth silhouettes; and the stock 2.2mm stroke bar would route
  // elongated 1–3mm locks into line-art satin instead of fills.
  const traced = imageDataToObjects(imageData, numberOfColors, {
    ...opts,
    detail: opts.detail ?? "detailed",
    shapeSnap: false,
    straightenTolMm: 0.25,
    strokeMaxWidthMm: 0.9,
    idealize: false,
    underlap: false,
  });
  if (traced.objects.length === 0 || traced.colors.length < 2) return traced;

  // Per-color stats over the whole traced subject.
  const subjectBounds = pathsBounds(traced.objects.flatMap((o) => o.paths));
  const subjectDim = subjectBounds
    ? Math.max(subjectBounds.maxX - subjectBounds.minX, subjectBounds.maxY - subjectBounds.minY)
    : 0;
  const stats = traced.colors.map((c) => statsFor(c.id, rgbToLab(c.rgb)[0], traced.objects));
  const totalArea = stats.reduce((s, st) => s + st.areaMm2, 0);
  if (totalArea <= 0 || subjectDim <= 0) return traced;

  // FUR-MASS vs DETAIL split.
  for (const st of stats) {
    st.furMass =
      st.areaMm2 / totalArea >= FUR_MASS_MIN_AREA_SHARE &&
      st.largestDimMm >= FUR_MASS_MIN_DIM_FRAC * subjectDim;
  }
  const furStats = stats.filter((s) => s.furMass);
  if (furStats.length < MIN_FUR_COLORS) {
    // Not fur-shaped art: hand back exactly what Standard trace would produce.
    return imageDataToObjects(imageData, numberOfColors, opts);
  }

  // SPARKLE: the lightest detail color whose regions are all thin, elongated
  // strokes — the reference's white highlight streaks over the fur.
  const sparkleCandidates = stats
    .filter(
      (s) =>
        !s.furMass &&
        s.areaMm2 > 0 &&
        s.L >= SPARKLE_MIN_L &&
        s.meanWidthMm < SPARKLE_MAX_MEAN_WIDTH_MM &&
        s.elongation >= SPARKLE_MIN_ELONGATION,
    )
    .sort((a, b) => b.L - a.L);
  if (sparkleCandidates.length > 0) sparkleCandidates[0].sparkle = true;

  // ORDER: fur masses dark→light, then details (fills before stroke objects,
  // sparkle very last), each detail tier light-ascending too for stable output.
  const statById = new Map(stats.map((s) => [s.colorId, s] as const));
  const colorRank = (id: string): number => {
    const s = statById.get(id)!;
    if (s.furMass) return s.L; // 0..100 band
    if (s.sparkle) return 1000 + s.L; // very last
    return 500 + s.L; // details after all fur
  };
  const objects = [...traced.objects].sort((a, b) => {
    const ra = colorRank(a.colorId);
    const rb = colorRank(b.colorId);
    if (ra !== rb) return ra - rb;
    // Within a color: fills before line-art strokes, then original order.
    const la = a.params.lineArt ? 1 : 0;
    const lb = b.params.lineArt ? 1 : 0;
    if (la !== lb) return la - lb;
    return traced.objects.indexOf(a) - traced.objects.indexOf(b);
  });
  const colors = [...traced.colors].sort((a, b) => colorRank(a.id) - colorRank(b.id));

  // PARAMS: fur masses become "fur" fills (per-region turning + knockdown
  // exemption); only the base coat keeps underlay — the upper shades sew onto
  // thread, where tiered underlay is pure bulk. Sparkle sews as line-art
  // strokes down its own centerlines (the wave-1 highlight approximation).
  const baseFurColorId = furStats.reduce((min, s) => (s.L < min.L ? s : min), furStats[0]).colorId;
  const styled = objects.map((o) => {
    const st = statById.get(o.colorId)!;
    if (st.furMass && o.type === "fill" && !o.params.lineArt) {
      return {
        ...o,
        params: {
          ...o.params,
          fillStyle: "fur" as const,
          ...(o.colorId === baseFurColorId ? {} : { underlay: false }),
        },
      };
    }
    if (st.sparkle && o.type === "fill") {
      return { ...o, params: { ...o.params, fillStyle: "satin" as const, lineArt: true } };
    }
    if (!st.furMass && o.type === "fill" && !o.params.lineArt) {
      // DETAILS get their primitives back: the fur trace disables shape-snap
      // globally (a lock must never become an ellipse), but an eye or a nose
      // IS a crisp primitive and looks lumpy without it.
      return { ...o, paths: o.paths.map((r) => recognizeShape(r, 1.0)?.ring ?? r) };
    }
    return o;
  });

  // A small detail sitting IN the fur (an eye) stacks on top of an unbroken
  // coat instead of carving a hole — the standard trace's stack-don't-carve.
  // BEFORE the overlap bake, so no dropped hole reappears via the trap raster.
  const stacked = stackSmallFeatures(styled);

  // OVERLAP: each fur shade grows FUR_OVERLAP_MM under every LATER fur shade,
  // exactly where they abut (seamTrap = lower ∪ (dilate(lower) ∩ higher)).
  // Details are excluded — they stack on top instead.
  const furIdx = stacked
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.params.fillStyle === "fur")
    .map(({ i }) => i);
  for (let k = 0; k < furIdx.length - 1; k++) {
    const i = furIdx[k];
    const higher: Path[][] = furIdx.slice(k + 1).map((j) => stacked[j].paths);
    const trapped = seamTrap(stacked[i].paths, higher, FUR_OVERLAP_MM, FUR_TRAP_CELL_MM);
    if (trapped !== stacked[i].paths) stacked[i] = { ...stacked[i], paths: trapped };
  }

  return { colors, objects: stacked };
}
