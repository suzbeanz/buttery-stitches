/**
 * Core data model for a Buttery Stitches project.
 *
 * IMPORTANT: every coordinate and dimension in this model is in **millimeters**.
 * We only convert to pyembroidery's 1/10 mm units at the moment of export
 * (see lib/export). Keeping the in-app model in mm keeps the geometry and
 * stitch-math code readable and unit-test friendly.
 */

/** The three stitch primitives the engine knows how to generate. */
export type StitchType = "running" | "satin" | "fill";

/** A polyline / polygon in millimeter coordinates. */
export type Point = { x: number; y: number };
export type Path = Point[];

/** A user-placed control node; `smooth` curves the path through it (vs a corner).
 *  A smooth node may carry explicit Bézier tangent handles — `hIn`/`hOut` are
 *  RELATIVE mm offsets from the node (so they ride along when the node moves).
 *  Absent handles mean "automatic": the curve's tangent follows the neighbors. */
export interface NodePt {
  x: number;
  y: number;
  smooth?: boolean;
  /** incoming tangent handle (toward the previous node), relative to (x,y). */
  hIn?: Point;
  /** outgoing tangent handle (toward the next node), relative to (x,y). */
  hOut?: Point;
}
export type NodePath = NodePt[];

/** Explicit underlay TYPE override. "auto" = the engine's width/weight tiering. */
export type UnderlayType = "auto" | "center" | "edge" | "zigzag" | "double-zigzag" | "tatami";

export interface EmbObjectParams {
  /** running: mm between needle penetrations (default 2.5). */
  stitchLength?: number;
  /** running: passes over the line for a bold bean/triple stitch (0/1 = single,
   *  3/5/7 = bean). Default 0 (single). */
  beanRepeats?: number;
  /** running: emit the path's points verbatim (no resampling) — used for stitches
   *  imported from an embroidery file so they're preserved exactly. Default false. */
  raw?: boolean;
  /** fill/satin: mm between rows (default 0.4). */
  density?: number;
  /** fill: mm between penetrations ALONG a tatami row (default 4). Shorter =
   *  denser, more secure texture; longer = smoother sheen, fewer stitches. */
  fillStitchLength?: number;
  /** fill direction in degrees (default 0). */
  angle?: number;
  /** ABSOLUTE stitch grain (deg) painted by the user with the Direction tool. When
   *  set it overrides the auto grain and the turning/flow fills — the rows run
   *  straight at this angle. `null`/absent = auto direction (principal axis +
   *  `angle`). */
  directionDeg?: number | null;
  /** A flow curve painted with the Direction tool: the fill's rows run PERPENDICULAR
   *  to this curve, so the stitches follow it (a leaf vein, a cheek). Stored as
   *  points NORMALIZED to the object's bbox ([0..1]) so it moves/scales with the
   *  fill. Takes precedence over `directionDeg`; `null`/absent = not set. */
  flowPath?: [number, number][] | null;
  /** MULTI-ANGLE fill guides painted with the Direction tool (Shift-drag): each
   *  guide is `[x, y, deg]` with x/y NORMALIZED to the object's bbox ([0..1] —
   *  the same convention as `flowPath`, so guides ride move/scale) and `deg` the
   *  stitch grain pinned at that anchor. TWO OR MORE guides activate the
   *  multi-angle fill: rows sweep smoothly between the guide angles (Wilcom-style
   *  turning fill). Exactly one guide degrades to a plain manual direction at its
   *  angle. Precedence: angleGuides (≥2) > flowPath > directionDeg > auto grain.
   *  `null`/absent = not set. */
  angleGuides?: [number, number, number][] | null;
  /** add a stabilizing underlay pass (default true for fill/satin). */
  underlay?: boolean;
  /** how heavy the underlay is. "auto" follows the fabric; the rest override it
   *  per object (light → just an edge, heavy → edge + zig-zag/criss-cross). */
  underlayWeight?: "auto" | "light" | "standard" | "heavy";
  /** WHICH underlay pass to lay. "auto" (default) keeps the engine's tiered
   *  choice by column width / weight; the rest pick one explicitly, the way pro
   *  software lets a digitizer override for special fabrics. Satin honors
   *  center / edge / zigzag / double-zigzag; fills honor edge / tatami / zigzag
   *  (center maps to edge, see underlay.ts). Inapplicable picks degrade to the
   *  nearest sensible pass — never an error. */
  underlayType?: UnderlayType;
  /** mm added to satin width to compensate for fabric pull (default 0.2). */
  pullComp?: number;
  /** mm trimmed off each satin column end to compensate for lengthwise fabric
   *  push (default 0.2; open columns only). */
  pushComp?: number;
  /** draw the object's border outline in the editor (default true). */
  outline?: boolean;
  /** how a fill is stitched: tatami (broad areas), satin columns (lettering),
   *  contour (rows that echo the shape's outline), gradient (tatami whose row
   *  spacing ramps for a shaded/ombré effect), or motif (a tiled decorative
   *  motif). */
  fillStyle?: "tatami" | "satin" | "contour" | "gradient" | "motif" | "blend" | "field";
  /** LINE-ART: render this (satin) object's medial columns as clean RUNNING lines
   *  down their centerline rather than filled satin — for outlines and fine detail
   *  strokes (auto-set by the tracer on thin regions). */
  lineArt?: boolean;
  /** second thread color id for fillStyle "blend" (a two-thread ombré). The fill
   *  fades from the object's colorId to this across the shape. */
  blendColorId?: string;
  /** motif id for fillStyle "motif" (and the carve pattern). Default "wave". */
  motif?: string;
  /** motif cell size in mm for a motif fill (default 4). */
  motifSizeMm?: number;
  /** carve: a motif id carved into a tatami/gradient fill as un-penetrated relief
   *  grooves, or "none" (default). */
  carve?: string;
  /** running: repeat a motif along the line (decorative motif run), or "none". */
  motifRun?: string;
  /** appliqué: stitch the shape as placement run → STOP (lay fabric) → tackdown
   *  → STOP (trim) → satin cover, instead of a normal fill. Default false. */
  applique?: boolean;
}

/** A per-glyph manual adjustment applied AFTER normal text layout, in the
 *  glyph's LOCAL frame: `dx` slides along the local baseline direction and `dy`
 *  perpendicular to it (mm, +dy toward the descender side), so a nudge follows
 *  an arched / circular / path baseline. `rotDeg` (degrees, + = clockwise on
 *  screen) and `scale` (1 = unchanged) act about the glyph's own anchor — its
 *  advance-center point on the baseline. */
export interface GlyphTweak {
  dx?: number;
  dy?: number;
  rotDeg?: number;
  scale?: number;
}

/** Re-edit metadata for objects generated by the text tool. */
export interface TextSpec {
  content: string;
  fontId: string;
  heightMm: number;
  letterSpacingMm: number;
  /** line spacing as a multiple of letter height (multiline). Default 1.35. */
  lineSpacing?: number;
  /** arc bend in degrees: + arches up, − down, 0 straight. Default 0. */
  archDeg?: number;
  /** lay the text around a circle of this baseline radius (mm). Overrides arch. */
  circleRadiusMm?: number;
  /** which side of the circle ("top" = upper arc, "bottom" = upright lower arc). */
  circleSide?: "top" | "bottom";
  /** lay the text along this open polyline (mm). Overrides arch and circle. */
  pathMm?: Point[];
  /** Per-glyph manual tweaks, keyed by VISIBLE glyph index: glyphs are counted
   *  in reading order across all lines, and ONLY glyphs that produce geometry
   *  count (whitespace — which renders nothing — is skipped). Index-based, so
   *  editing the content string may shift which letter a tweak lands on
   *  (accepted v1 behavior; the dialog prunes indices past the new length). */
  glyphTweaks?: Record<number, GlyphTweak>;
}

export interface EmbObject {
  id: string;
  name: string;
  type: StitchType;
  /** references a ThreadColor.id */
  colorId: string;
  /**
   * mm coordinates.
   *  - fill:    one or more closed polygons (first = outer, rest = holes).
   *  - satin:   exactly two paths forming a rail pair (left, right).
   *  - running: one open polyline.
   */
  paths: Path[];
  /** Optional explicit satin-column centerlines (mm, object space) — the per-glyph
   *  AUTHORED decomposition for the flagship font. When present on a satin fill,
   *  the engine lays a satin column down each centerline (rails raycast to the real
   *  outline) instead of auto-skeletonizing, so diagonal-junction glyphs (W, M, A,
   *  K, …) sew as clean strokes. Transformed alongside `paths`. */
  satinCenterlines?: Path[];
  /** Optional editable control nodes (one ring per `paths` ring) for corner↔curve
   *  editing. When present, `paths` is densified from these; the engine still only
   *  reads `paths`. Absent on imported/auto-digitized/satin objects. */
  nodes?: NodePath[];
  params: EmbObjectParams;
  visible: boolean;
  /** present on text objects so they can be re-edited (double-click). */
  text?: TextSpec;
  /** objects sharing a groupId select and move together. */
  groupId?: string;
}

export interface ThreadColor {
  id: string;
  rgb: [number, number, number];
  /** e.g. "Madeira Polyneon" */
  brand?: string;
  /** thread catalog number */
  code?: string;
  name?: string;
}

export interface Hoop {
  wMm: number;
  hMm: number;
  name: string;
}

/** What the design is stitched onto — modifies density, pull-comp, and underlay. */
export type FabricType = "woven" | "knit" | "pile" | "sheer";

/** How a fabric bends the stitch parameters (see docs/stitch-logic.md §8). */
export interface FabricProfile {
  name: string;
  /** multiplies row density gap — <1 packs rows tighter (stretchy fabric). */
  densityMul: number;
  /** multiplies pull compensation — stretchy fabric pulls in more. */
  pullMul: number;
  /** how heavy the underlay should be. */
  underlay: "light" | "standard" | "heavy";
  /** multiplies stitch length — pile rides longer stitches above the loops. */
  stitchLenMul: number;
}

export const FABRICS: Record<FabricType, FabricProfile> = {
  woven: { name: "Woven (stable)", densityMul: 1.0, pullMul: 1.0, underlay: "standard", stitchLenMul: 1.0 },
  knit: { name: "Knit / stretch", densityMul: 0.9, pullMul: 1.5, underlay: "heavy", stitchLenMul: 1.0 },
  pile: { name: "Pile / fleece", densityMul: 0.85, pullMul: 1.2, underlay: "heavy", stitchLenMul: 1.15 },
  sheer: { name: "Sheer / delicate", densityMul: 1.1, pullMul: 0.7, underlay: "light", stitchLenMul: 1.0 },
};

export const DEFAULT_FABRIC: FabricType = "woven";

/** The profile for a project's fabric (defaults to woven when unset). */
export function fabricProfile(fabric: FabricType | undefined): FabricProfile {
  return FABRICS[fabric ?? DEFAULT_FABRIC];
}

/**
 * Thread weight (the "wt" number on the spool). Thinner thread (higher number)
 * lays a narrower line, so rows must pack tighter to cover; thicker thread opens
 * up. 40wt is the industry standard baseline.
 */
export type ThreadWeight = 30 | 40 | 60;

export const DEFAULT_THREAD_WEIGHT: ThreadWeight = 40;

/** Row-spacing multiplier for a thread weight (≈ −28% gap for fine 60wt,
 *  +15% for bold 30wt). Multiplies the density gap, so <1 = denser rows. */
export function threadDensityMul(weight: ThreadWeight | undefined): number {
  switch (weight ?? DEFAULT_THREAD_WEIGHT) {
    case 60:
      return 0.72;
    case 30:
      return 1.15;
    default:
      return 1.0;
  }
}

export interface Project {
  version: 1;
  widthMm: number;
  heightMm: number;
  hoop: Hoop;
  /** what it's stitched onto (default "woven"); bends density/underlay/pull. */
  fabric?: FabricType;
  /** thread weight (default 40wt); bends row density to keep coverage. */
  threadWeight?: ThreadWeight;
  /** build tag of the auto-digitizer that traced this design (set when an
   *  image is imported). Lets the app warn when a stored design predates the
   *  current digitizer — re-exporting never re-traces. */
  digitizedBuild?: string;
  colors: ThreadColor[];
  /** ORDER = stitch sequence. The first object is stitched first. */
  objects: EmbObject[];
}

/** Default parameter values, applied wherever a param is omitted. */
export const DEFAULT_PARAMS: Required<EmbObjectParams> = {
  stitchLength: 2.5,
  beanRepeats: 0,
  raw: false,
  density: 0.30,
  fillStitchLength: 4,
  angle: 0,
  directionDeg: null,
  flowPath: null,
  angleGuides: null,
  underlay: true,
  underlayWeight: "auto",
  underlayType: "auto",
  pullComp: 0.2,
  pushComp: 0.2,
  outline: true,
  fillStyle: "tatami",
  lineArt: false,
  blendColorId: "",
  motif: "wave",
  motifSizeMm: 4,
  carve: "none",
  motifRun: "none",
  applique: false,
};

/**
 * MACHINE-SAFETY param sanitizers. These numeric fields are user-editable (and
 * are stored verbatim in a `.embproj`, so a hand-edited or corrupt file reaches
 * the engine unchecked). A non-positive or non-finite STEP length makes the
 * engine's stepping loops never advance — or diverge — so the tab OOMs before a
 * single stitch is drawn; an astronomically large one melts the machine. There
 * is no legitimate design with a zero, negative, NaN, or 5-metre stitch length,
 * so every such value is coerced to a sane finite number here, at the one place
 * every consumer (engine AND validator) resolves params.
 */
/** A positive, finite length (mm) clamped to [min, max]; junk → the default. */
function safeLen(v: number | undefined, def: number, min: number, max: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}
/** A finite SIGNED value (mm) clamped to [-max, max]; junk → the default. Pull /
 *  push compensation may legitimately be 0 or negative, so only the magnitude is
 *  bounded (a 1e6 mm pull comp would spawn unbounded satin rows). */
function safeSigned(v: number | undefined, def: number, max: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  return Math.max(-max, Math.min(max, v));
}
/** A finite integer count clamped to [0, max]; junk → the default. */
function safeCount(v: number | undefined, def: number, max: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  return Math.max(0, Math.min(max, Math.floor(v)));
}
/** Density is NOT clamped to the safe FLOOR here — the validator must still see a
 *  recklessly-tight requested value to warn on it, and the engine floors it at
 *  generation. Only a NON-FINITE density is corruption (it crashes satin spacing
 *  with a raw TypeError), so that alone is coerced; finite-but-tight passes
 *  through untouched. */
function safeDensity(v: number | undefined, def: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  return v;
}

/** Resolve an object's params against the defaults for the engine. */
export function resolveParams(
  type: StitchType,
  params: EmbObjectParams,
): Required<EmbObjectParams> {
  return {
    stitchLength: safeLen(params.stitchLength, DEFAULT_PARAMS.stitchLength, 0.5, 12),
    beanRepeats: safeCount(params.beanRepeats, DEFAULT_PARAMS.beanRepeats, 12),
    raw: params.raw ?? DEFAULT_PARAMS.raw,
    density: safeDensity(params.density, DEFAULT_PARAMS.density),
    fillStitchLength: safeLen(params.fillStitchLength, DEFAULT_PARAMS.fillStitchLength, 0.5, 12),
    angle: params.angle ?? DEFAULT_PARAMS.angle,
    directionDeg: params.directionDeg ?? DEFAULT_PARAMS.directionDeg,
    flowPath: params.flowPath ?? DEFAULT_PARAMS.flowPath,
    angleGuides: params.angleGuides ?? DEFAULT_PARAMS.angleGuides,
    // running stitch never has underlay regardless of stored value
    underlay:
      type === "running" ? false : (params.underlay ?? DEFAULT_PARAMS.underlay),
    underlayWeight: params.underlayWeight ?? DEFAULT_PARAMS.underlayWeight,
    underlayType: params.underlayType ?? DEFAULT_PARAMS.underlayType,
    pullComp: safeSigned(params.pullComp, DEFAULT_PARAMS.pullComp, 5),
    pushComp: safeSigned(params.pushComp, DEFAULT_PARAMS.pushComp, 5),
    outline: params.outline ?? DEFAULT_PARAMS.outline,
    fillStyle: params.fillStyle ?? DEFAULT_PARAMS.fillStyle,
    lineArt: params.lineArt ?? DEFAULT_PARAMS.lineArt,
    blendColorId: params.blendColorId ?? DEFAULT_PARAMS.blendColorId,
    motif: params.motif ?? DEFAULT_PARAMS.motif,
    motifSizeMm: safeLen(params.motifSizeMm, DEFAULT_PARAMS.motifSizeMm, 0.5, 100),
    carve: params.carve ?? DEFAULT_PARAMS.carve,
    motifRun: params.motifRun ?? DEFAULT_PARAMS.motifRun,
    applique: params.applique ?? DEFAULT_PARAMS.applique,
  };
}
