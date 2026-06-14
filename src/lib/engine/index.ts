import type { EmbObject, Point, Project } from "../../types/project";
import { resolveParams } from "../../types/project";
import { distance } from "../geometry";
import { runningStitch } from "./running";
import { satinColumn } from "./satin";
import { tatamiFill } from "./fill";
import { fillUnderlay, satinUnderlay } from "./underlay";

export * from "./running";
export * from "./satin";
export * from "./fill";
export * from "./resample";

/**
 * One needle event in the assembled design (millimetres).
 *  - `jump`: a travel move with no penetration (positions the needle).
 *  - `trim`: cut the thread before this event.
 *  - `underlay`: part of the stabilising underlay pass (rendered dimmer).
 */
export interface EngineStitch {
  x: number;
  y: number;
  colorId: string;
  objectId: string;
  jump?: boolean;
  trim?: boolean;
  underlay?: boolean;
}

export interface DesignOptions {
  /** travels longer than this (mm) become a jump (default 3) */
  jumpThreshold?: number;
  /** travels longer than this (mm) also trim the thread (default 8) */
  trimThreshold?: number;
}

/** The underlay + top-layer penetrations for a single object. */
export function generateObjectStitches(
  object: EmbObject,
): { underlay: Point[]; main: Point[] } {
  const p = resolveParams(object.type, object.params);

  if (object.type === "running") {
    return { underlay: [], main: runningStitch(object.paths[0] ?? [], p.stitchLength) };
  }

  if (object.type === "satin") {
    const [left, right] = object.paths;
    if (!left || !right) return { underlay: [], main: [] };
    return {
      underlay: p.underlay ? satinUnderlay(left, right) : [],
      main: satinColumn(left, right, { density: p.density, pullComp: p.pullComp }),
    };
  }

  // fill
  return {
    underlay: p.underlay ? fillUnderlay(object.paths) : [],
    main: tatamiFill(object.paths, { density: p.density, angle: p.angle }),
  };
}

/**
 * Assemble every visible object (in stitch order) into one ordered stream of
 * needle events, inserting jumps for long travels, trims on colour changes and
 * long jumps. Hidden objects are skipped — what you see is what you sew.
 *
 * This single representation drives both the on-canvas simulator and the
 * exporter, so the preview and the file can never disagree.
 */
export function generateDesign(
  project: Project,
  { jumpThreshold = 3, trimThreshold = 8 }: DesignOptions = {},
): EngineStitch[] {
  const out: EngineStitch[] = [];
  let prevPoint: Point | null = null;
  let prevColor: string | null = null;

  for (const object of project.objects) {
    if (!object.visible) continue;
    const { underlay, main } = generateObjectStitches(object);
    const pts = [...underlay, ...main];
    if (pts.length === 0) continue;
    const underlayCount = underlay.length;

    const colorChanged = object.colorId !== prevColor;
    const start = pts[0];

    // Travel from where we left off to this object's first penetration.
    if (prevPoint) {
      const gap = distance(prevPoint, start);
      if (colorChanged || gap > jumpThreshold) {
        out.push({
          x: start.x,
          y: start.y,
          colorId: object.colorId,
          objectId: object.id,
          jump: true,
          trim: colorChanged || gap > trimThreshold,
        });
      }
    }

    pts.forEach((pt, i) => {
      out.push({
        x: pt.x,
        y: pt.y,
        colorId: object.colorId,
        objectId: object.id,
        underlay: i < underlayCount,
      });
    });

    prevPoint = pts[pts.length - 1];
    prevColor = object.colorId;
  }

  return out;
}

/** Number of actual penetrations (excludes jumps). */
export function countStitches(design: EngineStitch[]): number {
  return design.reduce((n, s) => n + (s.jump ? 0 : 1), 0);
}

/** Number of thread/colour changes in the design. */
export function countColorChanges(design: EngineStitch[]): number {
  let changes = 0;
  let prev: string | null = null;
  for (const s of design) {
    if (s.colorId !== prev) {
      if (prev !== null) changes++;
      prev = s.colorId;
    }
  }
  return changes;
}
