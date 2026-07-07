/**
 * VECTOR (SVG) regression corpus — the certainty wall for the import path.
 *
 * The SVG importer's first ship corrupted a real crest because it was validated
 * only on synthetic squares. These fixtures are shaped like the real thing —
 * z-ordered painted halves, same-colour shapes overlapping a base, stroked
 * linework, stacked small letters — so a defect that mangles actual artwork
 * fails HERE, in CI, instead of in a user's export. The fixtures are the
 * FLATTENED shapes (SvgShape[]) the browser parse layer produces, so the whole
 * pure import → engine chain is exercised without a DOM.
 */
import type { SvgShape } from "../trace/svgImport";

export interface SvgCorpusEntry {
  name: string;
  shapes: SvgShape[];
  contentW: number;
  contentH: number;
  /** what the fixture proves. */
  note: string;
}

/** A rectangle ring in user units. */
function rect(x: number, y: number, w: number, h: number) {
  return [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ];
}

/** A crest-shaped shield outline (rounded point at the bottom). */
function shield(cx: number, top: number, w: number, h: number) {
  const l = cx - w / 2, r = cx + w / 2;
  const pts = [];
  pts.push({ x: l, y: top });
  pts.push({ x: r, y: top });
  pts.push({ x: r, y: top + h * 0.6 });
  // Curve to a point.
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    pts.push({ x: r - (w / 2) * t, y: top + h * 0.6 + (h * 0.4) * Math.sin((t * Math.PI) / 2) });
  }
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    pts.push({ x: cx - (w / 2) * t, y: top + h - (h * 0.4) * Math.sin((t * Math.PI) / 2) });
  }
  return pts;
}

const NAVY: [number, number, number] = [10, 31, 60];
const RED: [number, number, number] = [221, 29, 84];
const WHITE: [number, number, number] = [255, 255, 255];

export const SVG_CORPUS: SvgCorpusEntry[] = [
  {
    name: "crest-halves-stripes",
    note: "Navy shield, red half PAINTED on top, two same-colour navy stripes over it, a white letter block. Proves paint order and that overlaps never punch parity holes.",
    contentW: 180,
    contentH: 240,
    shapes: [
      { rings: [shield(90, 8, 170, 230)], fill: NAVY }, // full navy shield
      { rings: [rect(90, 8, 85, 230)], fill: RED }, // right half painted over
      { rings: [rect(20, 120, 120, 12)], fill: NAVY }, // stripe over shield
      { rings: [rect(30, 150, 120, 12)], fill: NAVY }, // second stripe
      { rings: [rect(150, 60, 12, 30)], fill: WHITE }, // letter block on the red
    ],
  },
  {
    name: "crest-stroked-arch",
    note: "A shield with an ARCH drawn as a stroked path (no fill). Proves stroked linework imports as satin instead of vanishing.",
    contentW: 180,
    contentH: 240,
    shapes: [
      { rings: [shield(90, 8, 170, 230)], fill: NAVY },
      {
        rings: [],
        fill: NAVY,
        stroke: {
          centerlines: [[
            { x: 40, y: 200 }, { x: 60, y: 120 }, { x: 90, y: 70 }, { x: 120, y: 120 }, { x: 140, y: 200 },
          ]],
          widthUnits: 8,
          closed: [false],
        },
      },
    ],
  },
  {
    name: "letters-stacked",
    note: "A word of small white letter blocks over a red panel. Proves small stacked shapes each stay their own object (no cross-letter parity holes) and survive.",
    contentW: 120,
    contentH: 60,
    shapes: [
      { rings: [rect(0, 0, 120, 60)], fill: RED },
      ...[10, 30, 50, 70, 90].map((x) => ({ rings: [rect(x, 15, 10, 30)], fill: WHITE })),
    ],
  },
];
