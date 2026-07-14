import { describe, it, expect } from "vitest";
import { motifFill } from "./fill";
import { MOTIFS, motifById, motifsByGroup } from "./motifs";
import { generateDesign } from "./index";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Path } from "../../types/project";

const sq: Path = [{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}];

describe("motif library", () => {
  it("every motif has finite, non-empty geometry and a unique id", () => {
    const ids = new Set<string>();
    for (const m of MOTIFS) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(m.strokes.length).toBeGreaterThan(0);
      expect(m.w).toBeGreaterThan(0);
      expect(m.h).toBeGreaterThan(0);
      for (const stroke of m.strokes) {
        expect(stroke.length).toBeGreaterThanOrEqual(2);
        for (const pt of stroke) {
          expect(Number.isFinite(pt.x)).toBe(true);
          expect(Number.isFinite(pt.y)).toBe(true);
        }
      }
    }
  });
  it("groups partition the library with no lost or duplicated motifs", () => {
    const grouped = motifsByGroup().flatMap((g) => g.motifs);
    expect(grouped).toHaveLength(MOTIFS.length);
  });
  it("motifById falls back to the first motif for an unknown id", () => {
    expect(motifById("does-not-exist")).toBe(MOTIFS[0]);
  });
  it("every motif tiles into a region and sews within safe stitch length", () => {
    for (const m of MOTIFS) {
      const o = makeObjectFromPaths("fill", [sq], "c1");
      o.params.fillStyle = "motif";
      o.params.motif = m.id;
      const d = generateDesign({ ...createEmptyProject(), objects: [o] }, { lockStitches: true });
      expect(d.some((s) => !s.jump && !s.trim)).toBe(true);
      let longest = 0;
      for (let i = 1; i < d.length; i++)
        if (!d[i].jump && !d[i].trim && d[i].colorId === d[i - 1].colorId)
          longest = Math.max(longest, Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y));
      expect(longest).toBeLessThanOrEqual(9.1);
    }
  });
});

describe("motif fill", () => {
  it("tiles motif strokes inside the region", () => {
    const runs = motifFill([sq], { motifId: "chevron", sizeMm: 5, angle: 0 });
    expect(runs.length).toBeGreaterThan(10); // many tiles
    // every placed point lies within the (padded) region bbox
    for (const r of runs) for (const p of r) {
      expect(p.x).toBeGreaterThan(-6);
      expect(p.x).toBeLessThan(46);
    }
  });
  it("cross motif places two strokes per cell", () => {
    const cross = motifFill([sq], { motifId: "cross", sizeMm: 6, angle: 0 }).length;
    const one = motifFill([sq], { motifId: "chevron", sizeMm: 6, angle: 0 }).length;
    expect(cross).toBeGreaterThan(one); // 2 strokes/cell vs 1
  });
  it("bigger motif size => fewer tiles", () => {
    const small = motifFill([sq], { motifId: "diamond", sizeMm: 3, angle: 0 }).length;
    const big = motifFill([sq], { motifId: "diamond", sizeMm: 8, angle: 0 }).length;
    expect(big).toBeLessThan(small);
  });
  it("true-relief carve skips penetrations along the motif (grooves), safely", () => {
    const plain = makeObjectFromPaths("fill", [sq], "c1");
    const carved = makeObjectFromPaths("fill", [sq], "c1");
    carved.params.carve = "diamond";
    const pen = (d: ReturnType<typeof generateDesign>) =>
      d.filter((s) => !s.jump && !s.trim).length;
    const dp = generateDesign({ ...createEmptyProject(), objects: [plain] }, { lockStitches: true });
    const dc = generateDesign({ ...createEmptyProject(), objects: [carved] }, { lockStitches: true });
    expect(pen(dc)).toBeLessThan(pen(dp)); // carved grooves remove penetrations
    let longest = 0;
    for (let i = 1; i < dc.length; i++)
      if (!dc[i].jump && !dc[i].trim && dc[i].colorId === dc[i - 1].colorId)
        longest = Math.max(longest, Math.hypot(dc[i].x - dc[i - 1].x, dc[i].y - dc[i - 1].y));
    expect(longest).toBeLessThanOrEqual(9.1);
  });
  it("engine: a motif-style fill sews safely (no over-long stitch)", () => {
    const o = makeObjectFromPaths("fill", [sq], "c1");
    o.params.fillStyle = "motif";
    o.params.motif = "wave";
    const d = generateDesign({ ...createEmptyProject(), objects: [o] }, { lockStitches: true });
    let longest = 0;
    for (let i=1;i<d.length;i++) if(!d[i].jump&&!d[i].trim&&d[i].colorId===d[i-1].colorId)
      longest = Math.max(longest, Math.hypot(d[i].x-d[i-1].x, d[i].y-d[i-1].y));
    expect(longest).toBeLessThanOrEqual(9.1);
    expect(d.some(s=>!s.jump&&!s.trim)).toBe(true);
  });
});
