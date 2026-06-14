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

export interface EmbObjectParams {
  /** running: mm between needle penetrations (default 2.5). */
  stitchLength?: number;
  /** fill/satin: mm between rows (default 0.4). */
  density?: number;
  /** fill direction in degrees (default 0). */
  angle?: number;
  /** add a stabilising underlay pass (default true for fill/satin). */
  underlay?: boolean;
  /** mm added to satin width to compensate for fabric pull (default 0.2). */
  pullComp?: number;
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
  params: EmbObjectParams;
  visible: boolean;
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

export interface Project {
  version: 1;
  widthMm: number;
  heightMm: number;
  hoop: Hoop;
  colors: ThreadColor[];
  /** ORDER = stitch sequence. The first object is stitched first. */
  objects: EmbObject[];
}

/** Default parameter values, applied wherever a param is omitted. */
export const DEFAULT_PARAMS: Required<EmbObjectParams> = {
  stitchLength: 2.5,
  density: 0.4,
  angle: 0,
  underlay: true,
  pullComp: 0.2,
};

/** Resolve an object's params against the defaults for the engine. */
export function resolveParams(
  type: StitchType,
  params: EmbObjectParams,
): Required<EmbObjectParams> {
  return {
    stitchLength: params.stitchLength ?? DEFAULT_PARAMS.stitchLength,
    density: params.density ?? DEFAULT_PARAMS.density,
    angle: params.angle ?? DEFAULT_PARAMS.angle,
    // running stitch never has underlay regardless of stored value
    underlay:
      type === "running" ? false : (params.underlay ?? DEFAULT_PARAMS.underlay),
    pullComp: params.pullComp ?? DEFAULT_PARAMS.pullComp,
  };
}
