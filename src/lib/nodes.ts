import type { NodePt, NodePath, Path, Point } from "../types/project";

export type { NodePt, NodePath };

/**
 * Editable node model for hand-digitizing finesse.
 *
 * The stitch engine and exporter only ever see densified polylines (`Path`), so
 * they never change. On top of that, a drawn object can keep a list of CONTROL
 * NODES — the points the user actually placed — each flagged `smooth` (the curve
 * flows through it) or a corner (a sharp point). Editing those nodes and
 * re-densifying regenerates the object's `paths`, so the engine stays oblivious
 * while the user gets true corner↔curve control.
 *
 * Everything here is pure and deterministic.
 */

/** Target spacing (mm) between sampled points along a curved span. */
const DENS_MAX_SEG = 0.6;

/** Cubic Hermite blend of endpoints a,b with tangents ma,mb at parameter t. */
function hermite(a: NodePt, b: NodePt, ma: Point, mb: Point, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return {
    x: h00 * a.x + h10 * ma.x + h01 * b.x + h11 * mb.x,
    y: h00 * a.y + h10 * ma.y + h01 * b.y + h11 * mb.y,
  };
}

/**
 * Densify a node path into a polyline. A span between two nodes is straight when
 * BOTH ends are corners (and neither carries a handle); otherwise it's a curve:
 * the tangent at each end comes from the node's EXPLICIT Bézier handle when set
 * (a cubic Bézier control offset c maps to a Hermite tangent 3·c), else from the
 * cardinal rule (follow the neighbors at a smooth end, run straight into a
 * corner). `closed` wraps the last node to the first.
 */
export function densifyRing(nodes: NodePath, closed: boolean, maxSeg = DENS_MAX_SEG): Path {
  const n = nodes.length;
  if (n < 2) return nodes.map((p) => ({ x: p.x, y: p.y }));
  const at = (i: number) => nodes[((i % n) + n) % n];
  const segCount = closed ? n : n - 1;
  const out: Path = [{ x: nodes[0].x, y: nodes[0].y }];
  for (let i = 0; i < segCount; i++) {
    const a = at(i);
    const b = at(i + 1);
    // Neighbor controls (clamp at the ends of an open path).
    const aPrev = closed || i > 0 ? at(i - 1) : a;
    const bNext = closed || i + 2 <= n - 1 ? at(i + 2) : b;
    const chord: Point = { x: b.x - a.x, y: b.y - a.y };
    const ma: Point = a.hOut
      ? { x: a.hOut.x * 3, y: a.hOut.y * 3 }
      : a.smooth
        ? { x: (b.x - aPrev.x) * 0.5, y: (b.y - aPrev.y) * 0.5 }
        : chord;
    // hIn points BACK toward the previous node, so the Hermite end tangent
    // (which points forward along the curve) is its negation.
    const mb: Point = b.hIn
      ? { x: -b.hIn.x * 3, y: -b.hIn.y * 3 }
      : b.smooth
        ? { x: (bNext.x - a.x) * 0.5, y: (bNext.y - a.y) * 0.5 }
        : chord;
    const straight = !a.smooth && !b.smooth && !a.hOut && !b.hIn;
    if (straight) {
      out.push({ x: b.x, y: b.y });
      continue;
    }
    const span = Math.hypot(chord.x, chord.y);
    const steps = Math.max(1, Math.ceil(span / maxSeg));
    for (let s = 1; s <= steps; s++) out.push(hermite(a, b, ma, mb, s / steps));
  }
  // A closed ring's final span returns to node 0 — drop that duplicate so the
  // consumer (which closes fills itself) doesn't see a doubled seam point.
  if (closed && out.length > 1) out.pop();
  return out;
}

/**
 * The tangent handles a smooth node WOULD use if none are set explicitly —
 * one third of the cardinal tangent, the exact Bézier equivalent of what
 * densifyRing draws. Seeds the on-canvas "ears" so grabbing a handle starts
 * from the curve's current shape, never a jump.
 */
export function impliedHandles(
  nodes: NodePath,
  i: number,
  closed: boolean,
): { hIn: Point; hOut: Point } {
  const n = nodes.length;
  const at = (k: number) => nodes[((k % n) + n) % n];
  const nd = at(i);
  const prev = closed || i > 0 ? at(i - 1) : nd;
  const next = closed || i < n - 1 ? at(i + 1) : nd;
  const t: Point = { x: (next.x - prev.x) * 0.5, y: (next.y - prev.y) * 0.5 };
  return {
    hIn: nd.hIn ?? { x: -t.x / 3, y: -t.y / 3 },
    hOut: nd.hOut ?? { x: t.x / 3, y: t.y / 3 },
  };
}

/**
 * Set one tangent handle of node `i` (relative mm offset). In `mirror` mode —
 * the default smooth-node gesture — the opposite handle re-aligns to stay
 * collinear but keeps its own length, so an asymmetric curve isn't flattened
 * (the standard vector-editor behavior). `mirror: false` (Alt-drag) moves only
 * one side, creating a cusp. Setting a handle marks the node smooth.
 */
export function setNodeHandle(
  nodes: NodePath,
  i: number,
  side: "in" | "out",
  v: Point,
  mirror: boolean,
  closed: boolean,
): NodePath {
  const cur = impliedHandles(nodes, i, closed);
  return nodes.map((nd, j) => {
    if (j !== i) return { ...nd };
    const next: NodePt = { ...nd, smooth: true };
    if (side === "out") next.hOut = { ...v };
    else next.hIn = { ...v };
    const len = Math.hypot(v.x, v.y);
    if (mirror && len > 1e-9) {
      const other = side === "out" ? (nd.hIn ?? cur.hIn) : (nd.hOut ?? cur.hOut);
      const otherLen = Math.hypot(other.x, other.y) || len;
      const mirrored = { x: (-v.x / len) * otherLen, y: (-v.y / len) * otherLen };
      if (side === "out") next.hIn = mirrored;
      else next.hOut = mirrored;
    }
    return next;
  });
}

/** Convert a plain polyline into a node path (every point a corner). */
export function nodesFromPath(path: Path, smooth = false): NodePath {
  return path.map((p) => ({ x: p.x, y: p.y, smooth }));
}

/** Flip a node between smooth and corner (returns a new node path). Turning a
 *  node into a corner clears its Bézier handles — a sharp point has none. */
export function toggleNodeSmooth(nodes: NodePath, i: number): NodePath {
  return nodes.map((nd, j) =>
    j === i
      ? nd.smooth
        ? { x: nd.x, y: nd.y, smooth: false }
        : { ...nd, smooth: true }
      : { ...nd },
  );
}

/** Move a node to a new position (returns a new node path). */
export function moveNode(nodes: NodePath, i: number, to: Point): NodePath {
  return nodes.map((nd, j) => (j === i ? { ...nd, x: to.x, y: to.y } : { ...nd }));
}

/** Delete a node (returns a new node path; caller enforces any minimum count). */
export function deleteNode(nodes: NodePath, i: number): NodePath {
  return nodes.filter((_, j) => j !== i);
}

/**
 * Insert a node at `at`, projected onto the nearest node-to-node span. The new
 * node is smooth only if both neighbors are smooth (so it sits naturally on a
 * curve, or stays sharp on a corner run). Returns the new node path.
 */
export function insertNode(nodes: NodePath, at: Point, closed: boolean): NodePath {
  if (nodes.length < 2) return [...nodes, { x: at.x, y: at.y }];
  let bestIdx = -1;
  let bestD = Infinity;
  let bestPt: Point = at;
  const segs = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2)) : 0;
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (proj.x - at.x) ** 2 + (proj.y - at.y) ** 2;
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
      bestPt = proj;
    }
  }
  const a = nodes[bestIdx];
  const b = nodes[(bestIdx + 1) % nodes.length];
  const smooth = !!a.smooth && !!b.smooth;
  const out = nodes.map((nd) => ({ ...nd }));
  out.splice(bestIdx + 1, 0, { x: bestPt.x, y: bestPt.y, smooth });
  return out;
}

/** Translate every node by (dx, dy) mm. */
export function translateNodes(rings: NodePath[], dx: number, dy: number): NodePath[] {
  return rings.map((r) => r.map((nd) => ({ ...nd, x: nd.x + dx, y: nd.y + dy })));
}
