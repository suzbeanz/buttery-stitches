import type { Point } from "../../types/project";

/**
 * Decorative motif library for motif fills, motif runs, and carving. Each motif
 * is one or more open strokes (polylines) defined in a unit cell centered on the
 * origin, sized in mm at a base scale; the fill tiles + scales them across a
 * region. Pure data — no DOM.
 *
 * Motifs are grouped so the UI can present them sensibly:
 *   - line    — repeating band patterns (great as motif runs / decorative edges)
 *   - geo     — geometric tiles (great as tiled motif fills)
 *   - nature  — organic stamps (leaves, hearts, petals)
 */

export type MotifGroup = "line" | "geo" | "nature";

export interface Motif {
  id: string;
  name: string;
  group: MotifGroup;
  /** base cell size in mm (used to derive aspect + default tiling step). */
  w: number;
  h: number;
  /** one or more polylines, centered on (0,0), spanning ~w×h. */
  strokes: Point[][];
}

/** A sine wave across one cell (one full period), centered. */
function wave(w: number, h: number, periods = 1): Point[] {
  const pts: Point[] = [];
  const n = 24 * periods;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: (t - 0.5) * w, y: (Math.sin(t * Math.PI * 2 * periods) * h) / 2 });
  }
  return pts;
}

/** A row of semicircular scallops (candlewicking classic), centered. */
function scallops(w: number, h: number, count = 2): Point[] {
  const pts: Point[] = [];
  const seg = w / count;
  const r = seg / 2;
  const steps = 10;
  for (let c = 0; c < count; c++) {
    const cx = -w / 2 + seg * (c + 0.5);
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI - (i / steps) * Math.PI; // left→right along the bump top
      pts.push({ x: cx + Math.cos(a) * r, y: h / 2 - Math.sin(a) * h });
    }
  }
  return pts;
}

/** A sawtooth zigzag across one cell. */
function zigzag(w: number, h: number, teeth = 2): Point[] {
  const pts: Point[] = [];
  const n = teeth * 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: (t - 0.5) * w, y: (i % 2 === 0 ? -h : h) / 2 });
  }
  return pts;
}

/** A closed regular star (2·points vertices, outer/inner radii). */
function star(points: number, outer: number, inner: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** A leaf/petal: two mirrored arcs meeting at a point at each end. */
function leaf(w: number, h: number): Point[] {
  const pts: Point[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: (t - 0.5) * w, y: (Math.sin(t * Math.PI) * h) / 2 });
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: (0.5 - t) * w, y: (-Math.sin((1 - t) * Math.PI) * h) / 2 });
  }
  return pts;
}

/** A closed heart outline. */
function heart(w: number, h: number): Point[] {
  const pts: Point[] = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push({ x: (x / 32) * w, y: (-y / 30) * h });
  }
  return pts;
}

export const MOTIFS: Motif[] = [
  // ── line / band patterns ──────────────────────────────────────────────
  { id: "wave", name: "Wave", group: "line", w: 4, h: 2, strokes: [wave(4, 2)] },
  {
    id: "chevron",
    name: "Chevron",
    group: "line",
    w: 4,
    h: 3,
    strokes: [[{ x: -2, y: 1.5 }, { x: 0, y: -1.5 }, { x: 2, y: 1.5 }]],
  },
  { id: "zigzag", name: "Zigzag", group: "line", w: 4, h: 2.5, strokes: [zigzag(4, 2.5, 2)] },
  { id: "scallop", name: "Scallop", group: "line", w: 5, h: 2.2, strokes: [scallops(5, 2.2, 2)] },
  {
    id: "greekkey",
    name: "Greek key",
    group: "line",
    w: 5,
    h: 4,
    strokes: [
      [
        { x: -2.5, y: 2 },
        { x: -2.5, y: -2 },
        { x: 1, y: -2 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
        { x: -1, y: -0.5 },
        { x: 0, y: -0.5 },
      ],
    ],
  },
  // ── geometric tiles ───────────────────────────────────────────────────
  {
    id: "diamond",
    name: "Diamond",
    group: "geo",
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
    group: "geo",
    w: 3,
    h: 3,
    strokes: [
      [{ x: -1.5, y: 0 }, { x: 1.5, y: 0 }],
      [{ x: 0, y: -1.5 }, { x: 0, y: 1.5 }],
    ],
  },
  {
    id: "asterisk",
    name: "Asterisk",
    group: "geo",
    w: 3,
    h: 3,
    strokes: [
      [{ x: -1.5, y: 0 }, { x: 1.5, y: 0 }],
      [{ x: 0, y: -1.5 }, { x: 0, y: 1.5 }],
      [{ x: -1.06, y: -1.06 }, { x: 1.06, y: 1.06 }],
      [{ x: -1.06, y: 1.06 }, { x: 1.06, y: -1.06 }],
    ],
  },
  {
    id: "square",
    name: "Square",
    group: "geo",
    w: 3,
    h: 3,
    strokes: [
      [
        { x: -1.5, y: -1.5 },
        { x: 1.5, y: -1.5 },
        { x: 1.5, y: 1.5 },
        { x: -1.5, y: 1.5 },
        { x: -1.5, y: -1.5 },
      ],
    ],
  },
  {
    id: "hexagon",
    name: "Hexagon",
    group: "geo",
    w: 3.4,
    h: 3,
    strokes: [
      Array.from({ length: 7 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return { x: Math.cos(a) * 1.7, y: Math.sin(a) * 1.7 };
      }),
    ],
  },
  { id: "star", name: "Star", group: "geo", w: 3.6, h: 3.6, strokes: [star(5, 1.8, 0.75)] },
  // ── nature / organic stamps ───────────────────────────────────────────
  { id: "leaf", name: "Leaf", group: "nature", w: 4, h: 2, strokes: [leaf(4, 2)] },
  { id: "heart", name: "Heart", group: "nature", w: 3, h: 3, strokes: [heart(3, 3)] },
  {
    id: "sprig",
    name: "Sprig",
    group: "nature",
    w: 3,
    h: 4,
    strokes: [
      [{ x: 0, y: 2 }, { x: 0, y: -2 }],
      [{ x: 0, y: -0.5 }, { x: 1.2, y: -1.6 }],
      [{ x: 0, y: -0.5 }, { x: -1.2, y: -1.6 }],
      [{ x: 0, y: 0.6 }, { x: 1.2, y: -0.5 }],
      [{ x: 0, y: 0.6 }, { x: -1.2, y: -0.5 }],
    ],
  },
];

export function motifById(id: string): Motif {
  return MOTIFS.find((m) => m.id === id) ?? MOTIFS[0];
}

/** Motifs grouped for a sectioned picker (line / geo / nature), in list order. */
export function motifsByGroup(): { group: MotifGroup; label: string; motifs: Motif[] }[] {
  const labels: Record<MotifGroup, string> = {
    line: "Bands & lines",
    geo: "Geometric",
    nature: "Nature",
  };
  const order: MotifGroup[] = ["line", "geo", "nature"];
  return order.map((group) => ({
    group,
    label: labels[group],
    motifs: MOTIFS.filter((m) => m.group === group),
  }));
}
