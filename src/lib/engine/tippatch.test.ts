import { describe, it, expect } from "vitest";
import { generateObjectRuns } from "./index";
import { makeObjectFromPaths } from "../objects";
import type { Path } from "../../types/project";

/** A turned/field fill on a tapering shape must not leave the pointed TIP bare —
 *  the rows stop where the shape narrows below the row spacing, and the residual
 *  patch has to carry thread into the point. */

describe("tip patching behind turned fills", () => {
  it("puts thread near a curled pennant's point", () => {
    // A waving-pennant outline (traced from real clipart): ~25mm long, tapering
    // into a CURLED point — the wide-end rows can't reach the last few mm, so
    // without the residual patch the point stays bare (~2.5mm to the nearest
    // penetration).
    const ring: Path = [
      { x: 0.8, y: 0.1 }, { x: 4.5, y: 2.0 }, { x: 7.0, y: 2.9 }, { x: 9.8, y: 3.3 }, { x: 17.4, y: 3.9 },
      { x: 20.0, y: 4.3 }, { x: 21.2, y: 4.7 }, { x: 22.6, y: 5.3 }, { x: 25.0, y: 6.9 }, { x: 21.9, y: 6.9 },
      { x: 20.3, y: 7.1 }, { x: 19.5, y: 7.4 }, { x: 16.3, y: 8.8 }, { x: 6.5, y: 14.0 }, { x: 3.9, y: 14.8 },
      { x: 2.8, y: 15.0 }, { x: 1.9, y: 15.0 }, { x: 0.6, y: 14.4 }, { x: 0.4, y: 4.4 }, { x: 0.4, y: 1.7 }, { x: 0.6, y: 0.3 },
    ];
    const o = makeObjectFromPaths("fill", [ring], "c1");
    const runs = generateObjectRuns(o);
    const pts = runs.filter((r) => !r.underlay).flatMap((r) => r.pts);
    expect(pts.length).toBeGreaterThan(100);
    let nearest = Infinity;
    for (const p of pts) nearest = Math.min(nearest, Math.hypot(p.x - 25, p.y - 6.9));
    expect(nearest).toBeLessThanOrEqual(1.5);
  });
});
