import type { Project, EmbObject, EmbObjectParams, Path, ThreadColor } from "../../types/project";
import { DEFAULT_PARAMS } from "../../types/project";
import { golfGreenRegion } from "../engine/turning.fixture";

/**
 * The benchmark corpus: a small, fixed set of canonical designs that exercise the
 * distinct stitch paths (flat tatami, concavity-aware fill, contour, turning,
 * satin, and multi-object routing). Deterministic geometry + ids so the baseline
 * is stable run-to-run and a metric delta means an engine change, not noise.
 */

const GREEN: ThreadColor = { id: "c-green", rgb: [64, 158, 52], name: "Green" };
const NAVY: ThreadColor = { id: "c-navy", rgb: [23, 58, 122], name: "Navy" };

function circle(cx: number, cy: number, r: number, n = 64, cw = false): Path {
  return Array.from({ length: n }, (_, i) => {
    const a = ((cw ? -1 : 1) * 2 * Math.PI * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function rect(x: number, y: number, w: number, h: number): Path {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Path {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function fillObject(id: string, paths: Path[], params: Partial<EmbObjectParams> = {}, colorId = GREEN.id): EmbObject {
  return { id, name: id, type: "fill", colorId, paths, params: { ...DEFAULT_PARAMS, ...params }, visible: true };
}

function satinObject(id: string, left: Path, right: Path, colorId = NAVY.id): EmbObject {
  return { id, name: id, type: "satin", colorId, paths: [left, right], params: { ...DEFAULT_PARAMS }, visible: true };
}

function project(name: string, objects: EmbObject[], colors: ThreadColor[] = [GREEN]): { name: string; project: Project } {
  return {
    name,
    project: {
      version: 1,
      widthMm: 100,
      heightMm: 100,
      hoop: { wMm: 100, hMm: 100, name: '4×4" (100×100)' },
      colors,
      objects,
    },
  };
}

const D = Math.PI / 180;

/** A 4×3 grid of centres listed in a scrambled (non-sequential) order, so the
 *  router has real travel to save — greedy nearest-neighbour leaves slack a 2-opt
 *  pass can recover. Shared by the cross-object and multi-region routing designs. */
const SCATTER_CENTERS: [number, number][] = [
  [51, 25], [24, 23], [34, 83], [13, 80], [22, 29], [33, 72],
  [43, 53], [81, 46], [26, 45], [76, 37], [31, 58], [20, 85],
];

export const CORPUS: { name: string; project: Project }[] = [
  // Flat solid fills — the baseline tatami path.
  project("rect-fill", [fillObject("rect", [rect(30, 38, 40, 24)], { fillStyle: "tatami", density: 0.4 })]),
  project("disc-fill-tatami", [fillObject("disc", [circle(50, 50, 18)], { fillStyle: "tatami", density: 0.4 })]),
  project("disc-fill-contour", [fillObject("disc", [circle(50, 50, 18)], { fillStyle: "contour", density: 0.4 })]),
  // Concavity: an annulus (fill with a hole) — rows must skip the hole, not slash it.
  project("ring-fill", [
    fillObject("ring", [circle(50, 50, 22), circle(50, 50, 9, 48, true)], { fillStyle: "tatami", density: 0.4 }),
  ]),
  // Curved band — should engage the turning fill (rows follow the arc).
  project("crescent-turning", [
    fillObject("crescent", [[...arc(50, 55, 40, 200 * D, 340 * D, 60), ...arc(50, 55, 26, 340 * D, 200 * D, 60)]], {
      fillStyle: "tatami",
      density: 0.4,
    }),
  ]),
  // Same crescent via the guidance-field fill — direct A/B against turning above.
  project("crescent-field", [
    fillObject("crescent", [[...arc(50, 55, 40, 200 * D, 340 * D, 60), ...arc(50, 55, 26, 340 * D, 200 * D, 60)]], {
      fillStyle: "field",
      density: 0.4,
    }),
  ]),
  // Real auto-traced concave silhouette (ellipse + ball hole + flagpole notch).
  project("golf-green", [fillObject("golf", golfGreenRegion, { fillStyle: "tatami", density: 0.4 })]),
  // Multi-object routing: two discs apart — exercises inter-object travel/sequencing.
  project("two-discs-routing", [
    fillObject("disc-a", [circle(28, 50, 12)], { fillStyle: "tatami", density: 0.4 }),
    fillObject("disc-b", [circle(72, 50, 12)], { fillStyle: "tatami", density: 0.4 }),
  ]),
  // A satin band — the column path with curvature compensation.
  project(
    "satin-band",
    [satinObject("band", arc(50, 50, 30, 200 * D, 340 * D, 40), arc(50, 50, 24, 200 * D, 340 * D, 40))],
    [NAVY],
  ),
  // Cross-object routing stress: 12 same-colour dots scattered across the hoop in a
  // deliberately non-sequential order. Exercises routeGroups (the design-level
  // object sequencer) — where the travel/trim numbers live.
  project(
    "scatter-dots",
    SCATTER_CENTERS.map(([cx, cy], i) =>
      fillObject(`dot-${i}`, [circle(cx, cy, 4)], { fillStyle: "tatami", density: 0.4 }),
    ),
  ),
  // Multi-region routing stress: ONE fill object whose 12 disconnected squares must
  // be ordered to minimise inter-region travel (exercises orderByTravel).
  project("multiregion-grid", [
    fillObject(
      "grid",
      SCATTER_CENTERS.map(([cx, cy]) => rect(cx - 4, cy - 4, 8, 8)),
      { fillStyle: "tatami", density: 0.4 },
    ),
  ]),
];
