import type { Path } from "../../types/project";
import { resampleByDistance } from "./resample";

/**
 * Running stitch: walk the path placing a needle penetration every
 * `stitchLength` mm, always landing exactly on the final vertex.
 */
export function runningStitch(path: Path, stitchLength: number): Path {
  if (path.length < 2) return path.map((p) => ({ ...p }));
  return resampleByDistance(path, stitchLength);
}
