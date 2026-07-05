import type { EmbObject, Path, Point } from "../../types/project";

/**
 * COLOR-BOUNDARY UNDERLAP — the professional gap-proofing pass.
 *
 * The trace hands the engine regions that abut pixel-perfectly. Thread pulls
 * inward as it sews, so two exactly-abutting colors open a hairline of bare
 * fabric along their shared boundary — white peeking between a golf hole and
 * its green, or along a pole. Professional digitizers prevent it by extending
 * the EARLIER-sewn region a fraction of a millimetre UNDER its later-sewn
 * neighbour, so the top color lands on thread instead of on a seam (the
 * reference designs show ~8% of sewn cells shared by 2+ colors; an untouched
 * trace shows almost none).
 *
 * Implementation: objects arrive in sew order. For each earlier FILL object,
 * every boundary vertex whose OUTWARD probe lands inside a later-sewn object
 * of a different color is pushed outward by the underlap amount. Probing is
 * per-vertex on a ring resampled to ~1mm, so the expansion follows exactly the
 * stretches that are actually covered — the open-fabric silhouette never grows.
 * Hole rings participate too ("outward" from ink points INTO the hole), which
 * is precisely the ball-in-the-green case.
 */

/** How far (mm) an earlier region extends under a later neighbour. */
export const UNDERLAP_MM = 0.4;
/** Rings are resampled to this max segment length (mm) before pushing, so the
 *  expansion resolves partial adjacency instead of dragging whole edges. */
const RESAMPLE_MM = 1.2;

/** Even-odd point-in-rings test (outer + holes). */
function pointInRings(p: Point, rings: Path[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Insert midpoints until no segment of the closed ring exceeds `maxSeg`. */
function resampleRing(ring: Path, maxSeg: number): Path {
  const out: Path = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(len / maxSeg);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Unit normal at vertex i pointing OUT of the ink (away from the object). */
function outwardNormal(ring: Path, i: number, ownPaths: Path[]): Point | null {
  const prev = ring[(i - 1 + ring.length) % ring.length];
  const next = ring[(i + 1) % ring.length];
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const len = Math.hypot(tx, ty);
  if (len < 1e-9) return null;
  let nx = ty / len;
  let ny = -tx / len;
  // Orient by a tiny probe: outward = NOT in the object's own ink.
  const p = ring[i];
  if (pointInRings({ x: p.x + nx * 0.15, y: p.y + ny * 0.15 }, ownPaths)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

const isStroke = (o: EmbObject) => o.params?.lineArt === true;

/**
 * Expand each earlier-sewn fill object under its later-sewn, differently-colored
 * neighbours by {@link UNDERLAP_MM}. Returns the same array; objects that abut a
 * later neighbour get NEW paths, everything else is untouched.
 */
export function underlapObjects(objects: EmbObject[], amountMm = UNDERLAP_MM): EmbObject[] {
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj.type !== "fill" || isStroke(obj)) continue;
    const later = objects
      .slice(i + 1)
      .filter((j) => j.colorId !== obj.colorId && (j.type === "fill" || j.type === "satin"));
    if (later.length === 0) continue;
    const coveredByLater = (p: Point) => later.some((j) => pointInRings(p, j.paths));

    const probeDist = amountMm + 0.1;
    const originalPaths = obj.paths;
    obj.paths = obj.paths.map((ring) => {
      const dense = resampleRing(ring, RESAMPLE_MM);
      let pushed = 0;
      const out = dense.map((p, vi) => {
        const n = outwardNormal(dense, vi, originalPaths);
        if (!n) return p;
        const probe = { x: p.x + n.x * probeDist, y: p.y + n.y * probeDist };
        if (!coveredByLater(probe)) return p;
        pushed++;
        return { x: p.x + n.x * amountMm, y: p.y + n.y * amountMm };
      });
      // Keep the original (un-resampled) ring when nothing along it abuts a
      // later neighbour — no reason to densify an untouched outline.
      return pushed > 0 ? out : ring;
    });
  }
  return objects;
}
