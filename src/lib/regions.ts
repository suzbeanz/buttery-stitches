import type { Path } from "../types/project";
import { booleanOp } from "./boolean";
import { pointInRing } from "./geometry";
import { polygonArea } from "./trace/classify";

/**
 * Region-level geometry for merge & split of fill objects.
 *
 * A fill's `paths` is a set of rings (outer boundaries plus holes), interpreted
 * with the even-odd rule. Merge unions several fills' rings into one set; split
 * separates a set's disconnected pieces back into one component per outer ring.
 * Both are pure — they take and return ring sets, leaving object/store concerns
 * to the caller.
 */

/**
 * Union the ring sets of several fills into one. Reuses the raster boolean op,
 * so overlaps fuse cleanly (internal seams disappear). Disjoint inputs simply
 * pass through as multiple outers — still one ring set, which split can later
 * separate again. Returns `[]` for empty input.
 */
export function mergeRegionPaths(pathSets: Path[][]): Path[] {
  const sets = pathSets.filter((p) => p.length > 0);
  if (sets.length === 0) return [];
  return sets.reduce((acc, next) => booleanOp(acc, next, "union"));
}

/**
 * Partition a fill's rings into connected components — one per outer ring, with
 * the holes that sit immediately inside it. The nesting depth of a ring (how many
 * other rings contain it) tells solid from hole: even depth is an outer/solid,
 * odd is a hole. Each hole is attached to the smallest-area outer that contains
 * it (its immediate parent). A single blob returns one component, so callers can
 * gate "splittable" on `length > 1`.
 */
export function splitRegionComponents(paths: Path[]): Path[][] {
  const rings = paths.filter((r) => r.length >= 3);
  if (rings.length <= 1) return rings.map((r) => [r]);

  // A representative interior-ish vertex for each ring (first vertex is fine for
  // non-self-intersecting traced rings).
  const probe = rings.map((r) => r[0]);
  const depth = rings.map((_, i) =>
    rings.reduce(
      (d, other, j) => (j !== i && pointInRing(probe[i], other) ? d + 1 : d),
      0,
    ),
  );

  const outers: number[] = [];
  const holes: number[] = [];
  rings.forEach((_, i) => (depth[i] % 2 === 0 ? outers : holes).push(i));

  const components: Path[][] = outers.map((i) => [rings[i]]);
  const indexOfOuter = new Map(outers.map((i, k) => [i, k]));

  for (const h of holes) {
    // Immediate parent: the smallest containing outer.
    let best = -1;
    let bestArea = Infinity;
    for (const o of outers) {
      if (!pointInRing(probe[h], rings[o])) continue;
      const a = polygonArea(rings[o]);
      if (a < bestArea) {
        bestArea = a;
        best = o;
      }
    }
    if (best >= 0) components[indexOfOuter.get(best)!].push(rings[h]);
  }

  return components;
}
