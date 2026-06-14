import type { EmbObject, Path } from "../types/project";
import { railsFromCenterline } from "./geometry";
import { makeObjectFromPaths } from "./objects";

/**
 * Default satin column width (mm) for a border outline. Narrower than the
 * default satin column since an outline traces an existing edge.
 */
export const DEFAULT_OUTLINE_WIDTH = 1.5;

export interface OutlineOptions {
  /** Also outline the holes (inner rings), not just the outer ring. */
  includeHoles?: boolean;
}

/**
 * Close a ring by appending its first point when the ring isn't already
 * closed, so railsFromCenterline traces the full border back to the start.
 */
function closeRing(ring: Path): Path {
  if (ring.length < 2) return ring.map((p) => ({ ...p }));
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first.x === last.x && first.y === last.y;
  const out = ring.map((p) => ({ ...p }));
  if (!closed) out.push({ ...first });
  return out;
}

/**
 * Build satin border outline object(s) for a fill object's rings.
 *
 * Each ring (a closed polygon: rings[0] is the outer boundary, the rest are
 * holes) becomes one satin EmbObject whose two rails straddle the ring line at
 * the given column width, centered on the border. By default only the outer
 * ring is outlined; pass `includeHoles` to also trace the holes.
 *
 * Pure and deterministic: same inputs always yield the same geometry.
 */
export function buildOutline(
  rings: Path[],
  widthMm: number,
  colorId: string,
  options: OutlineOptions = {},
): EmbObject[] {
  const usable = rings.filter((r) => r.length >= 2);
  if (usable.length === 0) return [];

  const chosen = options.includeHoles ? usable : usable.slice(0, 1);

  return chosen.map((ring) => {
    const centerline = closeRing(ring);
    const [left, right] = railsFromCenterline(centerline, widthMm);
    return makeObjectFromPaths("satin", [left, right], colorId, "Outline");
  });
}
