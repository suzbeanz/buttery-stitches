import { describe, it, expect } from "vitest";
import { generateObjectRuns } from "./index";
import { makeObjectFromPaths } from "../objects";
import type { Path, Point } from "../../types/project";

/**
 * FILL ROW ENDS MUST LAND ON THE BOUNDARY — the wave-2 visible-defect class.
 *
 * A tatami row is generated with its exact boundary crossing as the final
 * penetration, but the machine-safety short-stitch merge ran with the general
 * 0.5mm floor over the whole serpentine: whenever the last interior grid point
 * fell within the floor of the row end, the END was eaten (the row retracts up
 * to 0.5mm), and whenever the along-edge serpentine connector (one row spacing,
 * 0.30–0.45mm) fell under the floor, the NEXT ROW'S BOUNDARY START was eaten
 * (that row then begins at its first interior grid point — up to a full stitch
 * length inside). On any edge oblique to the rows this alternated per row and
 * sewed as a serrated silhouette (measured on the wave-2 corpus renders).
 *
 * Geometry class: a parallelogram whose slanted sides cross the rows at ~72°,
 * so the serpentine connector along the edge (~0.42mm) sits under the old
 * 0.5mm floor while adjacent rows sample the edge at staggered positions.
 */

// Slanted parallelogram: rows at 0° (pinned via directionDeg), sides sloped 3:1.
const RING: Path = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 36, y: 18 },
  { x: 6, y: 18 },
];
const DENSITY = 0.4;

/** Exact horizontal span [x0, x1] of the parallelogram at height y. */
function spanAt(y: number): [number, number] {
  const t = y / 18;
  return [t * 6, 30 + t * 6];
}

/** Group top-layer penetrations into scan rows by their (constant) y. */
function rowsOf(pts: Point[]): Map<number, Point[]> {
  const rows = new Map<number, Point[]>();
  for (const p of pts) {
    const key = Math.round(p.y * 1000) / 1000;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = []));
    row.push(p);
  }
  return rows;
}

describe("tatami row ends reach the region boundary", () => {
  it("every interior row of an oblique-edged fill spans its full scanline", () => {
    const o = makeObjectFromPaths("fill", [RING.map((p) => ({ ...p }))], "c1");
    o.params = { ...o.params, density: DENSITY, directionDeg: 0, underlay: false };
    const runs = generateObjectRuns(o);
    // Top fill rows only: the finishing edge run stitches at ~2mm pitch along
    // the inset boundary and would mask retracted rows, so drop any run whose
    // points do not lie on the horizontal row grid (rows have constant y).
    const pts = runs
      .filter((r) => !r.underlay)
      .flatMap((r) => r.pts)
      .filter((p) => p.y > 2 && p.y < 16);
    const rows = rowsOf(pts);
    expect(rows.size).toBeGreaterThan(20);

    // Pull comp extends each row end slightly past the edge; the row generator
    // keeps the last interior penetration ≥ its end-clearance from the end. A
    // row that fails by more than that clearance was eaten by the short-stitch
    // merge — the serration defect.
    const TOL = 0.45;
    let worstStart = 0;
    let worstEnd = 0;
    for (const [y, row] of rows) {
      if (row.length < 4) continue; // edge-run fragments / connectors
      const [x0, x1] = spanAt(y);
      const minX = Math.min(...row.map((p) => p.x));
      const maxX = Math.max(...row.map((p) => p.x));
      worstStart = Math.max(worstStart, minX - x0);
      worstEnd = Math.max(worstEnd, x1 - maxX);
    }
    expect(worstStart, `row start retracted ${worstStart.toFixed(2)}mm`).toBeLessThanOrEqual(TOL);
    expect(worstEnd, `row end retracted ${worstEnd.toFixed(2)}mm`).toBeLessThanOrEqual(TOL);
  });
});
