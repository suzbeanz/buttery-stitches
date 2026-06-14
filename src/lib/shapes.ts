/**
 * Pure geometry generators for premade shapes, all in millimeters.
 *
 * Every generator returns one or more rings (Path[]) describing the shape's
 * outline. Closed shapes are emitted as explicitly closed rings (first point
 * repeated as the last point) so they round-trip cleanly as fill regions or
 * closed running paths. Curved outlines (ellipse, rounded corners, heart) are
 * approximated with densified polylines.
 *
 * These functions are deliberately free of any React / DOM / store / Konva
 * dependency: they are plain math so they can be unit-tested in isolation and
 * wired into the editor later.
 */

import type { EmbObject, Path, Point } from "../types/project";
import { pathsBounds, translatePaths } from "./geometry";
import { makeObjectFromPaths } from "./objects";

/** The premade shapes the editor can stamp onto the canvas. */
export type ShapeKind =
  | "rectangle"
  | "roundedRect"
  | "ellipse"
  | "triangle"
  | "star"
  | "heart"
  | "line";

/** Default number of segments used to approximate a full curve. */
const DEFAULT_ELLIPSE_SEGMENTS = 64;
/** Segments per quarter-circle corner of a rounded rectangle. */
const CORNER_SEGMENTS = 8;
/** Samples used to trace the parametric heart curve. */
const HEART_SAMPLES = 96;

/** Close a ring by repeating its first point at the end (if not already closed). */
function close(points: Path): Path {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) return points;
  return [...points, { x: first.x, y: first.y }];
}

/**
 * Axis-aligned rectangle of width `w` and height `h` centered on the origin.
 * Returns a single closed ring.
 */
export function rectangle(w: number, h: number): Path[] {
  const hw = w / 2;
  const hh = h / 2;
  return [
    close([
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ]),
  ];
}

/**
 * Rounded rectangle of width `w`, height `h` and corner radius `radius` (mm),
 * centered on the origin. The radius is clamped to half the shorter side.
 */
export function roundedRect(
  w: number,
  h: number,
  radius: number,
  cornerSegments = CORNER_SEGMENTS,
): Path[] {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) return rectangle(w, h);

  const seg = Math.max(1, Math.floor(cornerSegments));
  const pts: Path = [];
  // Centers of the four corner arcs, ordered to trace the outline clockwise in
  // a y-down coordinate space, with sweep start/end angles for each.
  const corners: { cx: number; cy: number; start: number; end: number }[] = [
    { cx: hw - r, cy: -(hh - r), start: -Math.PI / 2, end: 0 }, // top-right
    { cx: hw - r, cy: hh - r, start: 0, end: Math.PI / 2 }, // bottom-right
    { cx: -(hw - r), cy: hh - r, start: Math.PI / 2, end: Math.PI }, // bottom-left
    { cx: -(hw - r), cy: -(hh - r), start: Math.PI, end: (3 * Math.PI) / 2 }, // top-left
  ];

  for (const c of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = c.start + ((c.end - c.start) * i) / seg;
      pts.push({ x: c.cx + r * Math.cos(t), y: c.cy + r * Math.sin(t) });
    }
  }
  return [close(pts)];
}

/**
 * Ellipse with full width `w` and full height `h`, approximated by `segments`
 * points, centered on the origin. When `w === h` this is a circle.
 */
export function ellipse(
  w: number,
  h: number,
  segments = DEFAULT_ELLIPSE_SEGMENTS,
): Path[] {
  const a = w / 2;
  const b = h / 2;
  const n = Math.max(3, Math.floor(segments));
  const pts: Path = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    pts.push({ x: a * Math.cos(t), y: b * Math.sin(t) });
  }
  return [close(pts)];
}

/**
 * Isosceles triangle that fills a `w` x `h` box centered on the origin, with the
 * apex at the top.
 */
export function triangle(w: number, h: number): Path[] {
  const hw = w / 2;
  const hh = h / 2;
  return [
    close([
      { x: 0, y: -hh }, // apex
      { x: hw, y: hh }, // bottom-right
      { x: -hw, y: hh }, // bottom-left
    ]),
  ];
}

/**
 * Star with `points` spikes, alternating between `outerR` and `innerR` radii
 * (mm), centered on the origin. The result has exactly `2 * points` vertices
 * (plus the repeated closing point). The first spike points straight up.
 */
export function star(points: number, outerR: number, innerR: number): Path[] {
  const n = Math.max(2, Math.floor(points));
  const pts: Path = [];
  // Start at the top (-PI/2) and step by half a spike each vertex.
  const step = Math.PI / n;
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const t = -Math.PI / 2 + i * step;
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return [close(pts)];
}

/**
 * Heart shape that fills a `w` x `h` box centered on the origin, point down.
 * Built from the classic parametric heart curve, then scaled to the requested
 * bounding box.
 */
export function heart(w: number, h: number, samples = HEART_SAMPLES): Path[] {
  const n = Math.max(8, Math.floor(samples));
  const raw: Path = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    // The parametric curve has +y pointing up; negate so the lobes sit at the
    // top in our y-down coordinate space.
    raw.push({ x, y: -y });
  }

  const b = pathsBounds([raw]);
  if (!b) return [close(raw)];
  const rawW = b.maxX - b.minX || 1;
  const rawH = b.maxY - b.minY || 1;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const sx = w / rawW;
  const sy = h / rawH;
  const scaled = raw.map((p) => ({
    x: (p.x - cx) * sx,
    y: (p.y - cy) * sy,
  }));
  return [close(scaled)];
}

/**
 * Horizontal line of the given length (mm), centered on the origin. Returns a
 * single open polyline (two points) — not closed, since a line is a running
 * stitch.
 */
export function line(length: number): Path[] {
  const half = length / 2;
  return [
    [
      { x: -half, y: 0 },
      { x: half, y: 0 },
    ],
  ];
}

/** Options accepted by {@link makeShapeObject}, keyed by shape kind. */
export interface ShapeOptions {
  /** Center of the shape in mm (defaults to the origin). */
  center?: Point;
  /** Bounding-box width in mm (rectangle, roundedRect, ellipse, triangle, heart). */
  width?: number;
  /** Bounding-box height in mm (rectangle, roundedRect, ellipse, triangle, heart). */
  height?: number;
  /** Corner radius in mm (roundedRect). */
  radius?: number;
  /** Segment count for curved approximations (ellipse). */
  segments?: number;
  /** Number of star spikes. */
  points?: number;
  /** Outer radius in mm (star). */
  outerR?: number;
  /** Inner radius in mm (star). */
  innerR?: number;
  /** Length in mm (line). */
  length?: number;
}

/** Generate the raw rings for a shape kind, centered on the origin. */
export function shapeRings(kind: ShapeKind, opts: ShapeOptions = {}): Path[] {
  const w = opts.width ?? 20;
  const h = opts.height ?? 20;
  switch (kind) {
    case "rectangle":
      return rectangle(w, h);
    case "roundedRect":
      return roundedRect(w, h, opts.radius ?? Math.min(w, h) / 4);
    case "ellipse":
      return ellipse(w, h, opts.segments ?? DEFAULT_ELLIPSE_SEGMENTS);
    case "triangle":
      return triangle(w, h);
    case "star":
      return star(opts.points ?? 5, opts.outerR ?? w / 2, opts.innerR ?? w / 4);
    case "heart":
      return heart(w, h);
    case "line":
      return line(opts.length ?? w);
  }
}

/**
 * Build a ready-to-use EmbObject for a premade shape, centered on the requested
 * point (mm). Closed shapes become fill objects; `line` becomes a running
 * object. Geometry is produced by the pure generators above and translated to
 * the center.
 */
export function makeShapeObject(
  kind: ShapeKind,
  opts: ShapeOptions,
  colorId: string,
): EmbObject {
  const center = opts.center ?? { x: 0, y: 0 };
  const rings = shapeRings(kind, opts);
  const placed = translatePaths(rings, center.x, center.y);
  const type = kind === "line" ? "running" : "fill";
  return makeObjectFromPaths(type, placed, colorId);
}
