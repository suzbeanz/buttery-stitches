import { describe, it, expect } from "vitest";
import { furObjects } from "../trace/fur";
import { furArt } from "../trace/fur.fixture";
import { fixStitches } from "../fix";
import { generateDesign } from "../engine";
import { sweepProject } from "./sweep";
import { createEmptyProject } from "../project";
import { rgbToLab } from "../thread/match";
import type { Project, Point } from "../../types/project";

/**
 * PRODUCT-SEQUENCE gates for the FUR digitizing mode — exactly what the wizard
 * plus the studio's Clean up do: furObjects → fixStitches → generateDesign.
 * The thresholds encode the commercial fur reference's structure: fur shades
 * sew dark→light with details after, shade overlaps survive Clean up, each
 * lock carries its own grain, and the whole design stays inside the pro
 * trim/lock/length bands.
 */

function insideRings(p: Point, rings: Point[][]): boolean {
  let odd = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
    }
  return odd;
}

/** Shared-coverage sample count between two ring sets on a coarse grid. */
function sharedCells(a: Point[][], b: Point[][]): number {
  let n = 0;
  for (let y = 0; y < 100; y += 0.8)
    for (let x = 0; x < 100; x += 0.8) if (insideRings({ x, y }, a) && insideRings({ x, y }, b)) n++;
  return n;
}

describe("fur pipeline gates", () => {
  const res = furObjects(furArt(), 6, { mmPerPx: 0.2, offsetX: 2, offsetY: 2, removeBackground: true });
  const project: Project = {
    ...createEmptyProject(),
    widthMm: 100,
    heightMm: 100,
    colors: res.colors,
    objects: res.objects,
  };
  const preFur = res.objects.filter((o) => o.params.fillStyle === "fur");
  const preOverlaps = preFur.slice(0, -1).map((o, k) => sharedCells(o.paths, preFur[k + 1].paths));
  const fixed = fixStitches(project);
  const design = generateDesign(fixed);

  it("sews fur shades dark → light, then the details, through Clean up", () => {
    const L = new Map(fixed.colors.map((c) => [c.id, rgbToLab(c.rgb)[0]]));
    const furIds = new Set(
      fixed.objects.filter((o) => o.params.fillStyle === "fur").map((o) => o.colorId),
    );
    expect(furIds.size).toBe(3);
    // Color-block order in the actual stitch stream.
    const blockOrder: string[] = [];
    for (const s of design) {
      if (!blockOrder.includes(s.colorId)) blockOrder.push(s.colorId);
    }
    const furBlocks = blockOrder.filter((id) => furIds.has(id));
    expect(furBlocks.length).toBe(3);
    for (let i = 1; i < furBlocks.length; i++)
      expect(L.get(furBlocks[i])!).toBeGreaterThan(L.get(furBlocks[i - 1])!);
    // Every fur block precedes every detail block.
    const lastFur = Math.max(...furBlocks.map((id) => blockOrder.indexOf(id)));
    for (const id of blockOrder) {
      if (!furIds.has(id)) expect(blockOrder.indexOf(id)).toBeGreaterThan(lastFur);
    }
  });

  it("the baked shade overlap SURVIVES Clean up (knockdown exemption)", () => {
    const fur = fixed.objects.filter((o) => o.params.fillStyle === "fur");
    expect(fur.length).toBe(3);
    fur.slice(0, -1).forEach((o, k) => {
      const post = sharedCells(o.paths, fur[k + 1].paths);
      expect(post, `overlap ${o.name} ∩ ${fur[k + 1].name} after Clean up`).toBeGreaterThan(
        preOverlaps[k] * 0.9,
      );
    });
  });

  it("each lock sews with its own grain (per-region angle spread)", () => {
    // Dominant top-stitch direction per connected fur lock: sample stitches by
    // which region contains them; the fixture's wavy stripes should produce a
    // real spread of grains across regions.
    const furObjectsFixed = fixed.objects.filter((o) => o.params.fillStyle === "fur");
    const angles: number[] = [];
    for (const o of furObjectsFixed) {
      // Split the object's rings into regions by centroid clustering along y
      // (the fixture's stripes stack vertically): use each OUTER ring (area
      // sign) — simpler: measure the dominant angle of stitches inside each
      // ring bigger than 100mm².
      for (const ring of o.paths) {
        const areaAbs = Math.abs(ring.reduce((s, p, i) => {
          const q = ring[(i + 1) % ring.length];
          return s + (p.x * q.y - q.x * p.y) / 2;
        }, 0));
        if (areaAbs < 100) continue;
        let hx = 0;
        let hy = 0;
        let prev: { x: number; y: number; jump?: boolean; objectId?: string } | null = null;
        for (const s of design) {
          if (s.objectId !== o.id || s.jump || s.underlay || s.travel) {
            prev = null;
            continue;
          }
          if (prev) {
            const mid = { x: (s.x + prev.x) / 2, y: (s.y + prev.y) / 2 };
            const len = Math.hypot(s.x - prev.x, s.y - prev.y);
            if (len >= 2 && insideRings(mid, [ring])) {
              const a = Math.atan2(s.y - prev.y, s.x - prev.x);
              // fold to [0,π)
              hx += Math.abs(Math.cos(a)) * len;
              hy += Math.abs(Math.sin(a)) * len;
            }
          }
          prev = s;
        }
        if (hx + hy > 0) angles.push((Math.atan2(hy, hx) * 180) / Math.PI);
      }
    }
    expect(angles.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...angles) - Math.min(...angles), `grain spread across locks (${angles.map((a) => a.toFixed(0)).join(",")})`).toBeGreaterThan(15);
  });

  it("stays inside the professional quality bands", () => {
    const sweep = sweepProject(fixed);
    for (const o of sweep.objects) {
      expect(o.coverage, `coverage of ${o.name}`).toBeGreaterThanOrEqual(0.97);
      expect(o.maxSegMm, `max segment of ${o.name}`).toBeLessThanOrEqual(9);
    }
    expect(sweep.dangerCells, "density danger in the overlap bands").toBe(0);
    expect(sweep.trims).toBeLessThanOrEqual(Math.max(6, (24 / 10_000) * sweep.stitches, sweep.pieces + 4));
    expect(sweep.stitchQ95Mm).toBeLessThanOrEqual(5.0);
    expect(sweep.lockedBoundaries).toBe(sweep.boundaries);
  });
});
