import { describe, it, expect } from "vitest";
import { buildTestSwatch } from "./swatch";
import { designFor, type EngineStitch } from "../engine";
import type { Point } from "../../types/project";

/**
 * Trim/tie hygiene on the calibration swatch. The sew-out showed loose thread
 * where a same-colour move crossed open fabric instead of trimming. A fill's own
 * rows may bridge a small notch, but no long bare slash should cross the ground
 * between disjoint pieces — that includes the FINISHING EDGE RUN, whose hop
 * across a concave mouth (the C-band) or a counter (the ring) must bury under the
 * same-colour fill or trim, never float.
 *
 * We measure the longest run of consecutive same-colour real penetrations whose
 * midpoints all lie OUTSIDE every fill region — a thread laid over bare fabric.
 * Deliberate exposed thread (the running ruler line) is excluded by skipping
 * non-fill objects: only fill objects must keep their thread on the cloth.
 */
function pointInRings(p: Point, rings: { x: number; y: number }[][]): boolean {
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

const isReal = (s: EngineStitch) => !s.jump && !s.trim && !s.stop;

describe("swatch routing — no long bare travel across fill ground", () => {
  it("keeps every fill object's exposed-fabric segments short (slashes trim, not float)", () => {
    const project = buildTestSwatch();
    const design = designFor(project);
    const fills = project.objects.filter((o) => o.type === "fill");

    // Longest single same-colour real segment whose midpoint sits on bare fabric,
    // per fill object. A short chord hugging a concave/hole boundary is normal; a
    // long one is a stranded travel.
    let worst = 0;
    let prev: EngineStitch | null = null;
    for (const s of design) {
      if (isReal(s) && prev && isReal(prev) && prev.colorId === s.colorId && prev.objectId === s.objectId) {
        const owner = fills.find((o) => o.id === s.objectId);
        if (owner) {
          const mid = { x: (s.x + prev.x) / 2, y: (s.y + prev.y) / 2 };
          if (!pointInRings(mid, owner.paths)) {
            worst = Math.max(worst, Math.hypot(s.x - prev.x, s.y - prev.y));
          }
        }
      }
      prev = s;
    }
    // Stitch length is ~3mm; a boundary chord may run a hair over. A genuine bare
    // travel (the ~50mm slash the sew-out showed, or a mouth-crossing edge hop)
    // would blow well past this.
    expect(worst).toBeLessThan(5);
  });
});
