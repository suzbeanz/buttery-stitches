import type { QuantizedImage, RasterImage } from "./quantize";
import type { Tracedata } from "./index";
import { fitClosedPolyline, type FitOptions } from "./fitcurve";

/**
 * FIRST-PARTY boundary extractor — replaces imagetracerjs for raster tracing.
 *
 * Works directly on the quantizer's denoised LABEL MAP (no flatten → re-segment
 * round trip) by walking the crack lattice: the unit edges between unlike
 * labels. Two properties imagetracerjs cannot give us fall out of the
 * construction:
 *
 *  1. SHARED BOUNDARIES. Where two colors meet, both regions' rings pass
 *     through the exact same lattice vertices (and the same subpixel-snapped
 *     positions — the snap cache is keyed by vertex). Adjacent fills can never
 *     trace apart, so the hairline-gap class of defects dies at the source
 *     instead of being patched downstream by weld/underlap.
 *
 *  2. SUBPIXEL EDGES. The quantizer destroys anti-aliasing; the original
 *     image still holds it. Each boundary vertex is slid along the local edge
 *     normal to where the source actually crosses halfway between the two
 *     region colors — recovering edge positions to a fraction of a pixel.
 *
 * Output is `Tracedata`-shaped (layers per palette index, paths of line
 * segments, isholepath/holechildren) so the entire downstream classification
 * pipeline in `tracedataToObjects` — the hard-won stroke/network/halo
 * heuristics — consumes it unchanged.
 *
 * Everything is deterministic: scan order fixes component order, the
 * right-turn policy fixes loop orientation (outers clockwise in y-down screen
 * coordinates, holes counter-clockwise), and the snap cache fixes shared
 * vertices.
 */

interface TraceSegment {
  type: "L";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface NativeTracePath {
  segments: TraceSegment[];
  isholepath: boolean;
  holechildren: number[];
}

/** Longest exactly-collinear crack run merged into one segment (px). Bounded so
 *  a gentle curve that produces long straight runs keeps enough vertices for
 *  the subpixel snap to bend it (chord sagitta at this spacing is well under
 *  half a pixel at any radius the quantizer can represent). */
const MAX_RUN_PX = 4;
/** Subpixel snap sample offsets along the edge normal (px). ±1.5 px covers a
 *  1-px anti-alias band on either side of the lattice edge. */
const SNAP_OFFSETS = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5];
/** Max vertex displacement from the lattice position (px). */
const SNAP_CLAMP_PX = 1;
/** Below this alpha a source sample reads as transparent (matches quantize). */
const ALPHA_CUTOFF = 128;

/** Directions: 0=E, 1=S, 2=W, 3=N (y grows downward). */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

interface Loop {
  /** lattice vertices, closed implicitly (last ≠ first). */
  xs: number[];
  ys: number[];
  /** label across the crack from the component, per vertex (the OUTSIDE label
   *  of the edge arriving at this vertex); −1 = transparent/off-canvas. */
  outside: number[];
  /** twice the signed shoelace area; > 0 = outer ring, < 0 = hole. */
  area2: number;
}

/**
 * Trace a label map into Tracedata. `source` is the same-size pre-quantization
 * image used for subpixel edge recovery (pass null to skip snapping — e.g. for
 * hard-edged sources where there is no anti-aliasing to read).
 */
export function traceLabelMap(
  flat: QuantizedImage,
  source: RasterImage | null,
  opts: {
    pathomitPx?: number;
    /** Curve-fitting options; components whose hole-aware wall width falls
     *  below `minFitWallPx` SKIP fitting and keep the raw snapped cracks —
     *  thin stroke networks (2–3 mm walls) are exactly where the corner
     *  window straddles the opposite wall corner, corners get missed, and
     *  the fitted (shorter) perimeter flips the downstream network/stroke
     *  classification into a solid fill. Raw staircase perimeter is the
     *  CONSERVATIVE direction for that classification, and the medial
     *  skeletonizer rasterizes the region anyway, so thin components lose
     *  nothing by staying raw. */
    fit?: Omit<FitOptions, "forced"> & { minFitWallPx?: number };
  } = {},
): Tracedata {
  const { width, height, palette } = flat;
  const pathomitPx = opts.pathomitPx ?? 8;
  const labels = flat.labels ?? labelsFromFlat(flat);
  const total = width * height;

  // --- connected components (4-connectivity, same label, label ≥ 0) ---
  const comp = new Int32Array(total).fill(-1);
  const compLabel: number[] = [];
  {
    const stack: number[] = [];
    for (let seed = 0; seed < total; seed++) {
      if (comp[seed] !== -1 || labels[seed] < 0) continue;
      const label = labels[seed];
      const id = compLabel.length;
      compLabel.push(label);
      comp[seed] = id;
      stack.push(seed);
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % width;
        const y = (i / width) | 0;
        if (x > 0 && comp[i - 1] === -1 && labels[i - 1] === label) { comp[i - 1] = id; stack.push(i - 1); }
        if (x < width - 1 && comp[i + 1] === -1 && labels[i + 1] === label) { comp[i + 1] = id; stack.push(i + 1); }
        if (y > 0 && comp[i - width] === -1 && labels[i - width] === label) { comp[i - width] = id; stack.push(i - width); }
        if (y < height - 1 && comp[i + width] === -1 && labels[i + width] === label) { comp[i + width] = id; stack.push(i + width); }
      }
    }
  }

  const inComp = (x: number, y: number, id: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && comp[y * width + x] === id;
  const labelAt = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < width && y < height ? labels[y * width + x] : -1;

  // Directed-crack visited set: 4 bits per lattice vertex (one per out-direction).
  const vCols = width + 1;
  const visited = new Uint8Array(vCols * (height + 1));

  /** Walk one crack loop starting at lattice vertex (sx,sy) heading `sdir`,
   *  keeping component `id` on the RIGHT. Right-turn policy on ambiguous
   *  (diagonal) corners keeps 4-connected components cleanly separated. The
   *  walk ends when it returns to the starting vertex heading the starting
   *  direction (a loop may legitimately pass through a pinch vertex twice with
   *  different headings). */
  const walkLoop = (sx: number, sy: number, sdir: number, id: number): Loop => {
    const xs: number[] = [];
    const ys: number[] = [];
    const outside: number[] = [];
    let x = sx;
    let y = sy;
    let dir = sdir;
    let area2 = 0;
    let first = true;
    for (;;) {
      if (!first && x === sx && y === sy && dir === sdir) break;
      first = false;
      // The pixel pair flanking the edge we would traverse next, relative to
      // travel direction: RIGHT must stay inside the component.
      // For dir E (v→v+(1,0)): left pixel (x, y-1), right pixel (x, y).
      // Rotations of that frame give the other directions.
      let lx: number, ly: number, rx: number, ry: number;
      if (dir === 0) { lx = x; ly = y - 1; rx = x; ry = y; }
      else if (dir === 1) { lx = x; ly = y; rx = x - 1; ry = y; }
      else if (dir === 2) { lx = x - 1; ly = y; rx = x - 1; ry = y - 1; }
      else { lx = x - 1; ly = y - 1; rx = x; ry = y - 1; }
      const leftIn = inComp(lx, ly, id);
      const rightIn = inComp(rx, ry, id);
      if (!rightIn) {
        dir = (dir + 1) & 3; // right turn (also resolves the diagonal case)
        continue;
      }
      if (leftIn) {
        dir = (dir + 3) & 3; // left turn
        continue;
      }
      // Straight: traverse the edge. Mark it visited (only traversed edges —
      // a mark on a merely-considered edge would suppress another component's
      // seed) and record the departure vertex + the OUTSIDE (left) label.
      visited[y * vCols + x] |= 1 << dir;
      xs.push(x);
      ys.push(y);
      outside.push(labelAt(lx, ly));
      const nx = x + DX[dir];
      const ny = y + DY[dir];
      area2 += x * ny - nx * y;
      x = nx;
      y = ny;
    }
    return { xs, ys, outside, area2 };
  };

  // Collect loops per component. Seeds: every horizontal boundary crack, seen
  // as the top edge (walk E, inside below) or bottom edge (walk W, inside
  // above) of a component pixel — every closed loop contains at least one.
  const compLoops: Loop[][] = compLabel.map(() => []);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = comp[y * width + x];
      if (id < 0) continue;
      if (!inComp(x, y - 1, id) && !(visited[y * vCols + x] & 1)) {
        compLoops[id].push(walkLoop(x, y, 0, id));
      }
      if (!inComp(x, y + 1, id) && !(visited[(y + 1) * vCols + (x + 1)] & (1 << 2))) {
        compLoops[id].push(walkLoop(x + 1, y + 1, 2, id));
      }
    }
  }

  // --- subpixel snap cache (per lattice vertex, shared across components) ---
  const snap = source ? makeSnapper(flat, labels, source) : null;
  // A vertex where 3+ labels meet (off-canvas counts as one) is a JUNCTION:
  // it must stay put through snapping AND smoothing on every ring that passes
  // through it, or shared boundaries would pull apart at exactly the points
  // where three fills meet.
  const isJunction = (vx: number, vy: number): boolean => {
    const around = new Set([
      labelAt(vx - 1, vy - 1),
      labelAt(vx, vy - 1),
      labelAt(vx - 1, vy),
      labelAt(vx, vy),
    ]);
    return around.size > 2;
  };

  // --- assemble Tracedata ---
  const layers: NativeTracePath[][] = palette.map(() => []);
  for (let id = 0; id < compLoops.length; id++) {
    const loops = compLoops[id];
    if (loops.length === 0) continue;
    const label = compLabel[id];
    const layer = layers[label];
    // One outer (area2 > 0) per component; the rest are holes.
    const outer = loops.find((l) => l.area2 > 0);
    if (!outer || perimeterOf(outer) < pathomitPx) continue; // despeckled
    const holes = loops.filter((l) => l !== outer && perimeterOf(l) >= pathomitPx);
    // Thin-component fit opt-out (see the opts.fit doc above): hole-aware wall
    // width from the component's own raw loops, in px.
    let fit = opts.fit;
    if (fit?.minFitWallPx) {
      const aOuter = outer.area2 / 2;
      const aHoles = loops
        .filter((l) => l.area2 < 0)
        .reduce((s, l) => s + Math.abs(l.area2) / 2, 0);
      const pAll = loops.reduce((s, l) => s + perimeterOf(l), 0);
      const wallPx = (2 * Math.max(0, aOuter - aHoles)) / Math.max(1, pAll);
      if (wallPx < fit.minFitWallPx) fit = undefined;
    }
    const holechildren: number[] = [];
    layer.push({
      segments: loopToSegments(outer, snap, isJunction, fit),
      isholepath: false,
      holechildren,
    });
    for (const h of holes) {
      holechildren.push(layer.length);
      layer.push({
        segments: loopToSegments(h, snap, isJunction, fit),
        isholepath: true,
        holechildren: [],
      });
    }
  }

  return {
    layers: layers as unknown as Tracedata["layers"],
    palette: palette.map(([r, g, b]) => ({ r, g, b, a: 255 })),
    width,
    height,
  };
}

/** Rebuild the label map from a flattened image by exact palette match (used
 *  when the quantizer didn't hand its labels over). */
function labelsFromFlat(flat: QuantizedImage): Int16Array {
  const { width, height, data, palette } = flat;
  const byRgb = new Map<number, number>();
  palette.forEach(([r, g, b], i) => {
    const key = (r << 16) | (g << 8) | b;
    if (!byRgb.has(key)) byRgb.set(key, i);
  });
  const labels = new Int16Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    labels[i] =
      data[o + 3] < ALPHA_CUTOFF
        ? -1
        : byRgb.get((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]) ?? -1;
  }
  return labels;
}

function perimeterOf(loop: Loop): number {
  return loop.xs.length; // unit cracks — vertex count IS the path length in px
}

/**
 * Compress exactly-collinear crack runs (bounded at {@link MAX_RUN_PX}), snap
 * each surviving vertex, optionally fit the ring with least-squares cubics
 * (junctions as forced breakpoints, so shared sections fit identically on
 * both sides), and emit line segments.
 */
function loopToSegments(
  loop: Loop,
  snap: Snapper | null,
  isJunction: (vx: number, vy: number) => boolean,
  fit?: Omit<FitOptions, "forced">,
): TraceSegment[] {
  const n = loop.xs.length;
  // Keep a vertex when direction changes, the run hits the cap, or the outside
  // label changes (a tri-color corner must stay a hard vertex on both rings).
  const keep: number[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const px = loop.xs[(i - 1 + n) % n];
    const py = loop.ys[(i - 1 + n) % n];
    const cx = loop.xs[i];
    const cy = loop.ys[i];
    const nx = loop.xs[(i + 1) % n];
    const ny = loop.ys[(i + 1) % n];
    const straight = nx - cx === cx - px && ny - cy === cy - py;
    const sameOutside = loop.outside[i] === loop.outside[(i - 1 + n) % n];
    if (!straight || !sameOutside || run >= MAX_RUN_PX) {
      keep.push(i);
      run = 0;
    } else {
      run++;
    }
  }
  if (keep.length < 3) return [];

  const junction = keep.map((i) => isJunction(loop.xs[i], loop.ys[i]));
  let pts = keep.map((i, k) => {
    const vx = loop.xs[i];
    const vy = loop.ys[i];
    // Junction vertices (3+ labels) stay on the lattice even when snapping —
    // every ring passing through them must agree exactly.
    return snap && !junction[k] ? snap(vx, vy) : { x: vx, y: vy };
  });
  if (fit) pts = fitClosedPolyline(pts, { ...fit, forced: junction });
  const segs: TraceSegment[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    segs.push({ type: "L", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return segs;
}

type Snapper = (vx: number, vy: number) => { x: number; y: number };

/**
 * Build the per-vertex subpixel snapper. Positions are computed once per
 * lattice vertex and cached, so the two regions sharing a boundary get the
 * IDENTICAL snapped polyline — the shared-boundary guarantee survives the snap.
 *
 * At a vertex between exactly two labels, the original image is sampled along
 * the edge normal; each sample's color is projected onto the axis between the
 * two region colors, and the vertex slides to the 50% crossing (the true edge
 * the quantizer rounded away). Vertices where 3+ labels meet stay on the
 * lattice — there is no two-color axis to project on.
 */
function makeSnapper(
  flat: QuantizedImage,
  labels: Int16Array,
  source: RasterImage,
): Snapper {
  const { width, height, palette } = flat;
  const vCols = width + 1;
  const cacheX = new Float32Array(vCols * (height + 1)).fill(NaN);
  const cacheY = new Float32Array(vCols * (height + 1));

  const labelAt = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < width && y < height ? labels[y * width + x] : -1;

  /** Bilinear RGBA sample of the source at a continuous px position. */
  const sample = (x: number, y: number): [number, number, number, number] => {
    const fx = Math.min(source.width - 1, Math.max(0, x - 0.5));
    const fy = Math.min(source.height - 1, Math.max(0, y - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(source.width - 1, x0 + 1);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [sx, sy, w] of [
      [x0, y0, (1 - tx) * (1 - ty)],
      [x1, y0, tx * (1 - ty)],
      [x0, y1, (1 - tx) * ty],
      [x1, y1, tx * ty],
    ] as const) {
      const o = (sy * source.width + sx) * 4;
      const av = source.data[o + 3] / 255;
      r += source.data[o] * av * w;
      g += source.data[o + 1] * av * w;
      b += source.data[o + 2] * av * w;
      a += av * w;
    }
    return a > 1e-4 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0];
  };

  return (vx: number, vy: number) => {
    const ci = vy * vCols + vx;
    if (!Number.isNaN(cacheX[ci])) return { x: cacheX[ci], y: cacheY[ci] };

    // The (up to) four pixels around this lattice vertex decide the local edge.
    const around = [
      labelAt(vx - 1, vy - 1),
      labelAt(vx, vy - 1),
      labelAt(vx - 1, vy),
      labelAt(vx, vy),
    ];
    const distinct = [...new Set(around)];
    let out = { x: vx, y: vy };
    if (distinct.length === 2) {
      const [A, B] = distinct;
      // Edge normal from the 2×2 configuration: gradient of "is label A".
      const isA = around.map((l) => (l === A ? 1 : 0));
      const gx = isA[1] + isA[3] - isA[0] - isA[2];
      const gy = isA[2] + isA[3] - isA[0] - isA[1];
      const gl = Math.hypot(gx, gy);
      if (gl > 1e-6) {
        const nx = gx / gl;
        const ny = gy / gl;
        // Fraction-of-A along the normal at each offset: 1 deep inside A,
        // 0 deep inside B. Transparent (−1) reads through alpha. The axis
        // endpoints are the palette (cluster-mean) colors: blend pixels pull
        // cluster means slightly toward each other, so this reference carries
        // a sub-0.05 mm systematic edge bias — but it is the SAME reference
        // the quantizer, the legacy tracer, and the fidelity metric use, and
        // the bias is far below stitch-visible scale. (Measured: swapping in
        // locally-sampled deep-side colors lands areas closer to geometric
        // truth but scores worse against the shared reference.)
        const cA = A >= 0 ? palette[A] : null;
        const cB = B >= 0 ? palette[B] : null;
        const fracA = (o: number): number => {
          const [r, g, b, a] = sample(vx + nx * o, vy + ny * o);
          if (!cA) return 1 - a; // A transparent: fully A where alpha is 0
          if (!cB) return a; // B transparent
          const ax = cB[0] - cA[0];
          const ay = cB[1] - cA[1];
          const az = cB[2] - cA[2];
          const len2 = ax * ax + ay * ay + az * az;
          if (len2 < 1e-6) return 0.5;
          const t = ((r - cA[0]) * ax + (g - cA[1]) * ay + (b - cA[2]) * az) / len2;
          return 1 - Math.min(1, Math.max(0, t));
        };
        const vals = SNAP_OFFSETS.map(fracA);
        // Find the 0.5 crossing nearest the lattice vertex (offset 0) —
        // direction-agnostic, so both traversal orders agree.
        let best: number | null = null;
        for (let i = 1; i < vals.length; i++) {
          const a = vals[i - 1] - 0.5;
          const b = vals[i] - 0.5;
          if (a === 0) best = pick(best, SNAP_OFFSETS[i - 1]);
          if (a * b < 0) {
            const t = a / (a - b);
            best = pick(best, SNAP_OFFSETS[i - 1] + t * (SNAP_OFFSETS[i] - SNAP_OFFSETS[i - 1]));
          }
        }
        if (best !== null) {
          const d = Math.min(SNAP_CLAMP_PX, Math.max(-SNAP_CLAMP_PX, best));
          // The normal points from B toward A (gradient of is-A); crossing at
          // +d means the true edge sits that far along the normal.
          out = { x: vx + nx * d, y: vy + ny * d };
        }
      }
    }
    cacheX[ci] = out.x;
    cacheY[ci] = out.y;
    return out;
  };
}

function pick(current: number | null, candidate: number): number {
  return current === null || Math.abs(candidate) < Math.abs(current) ? candidate : current;
}
