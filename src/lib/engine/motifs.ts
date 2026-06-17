import type { Point } from "../../types/project";

/**
 * Decorative motif library for motif fills and carving. Each motif is one or
 * more open strokes (polylines) defined in a unit cell centered on the origin,
 * sized in mm at a base scale; the fill tiles + scales them across a region.
 * Pure data — no DOM.
 */

export interface Motif {
  id: string;
  name: string;
  /** base cell size in mm (used to derive aspect + default tiling step). */
  w: number;
  h: number;
  /** one or more polylines, centered on (0,0), spanning ~w×h. */
  strokes: Point[][];
}

/** A sine wave across one cell (3 humps), centered. */
function wave(w: number, h: number): Point[] {
  const pts: Point[] = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: (t - 0.5) * w, y: (Math.sin(t * Math.PI * 2) * h) / 2 });
  }
  return pts;
}

export const MOTIFS: Motif[] = [
  { id: "wave", name: "Wave", w: 4, h: 2, strokes: [wave(4, 2)] },
  {
    id: "chevron",
    name: "Chevron",
    w: 4,
    h: 3,
    strokes: [[{ x: -2, y: 1.5 }, { x: 0, y: -1.5 }, { x: 2, y: 1.5 }]],
  },
  {
    id: "diamond",
    name: "Diamond",
    w: 3.5,
    h: 3.5,
    strokes: [
      [
        { x: 0, y: -1.75 },
        { x: 1.75, y: 0 },
        { x: 0, y: 1.75 },
        { x: -1.75, y: 0 },
        { x: 0, y: -1.75 },
      ],
    ],
  },
  {
    id: "cross",
    name: "Cross",
    w: 3,
    h: 3,
    strokes: [
      [{ x: -1.5, y: 0 }, { x: 1.5, y: 0 }],
      [{ x: 0, y: -1.5 }, { x: 0, y: 1.5 }],
    ],
  },
];

export function motifById(id: string): Motif {
  return MOTIFS.find((m) => m.id === id) ?? MOTIFS[0];
}
