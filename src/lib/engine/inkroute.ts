import type { Path, Point } from "../../types/project";
import { runningStitch } from "./running";

/**
 * Graph-native routing for a LINE-ART stroke network.
 *
 * The professional reference files sew a whole ink network as ONE connected
 * pass: the thread walks branch to branch ALONG the strokes, doubling back
 * over already-sewn centerline where it must, and only cuts for genuinely
 * separate islands (a Wilcom production sheet lists 12 trims for a 13,565-
 * stitch design; our raster-router ordering produced 76 on a comparable
 * cartoon). Euclidean nearest-first ordering is what breaks it: consecutive
 * columns can sit 20mm apart across the figure, too far for the buried A*
 * to thread reliably down a 0.7mm-wide stroke.
 *
 * This router works on the medial skeleton itself. Every column's centerline
 * is sampled into a navigation graph; samples of DIFFERENT columns that pass
 * within a junction tolerance are glued (T-junction endpoints land mid-branch,
 * measured q75 = 0.98mm on the reference cartoon, so gluing endpoint-to-line
 * is required — endpoint clustering alone misses tees). Pieces are then sewn
 * greedily by NETWORK distance, and each hop between pieces is emitted as an
 * explicit running connector down the skeleton path — always on the ink, so
 * the satin sewn over those same centerlines (before or after) buries it.
 * Pieces with no network path (true islands) start fresh; the assembler's
 * trim ladder handles that gap exactly as before.
 */

/** One sewable piece: the rendered stitches plus the centerline it rides. */
export interface InkPiece {
  top: Path;
  centerline: Path;
  /** Stroke width for pieces that carry their column's measurement (used by the
   *  caller to decide underlay); the router itself ignores it. */
  widthMm?: number;
}

/** Nav-graph sampling pitch along centerlines (mm). */
const NAV_SAMPLE_MM = 1.0;
/** Glue radius joining samples of different pieces at junctions (mm). A tee's
 *  branch endpoint sits up to ~1.2mm off the crossing bar's centerline after
 *  regularized smoothing; beyond ~1.5mm two parallel strokes could false-join
 *  and the connector would hop bare fabric. */
const NAV_GLUE_MM = 1.4;
/** Connectors shorter than this are skipped — the assembler continues with a
 *  plain stitch across a sub-jump gap anyway. */
const MIN_CONNECTOR_MM = 1.5;
/** Euclidean prefilter: only the nearest K unsewn pieces get a network-distance
 *  check per step (the greedy walk is O(pieces × dijkstra) otherwise). */
const CANDIDATE_K = 6;

interface NavNode {
  x: number;
  y: number;
  piece: number;
  /** neighbor node index → edge length (mm) */
  adj: Map<number, number>;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Resample a centerline at ≤ NAV_SAMPLE_MM, always keeping both endpoints. */
function samplePath(path: Path): Point[] {
  if (path.length < 2) return path.slice();
  const out: Point[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const d = dist(a, b);
    const steps = Math.max(1, Math.ceil(d / NAV_SAMPLE_MM));
    for (let s = 1; s <= steps; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
    }
  }
  return out;
}

/**
 * Partition skeleton tracks into connected components (same glue rule as the
 * nav graph). Returns per-track component labels plus an `assign` that maps an
 * arbitrary point (a junction mend) to the component of the nearest track
 * within the mend-attach radius, or -1 when nothing is near.
 */
export function partitionInkComponents(tracks: Path[]): {
  labels: number[];
  assign: (p: Point) => number;
} {
  const samples: { x: number; y: number; track: number }[] = [];
  tracks.forEach((t, ti) => {
    for (const s of samplePath(t)) samples.push({ x: s.x, y: s.y, track: ti });
  });
  // Union-find over tracks.
  const parent = tracks.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const cell = NAV_GLUE_MM;
  const grid = new Map<string, number[]>();
  samples.forEach((s, i) => {
    const key = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push(i);
  });
  samples.forEach((s, i) => {
    const gx = Math.floor(s.x / cell);
    const gy = Math.floor(s.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (j <= i || samples[j].track === s.track) continue;
          if (dist(s, samples[j]) <= NAV_GLUE_MM) union(s.track, samples[j].track);
        }
      }
    }
  });
  const labels = tracks.map((_, i) => find(i));
  const MEND_ATTACH_MM = 2.5;
  const assign = (p: Point): number => {
    let best = Infinity;
    let comp = -1;
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    const reach = Math.ceil(MEND_ATTACH_MM / cell);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const d = dist(p, samples[j]);
          if (d <= MEND_ATTACH_MM && d < best) {
            best = d;
            comp = labels[samples[j].track];
          }
        }
      }
    }
    return comp;
  };
  return { labels, assign };
}

/**
 * Order line-art pieces by walking the stroke network, inserting running
 * connectors along the skeleton between consecutive pieces. Returns the
 * emission sequence: tops (oriented so each starts where the walk arrives)
 * interleaved with connector runs. Island transitions insert nothing — the
 * caller's assembler trims those gaps.
 *
 * `extraTracks` are nav-only polylines (the full skeleton) the connectors may
 * ride even though no piece sews them in this pass — the underlay pass routes
 * over columns that only bean-stitch, and junction mends sit on wedges whose
 * own geometry doesn't span the network.
 */
export function routeInkPieces(
  pieces: InkPiece[],
  start: Point | null,
  travelPitchMm: number,
  extraTracks: Path[] = [],
): Path[] {
  if (pieces.length <= 1) return pieces.map((p) => p.top);

  // ── Build the navigation graph ────────────────────────────────────────────
  const nodes: NavNode[] = [];
  /** per piece: node indexes of its first and last centerline sample */
  const ends: [number, number][] = [];
  const addTrack = (path: Path, pi: number) => {
    const samples = samplePath(path);
    const first = nodes.length;
    samples.forEach((s, si) => {
      const idx = nodes.length;
      nodes.push({ x: s.x, y: s.y, piece: pi, adj: new Map() });
      if (si > 0) {
        const d = dist(nodes[idx - 1], s);
        nodes[idx - 1].adj.set(idx, d);
        nodes[idx].adj.set(idx - 1, d);
      }
    });
    return [first, nodes.length - 1] as [number, number];
  };
  pieces.forEach((p, pi) => ends.push(addTrack(p.centerline, pi)));
  // Nav-only tracks get piece ids past the real range so glue treats them as
  // foreign to every piece (and to each other, id-per-track).
  extraTracks.forEach((t, ti) => {
    if (t.length >= 2) addTrack(t, pieces.length + ti);
  });
  // Junction glue via a coarse grid hash: connect samples of different pieces
  // within NAV_GLUE_MM. Cell = glue radius so only 3×3 neighborhoods scan.
  const cell = NAV_GLUE_MM;
  const grid = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push(i);
  });
  nodes.forEach((n, i) => {
    const gx = Math.floor(n.x / cell);
    const gy = Math.floor(n.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (j <= i || nodes[j].piece === n.piece) continue;
          const d = dist(n, nodes[j]);
          if (d <= NAV_GLUE_MM) {
            // Keep the cheapest glue if multiple samples qualify.
            const prev = n.adj.get(j);
            if (prev === undefined || d < prev) {
              n.adj.set(j, d);
              nodes[j].adj.set(i, d);
            }
          }
        }
      }
    }
  });

  // ── Dijkstra from a node: distances to every node + parent chain ─────────
  const dijkstra = (from: number): { d: Float64Array; parent: Int32Array } => {
    const d = new Float64Array(nodes.length).fill(Infinity);
    const parent = new Int32Array(nodes.length).fill(-1);
    d[from] = 0;
    // Binary heap of [dist, node].
    const heap: number[] = [from];
    const key = (i: number) => d[heap[i]];
    const up = (i: number) => {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (key(p) <= key(i)) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const down = (i: number) => {
      for (;;) {
        let m = i;
        const l = 2 * i + 1;
        const r = l + 1;
        if (l < heap.length && key(l) < key(m)) m = l;
        if (r < heap.length && key(r) < key(m)) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    };
    const done = new Uint8Array(nodes.length);
    while (heap.length) {
      const u = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        down(0);
      }
      if (done[u]) continue;
      done[u] = 1;
      for (const [v, w] of nodes[u].adj) {
        if (d[u] + w < d[v]) {
          d[v] = d[u] + w;
          parent[v] = u;
          heap.push(v);
          up(heap.length - 1);
        }
      }
    }
    return { d, parent };
  };

  // ── Greedy walk by network distance ──────────────────────────────────────
  const out: Path[] = [];
  const sewn = new Uint8Array(pieces.length);
  const topStart = (pi: number) => pieces[pi].top[0];
  const topEnd = (pi: number) => pieces[pi].top[pieces[pi].top.length - 1];

  // If the caller's cursor already sits ON the network (the previous pass of
  // this same object ended on a column), enter through it: the first piece is
  // then chosen by network distance and reached with a connector, so pass
  // transitions (underlay → mends → satin within one component) never gap.
  let entryNode = -1;
  if (start) {
    let best = NAV_GLUE_MM;
    nodes.forEach((n, i) => {
      const d = dist(start, n);
      if (d <= best) {
        best = d;
        entryNode = i;
      }
    });
  }

  // First piece: nearest to the caller's cursor (Euclidean — nothing sewn yet).
  let firstIdx = 0;
  if (start) {
    let best = Infinity;
    pieces.forEach((p, i) => {
      const d = Math.min(dist(start, topStart(i)), dist(start, topEnd(i)));
      if (d < best) {
        best = d;
        firstIdx = i;
      }
    });
  }

  /** Emit a piece, oriented to start near the given point (null = as-is).
   *  Returns the nav node where the needle ends up. */
  const emit = (pi: number, arriveAt: Point | null): number => {
    sewn[pi] = 1;
    let top = pieces[pi].top;
    let exitEnd = ends[pi][1];
    if (arriveAt && dist(arriveAt, topEnd(pi)) < dist(arriveAt, topStart(pi))) {
      top = top.slice().reverse();
      exitEnd = ends[pi][0];
    }
    out.push(top);
    return exitEnd;
  };

  let curNode: number;
  let remaining: number;
  if (entryNode >= 0) {
    // Enter through the network: the main loop below picks the first piece by
    // network distance and emits the connector to reach it.
    curNode = entryNode;
    remaining = pieces.length;
  } else {
    curNode = emit(firstIdx, start);
    remaining = pieces.length - 1;
  }

  while (remaining > 0) {
    const { d, parent } = dijkstra(curNode);
    // Candidates: nearest unsewn pieces by Euclidean prefilter, then choose the
    // best NETWORK entry (min network distance to either end node).
    const cur = nodes[curNode];
    const cands: { pi: number; eu: number }[] = [];
    for (let pi = 0; pi < pieces.length; pi++) {
      if (sewn[pi]) continue;
      const eu = Math.min(dist(cur, topStart(pi)), dist(cur, topEnd(pi)));
      cands.push({ pi, eu });
    }
    cands.sort((a, b) => a.eu - b.eu);
    let chosen = -1;
    let chosenNode = -1;
    let bestNet = Infinity;
    for (const c of cands.slice(0, CANDIDATE_K)) {
      for (const endNode of ends[c.pi]) {
        if (d[endNode] < bestNet) {
          bestNet = d[endNode];
          chosen = c.pi;
          chosenNode = endNode;
        }
      }
    }
    if (chosen >= 0 && Number.isFinite(bestNet)) {
      // Connector: walk the parent chain curNode → chosenNode along the skeleton.
      if (bestNet >= MIN_CONNECTOR_MM) {
        const chain: Point[] = [];
        for (let v = chosenNode; v !== -1; v = parent[v]) chain.push({ x: nodes[v].x, y: nodes[v].y });
        chain.reverse();
        const run = runningStitch(chain, travelPitchMm);
        if (run.length >= 2) out.push(run);
      }
      curNode = emit(chosen, nodes[chosenNode]);
    } else {
      // No network path — a true island. Nearest by Euclidean; the assembler's
      // ladder trims (or buries) the hop exactly as before this router existed.
      const next = cands[0].pi;
      curNode = emit(next, nodes[curNode]);
    }
    remaining--;
  }
  return out;
}
