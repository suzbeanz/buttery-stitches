import { describe, it, expect } from "vitest";
import { generateDesign } from "./index";
import { makeObject, makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Project } from "../../types/project";

/** Learned from real PES files: pros connect nearby same-color shapes with a
 *  continuous travel run, not a jump/trim. */
function twoLines(gap: number): Project {
  const a = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "c1");
  const b = makeObject("running", [{ x: 5 + gap, y: 0 }, { x: 10 + gap, y: 0 }], "c1");
  return { ...createEmptyProject(), objects: [a, b] };
}

describe("travel-run routing", () => {
  it("connects a close same-color gap with a stitched travel (no jump/trim)", () => {
    const design = generateDesign(twoLines(6), { lockStitches: false }); // 6mm gap (<8 woven trim)
    expect(design.some((s) => s.jump)).toBe(false);
    expect(design.some((s) => s.trim)).toBe(false);
    // The travel adds intermediate penetrations between the two lines.
    const between = design.filter((s) => !s.jump && s.x > 5 && s.x < 11);
    expect(between.length).toBeGreaterThan(0);
  });

  it("still trims a far same-color gap", () => {
    const design = generateDesign(twoLines(40), { lockStitches: false }); // 40mm > trim threshold
    expect(design.some((s) => s.jump && s.trim)).toBe(true);
  });
});

describe("intra-object continuity (anti-fragmentation)", () => {
  // A concave fill splits into multiple stitch rows; the gaps between a fill's
  // OWN spans must connect as continuous travels, not shatter into jumps/trims.
  // (This was the catastrophic 350 trims+jumps/1000 we saw in real exports.)
  it("connects a fill's own spans without trimming, even past the trim threshold", () => {
    // A wide, shallow U: tatami rows hop the central notch (a same-object gap
    // larger than the woven trim threshold but within INTRA_OBJECT_NO_TRIM).
    const u = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 28, y: 30 },
      { x: 28, y: 10 },
      { x: 12, y: 10 },
      { x: 12, y: 30 },
      { x: 0, y: 30 },
    ];
    const fill = makeObjectFromPaths("fill", [u], "c1");
    const project: Project = { ...createEmptyProject(), objects: [fill] };
    const design = generateDesign(project, { lockStitches: false });
    // One object → a couple jump/trims at most, not one per fragmented row.
    expect(design.filter((s) => s.trim).length).toBeLessThanOrEqual(2);
    const jumpsTrims = design.filter((s) => s.jump || s.trim).length;
    expect((jumpsTrims / design.length) * 1000).toBeLessThan(10);
  });

  // Real exports of dense radial designs shattered because they were many SEPARATE
  // same-color motifs ~10-12mm apart: each cross-object hop sat just over the old
  // 8mm woven threshold and trimmed (234 trims+jumps/1000). A stable woven now
  // travels that far, keeping the whole color continuous like the pro files.
  it("keeps separate same-color motifs ~11mm apart connected on woven (no trim spam)", () => {
    const R = 35, cx = 50, cy = 50, N = 48;
    const objects = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      const x2 = cx + (R - 12) * Math.cos(a), y2 = cy + (R - 12) * Math.sin(a);
      objects.push(makeObject("satin", [{ x, y }, { x: x2, y: y2 }], "c1"));
    }
    const design = generateDesign({ ...createEmptyProject(), objects }, { lockStitches: false });
    const jt = design.filter((s) => s.jump || s.trim).length;
    expect((jt / design.length) * 1000).toBeLessThan(3); // pro range (0.2–2.9)
  });
});

describe("underpath travel under coverage", () => {
  const trims = (d: ReturnType<typeof generateDesign>) => d.filter((s) => s.trim).length;
  // c1 dots 28mm apart (> trim threshold); a later c2 fill either covers the
  // connecting path or sits off to the side. When covered, the connector hides
  // under the fill → travel (no trim); otherwise it must trim.
  function withFill(covering: boolean): Project {
    const a = makeObject("running", [{ x: 0, y: 0 }, { x: 2, y: 0 }], "c1");
    const b = makeObject("running", [{ x: 28, y: 0 }, { x: 30, y: 0 }], "c1");
    const box = covering
      ? [{ x: -5, y: -6 }, { x: 40, y: -6 }, { x: 40, y: 6 }, { x: -5, y: 6 }]
      : [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 140 }, { x: 100, y: 140 }];
    const fill = makeObjectFromPaths("fill", [box], "c2");
    const p = createEmptyProject();
    p.colors = [{ id: "c1", rgb: [0, 0, 0] }, { id: "c2", rgb: [200, 0, 0] }];
    p.objects = [a, b, fill];
    return p;
  }

  it("routes a hidden travel under a later fill instead of trimming", () => {
    expect(trims(generateDesign(withFill(true), { lockStitches: false }))).toBeLessThan(
      trims(generateDesign(withFill(false), { lockStitches: false })),
    );
  });
});
