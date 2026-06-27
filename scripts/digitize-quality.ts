import { imageDataToObjects } from "../src/lib/trace";
import type { EmbObject, Path, Point } from "../src/types/project";

/**
 * Digitize-quality harness: run representative FLAT-IMAGE cases through the real
 * trace→digitize pipeline and print objective "smooth & simple" metrics, so we
 * can see where auto-digitizing flat clip-art still comes out clumsy and measure
 * any fix (the digitize-side analogue of `npm run bench`).
 *
 *   vite-node scripts/digitize-quality.ts
 *
 * Metrics per design:
 *   regions      — object count (fewer = simpler; slivers inflate this)
 *   nodes        — total path vertices (fewer = simpler/smoother)
 *   nodes/10mm   — vertex density along the outline (lower = smoother)
 *   meanTurn°    — average turn angle at a vertex (lower = smoother curve)
 *   maxTurn°     — worst single kink (spikes = a jagged/clumsy edge)
 *   slivers      — objects under 2mm² (noise the user has to clean up)
 */

const W = 256;
const H = 256;
/** ~80mm across — a realistic small motif in a 4" hoop. */
const MM_PER_PX = 80 / W;

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [10, 10, 10];
const RED: RGB = [200, 40, 40];
const BLUE: RGB = [40, 70, 200];

/** Build an RGBA ImageData-like buffer; `paint(x,y)` returns the pixel color. */
function makeImage(paint: (x: number, y: number) => RGB): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H, colorSpace: "srgb" } as unknown as ImageData;
}

const cx = W / 2;
const cy = H / 2;
const dist = (x: number, y: number) => Math.hypot(x - cx, y - cy);

/** Filled ring (a donut / letter "O") — a black annulus with a white hole. */
const donut = makeImage((x, y) => {
  const d = dist(x, y);
  return d <= 100 && d >= 45 ? BLACK : WHITE;
});

/** Thin circular outline — a stroke, not a fill (tests centerline smoothness). */
const ring = makeImage((x, y) => (Math.abs(dist(x, y) - 90) <= 3.5 ? BLACK : WHITE));

/** Five-point star — sharp convex/concave corners that must stay crisp while the
 *  straight edges between them come out smooth (not faceted). */
const star = makeImage((x, y) => (inStar(x, y) ? BLACK : WHITE));
function inStar(x: number, y: number): boolean {
  const pts: Point[] = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? 110 : 45;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pointInPolygon({ x, y }, pts);
}

/** Two adjacent color blobs on white — tests region separation without a sliver
 *  of stray color forming along the seam. */
const blobs = makeImage((x, y) => {
  if (Math.hypot(x - cx * 0.62, y - cy) <= 62) return RED;
  if (Math.hypot(x - cx * 1.38, y - cy) <= 62) return BLUE;
  return WHITE;
});

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// --- metrics ---------------------------------------------------------------

const len = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function perimeter(ring: Path): number {
  let s = 0;
  for (let i = 1; i < ring.length; i++) s += len(ring[i], ring[i - 1]);
  if (ring.length > 2) s += len(ring[ring.length - 1], ring[0]);
  return s;
}
function shoelaceArea(ring: Path): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return Math.abs(a) / 2;
}
/** Turn angles (deg) at each interior vertex of a closed ring. */
function turns(ring: Path): number[] {
  const out: number[] = [];
  const n = ring.length;
  if (n < 3) return out;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    if (m1 < 1e-6 || m2 < 1e-6) continue;
    let cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
    cos = Math.max(-1, Math.min(1, cos));
    out.push((Math.acos(cos) * 180) / Math.PI);
  }
  return out;
}

interface Metrics {
  regions: number;
  holes: number;
  nodes: number;
  perimMm: number;
  meanTurn: number;
  maxTurn: number;
  slivers: number;
}

function measure(objects: EmbObject[]): Metrics {
  let nodes = 0;
  let perim = 0;
  let holes = 0;
  let slivers = 0;
  const allTurns: number[] = [];
  for (const o of objects) {
    o.paths.forEach((ring, idx) => {
      nodes += ring.length;
      perim += perimeter(ring);
      if (idx > 0) holes++;
      if (shoelaceArea(ring) < 2 && idx === 0) slivers++;
      allTurns.push(...turns(ring));
    });
  }
  const meanTurn = allTurns.length ? allTurns.reduce((a, b) => a + b, 0) / allTurns.length : 0;
  const maxTurn = allTurns.length ? Math.max(...allTurns) : 0;
  return {
    regions: objects.length,
    holes,
    nodes,
    perimMm: perim,
    meanTurn,
    maxTurn,
    slivers,
  };
}

// --- run -------------------------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;
const cases: { name: string; img: ImageData; colors: number }[] = [
  { name: "donut (hole)", img: donut, colors: 2 },
  { name: "ring (stroke)", img: ring, colors: 2 },
  { name: "star (corners)", img: star, colors: 2 },
  { name: "two-blobs", img: blobs, colors: 3 },
];

const VALID = ["smooth", "balanced", "detailed"] as const;
const detail = (VALID.find((d) => process.argv.includes(d)) ?? "balanced");
console.log(`\nDigitize quality — detail="${detail}", ${W}×${H}px @ ${r1(MM_PER_PX * 100) / 100}mm/px\n`);
console.log(
  ["case".padEnd(16), "regions", "holes", "nodes", "nd/10mm", "meanTurn°", "maxTurn°", "slivers"].join("  "),
);
for (const c of cases) {
  const objects = imageDataToObjects(c.img, c.colors, {
    mmPerPx: MM_PER_PX,
    removeBackground: true,
    detail,
  }).objects;
  const m = measure(objects);
  const ndPer10 = m.perimMm > 0 ? (m.nodes / m.perimMm) * 10 : 0;
  console.log(
    [
      c.name.padEnd(16),
      String(m.regions).padStart(7),
      String(m.holes).padStart(5),
      String(m.nodes).padStart(5),
      r1(ndPer10).toString().padStart(7),
      r1(m.meanTurn).toString().padStart(9),
      r1(m.maxTurn).toString().padStart(8),
      String(m.slivers).padStart(7),
    ].join("  "),
  );
}
console.log("");

// --- per-object probe (debug): vite-node scripts/digitize-quality.ts probe ---
if (process.argv.includes("probe")) {
  for (const c of cases) {
    const objects = imageDataToObjects(c.img, c.colors, { mmPerPx: MM_PER_PX, removeBackground: true, detail }).objects;
    console.log(`\n# ${c.name}: ${objects.length} objects`);
    objects.forEach((o, i) => {
      const areas = o.paths.map((r) => Math.round(shoelaceArea(r)));
      console.log(`  [${i}] type=${o.type} rings=${o.paths.length} nodes=${o.paths.map(r=>r.length).join("+")} area(mm²)=${areas.join(",")} rgb=${o.colorId}`);
    });
  }
}
