import type { Path } from "../types/project";

/**
 * Build an SVG path `d` string from a set of rings (outer + holes). Each ring
 * becomes an `M…L…Z` subpath; combined with even-odd/nonzero fill, holes and
 * counters render correctly. Pure — used by the digitize and text previews.
 */
export function ringsToSvgPath(rings: Path[]): string {
  return rings
    .map((r) => "M" + r.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("L") + "Z")
    .join(" ");
}
