import type { EmbObject, Path } from "../../types/project";
import type { DigitizeOptions, DigitizeResult } from "./types";
import { imageDataToObjects } from "./index";
import { polygonArea, polygonPerimeter } from "./classify";
import { pathsBounds } from "../geometry";
import { rgbToLab } from "../thread/match";
import { seamTrap } from "../boolean";
import { stackSmallFeatures } from "./stack";
import { recognizeShape } from "./recognize";
import { quantizeImage } from "./quantize";
import { downsampleForDetection } from "./livepaint";

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

/** Two shades read as one FUR FAMILY when their Lab hues sit within this many
 *  degrees — a shade ladder is one hue at several lightnesses. Measured: the
 *  fixture browns sit at hue 67.6°/68.0°/72.2° (gaps ≤ 4.6°), while the
 *  nearest confusers are far outside — fur↔tongue-pink ≥ 54.9°, a red↔blue
 *  logo pair 95.6°. 20° gives ~4× margin both ways. */
const FUR_HUE_AKIN_DEG = 20;
/** Below this Lab chroma a color is NEUTRAL (grey/black/white coat) and hue is
 *  float noise — neutrals are always hue-akin to each other. Real brown coats
 *  carry chroma 25–35, so they are decided by the hue gate instead. */
const FUR_NEUTRAL_CHROMA = 10;
/** A real shade LADDER spans at least this much L* (fixture steps ≈ 20);
 *  two shades closer than the dialog's ΔE-10 merge bar are trace noise. */
const FUR_MIN_LADDER_DL = 12;
/** …and CLIMBS IN STEPS: adjacent shades in a real coat sit ~17–35 L* apart
 *  (measured: Cavapoo 17, fox 19, the sawtooth fixture ≈ 20, a grey coat
 *  ≈ 34). A family whose sorted lightnesses jump farther than this in one
 *  step is poles, not a ladder — a black mark on a white field (the most
 *  common logo composition, measured ΔL 92) or black/white/green cartoon
 *  blocks (max step 67) must never read as fur. */
const FUR_MAX_STEP_DL = 45;
/** Detection ignores near-transparent art (same floor as detectLineArt). */
const FUR_DETECT_MIN_OPAQUE = 0.05;

export interface FurArtDetection {
  isFurArt: boolean;
  stats: {
    opaqueFraction: number;
    /** hue-akin family size among the mass candidates */
    furMassCount: number;
    /** max L* − min L* inside the family */
    ladderDeltaL: number;
    /** widest hue gap accepted into the family (0 when neutral-decided) */
    maxFamilyHueDeg: number;
  };
}

/**
 * Does this image read as SOFT-SHADED FUR ART — a ladder of same-hue shades
 * laid as large interlocking masses (the layered-coat look), rather than a
 * flat logo or outlined line art? Runs on a ≤300px downsample, once per
 * loaded image. Sources are always simple flat-color artwork (never photos),
 * so an 8-color quantize is a faithful palette read.
 *
 * The wizard preselects the Fur method on a hit — AFTER the line-art detector
 * (outlined cartoon art with shaded fills is line art first).
 */
export function detectFurArt(imageData: ImageData): FurArtDetection {
  const img = downsampleForDetection(imageData);
  const { width, height } = img;
  const total = width * height;
  const no = (partial: Partial<FurArtDetection["stats"]> = {}): FurArtDetection => ({
    isFurArt: false,
    stats: { opaqueFraction: 0, furMassCount: 0, ladderDeltaL: 0, maxFamilyHueDeg: 0, ...partial },
  });

  let opaqueCount = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= 128) opaqueCount++;
  const opaqueFraction = opaqueCount / total;
  if (opaqueFraction < FUR_DETECT_MIN_OPAQUE) return no({ opaqueFraction });

  // 8 slots = a 4-shade coat + eye + tongue + sparkle + slack; flat art
  // quantizes faithfully (no photos, by product constraint).
  const q = quantizeImage({ width, height, data: img.data }, 8);
  const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
  const slot = new Map<number, number>();
  q.palette.forEach((c, i) => slot.set(key(c[0], c[1], c[2]), i));

  // Per-palette-color raster stats: area share + bbox span (mass = big AND
  // sweeping, the raster analogue of the trace-time fur-mass gates).
  const count = new Array<number>(q.palette.length).fill(0);
  const bbox = q.palette.map(() => ({ x0: width, y0: height, x1: -1, y1: -1 }));
  let sx0 = width, sy0 = height, sx1 = -1, sy1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (q.data[o + 3] < 128) continue;
      const i = slot.get(key(q.data[o], q.data[o + 1], q.data[o + 2]));
      if (i === undefined) continue;
      count[i]++;
      const b = bbox[i];
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      if (x < sx0) sx0 = x;
      if (x > sx1) sx1 = x;
      if (y < sy0) sy0 = y;
      if (y > sy1) sy1 = y;
    }
  }
  const subjectSpan = Math.max(sx1 - sx0 + 1, sy1 - sy0 + 1);
  if (subjectSpan <= 0) return no({ opaqueFraction });

  interface Candidate { L: number; chroma: number; hueDeg: number; area: number }
  const candidates: Candidate[] = [];
  q.palette.forEach((rgb, i) => {
    const areaShare = count[i] / opaqueCount;
    const span = Math.max(bbox[i].x1 - bbox[i].x0 + 1, bbox[i].y1 - bbox[i].y0 + 1);
    if (areaShare < FUR_MASS_MIN_AREA_SHARE || span < FUR_MASS_MIN_DIM_FRAC * subjectSpan) return;
    const [L, a, b] = rgbToLab(rgb);
    candidates.push({
      L,
      chroma: Math.hypot(a, b),
      hueDeg: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
      area: count[i],
    });
  });

  // Grow the hue-akin family greedily from the largest-area candidate.
  const akin = (p: Candidate, r: Candidate): number | null => {
    if (p.chroma < FUR_NEUTRAL_CHROMA && r.chroma < FUR_NEUTRAL_CHROMA) return 0;
    if (Math.min(p.chroma, r.chroma) < FUR_NEUTRAL_CHROMA && Math.max(p.chroma, r.chroma) <= 20)
      return 0;
    const d = Math.abs(p.hueDeg - r.hueDeg);
    const gap = Math.min(d, 360 - d);
    return gap <= FUR_HUE_AKIN_DEG ? gap : null;
  };
  candidates.sort((p, r) => r.area - p.area);
  const family: Candidate[] = candidates.length ? [candidates[0]] : [];
  let maxGap = 0;
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of candidates) {
      if (family.includes(c)) continue;
      const gaps = family.map((m) => akin(c, m)).filter((g): g is number => g !== null);
      if (gaps.length > 0) {
        family.push(c);
        maxGap = Math.max(maxGap, ...gaps);
        grew = true;
      }
    }
  }
  const Ls = family.map((c) => c.L).sort((a, b) => a - b);
  const ladderDeltaL = Ls.length ? Ls[Ls.length - 1] - Ls[0] : 0;
  let maxStepDL = 0;
  for (let i = 1; i < Ls.length; i++) maxStepDL = Math.max(maxStepDL, Ls[i] - Ls[i - 1]);
  return {
    isFurArt:
      family.length >= MIN_FUR_COLORS &&
      ladderDeltaL >= FUR_MIN_LADDER_DL &&
      maxStepDL <= FUR_MAX_STEP_DL,
    stats: {
      opaqueFraction,
      furMassCount: family.length,
      ladderDeltaL,
      maxFamilyHueDeg: maxGap,
    },
  };
}

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
      return {
        ...o,
        params: { ...o.params, fillStyle: "satin" as const, lineArt: true, sparkle: true },
      };
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

  // OVERLAP: each fur shade grows under every LATER fur shade, exactly where
  // they abut (seamTrap = lower ∪ (dilate(lower) ∩ higher)). Details are
  // excluded — they stack on top instead. Clamped: a junk option would grow
  // every shade far under every later one.
  const overlapMm = Math.min(2, Math.max(0, opts.furOverlapMm ?? FUR_OVERLAP_MM));
  const furIdx = stacked
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.params.fillStyle === "fur")
    .map(({ i }) => i);
  for (let k = 0; k < furIdx.length - 1; k++) {
    const i = furIdx[k];
    const higher: Path[][] = furIdx.slice(k + 1).map((j) => stacked[j].paths);
    const trapped = seamTrap(stacked[i].paths, higher, overlapMm, FUR_TRAP_CELL_MM);
    if (trapped !== stacked[i].paths) stacked[i] = { ...stacked[i], paths: trapped };
  }

  return { colors, objects: stacked };
}
