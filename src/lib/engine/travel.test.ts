import { describe, it, expect } from "vitest";
import { generateDesign } from "./index";
import { makeObject, makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Project } from "../../types/project";

/** Total connector (jump/trim) travel in a design — what auto-branching minimizes. */
function connectorTravel(design: ReturnType<typeof generateDesign>): number {
  let t = 0;
  for (let i = 1; i < design.length; i++) {
    const a = design[i - 1];
    const b = design[i];
    if (b.jump || b.trim) t += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return t;
}

/** A comb of `n` separate teeth, in the given region order. */
function comb(order: number[]): Project {
  const teeth = order.map((i) => {
    const x = i * 5;
    return [{ x, y: 0 }, { x: x + 3, y: 0 }, { x: x + 3, y: 40 }, { x, y: 40 }];
  });
  return { ...createEmptyProject(), objects: [makeObjectFromPaths("fill", teeth, "c1")] };
}

describe("auto-branching (travel-minimising region order)", () => {
  it("routes a scrambled fill as tightly as one traced in order", () => {
    const inOrder = [...Array(24).keys()];
    const scrambled = [...inOrder.filter((i) => i % 2 === 0), ...inOrder.filter((i) => i % 2 === 1).reverse()];
    const tidy = connectorTravel(generateDesign(comb(inOrder), { lockStitches: false }));
    const messy = connectorTravel(generateDesign(comb(scrambled), { lockStitches: false }));
    // The router recovers the tight order regardless of trace order (within 5%).
    expect(messy).toBeLessThan(tidy * 1.05);
  });
});

/** Learned from real PES files: pros connect nearby same-color shapes with a
 *  continuous travel run, not a jump/trim. */
function twoLines(gap: number): Project {
  const a = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], "c1");
  const b = makeObject("running", [{ x: 5 + gap, y: 0 }, { x: 10 + gap, y: 0 }], "c1");
  return { ...createEmptyProject(), objects: [a, b] };
}

describe("travel-run routing", () => {
  it("bridges a very short exposed gap with a stitched travel (no trim)", () => {
    const design = generateDesign(twoLines(3.5), { lockStitches: false }); // ≤ exposed max
    expect(design.some((s) => s.trim)).toBe(false);
    const between = design.filter((s) => !s.jump && s.x > 5 && s.x < 9);
    expect(between.length).toBeGreaterThan(0);
  });

  it("trims a longer exposed same-color gap (clean, no slash)", () => {
    const design = generateDesign(twoLines(10), { lockStitches: false }); // open fabric
    expect(design.some((s) => s.trim)).toBe(true);
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
  // Separate same-color motifs across OPEN fabric (~12mm apart) must NOT be joined
  // with visible thread slashes — the premium rule trims between them. They still
  // sew safely; the connectors just aren't there.
  it("trims cleanly between separate exposed same-color motifs (no slashes)", () => {
    const R = 35, cx = 50, cy = 50, N = 48;
    const objects = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      const x2 = cx + (R - 12) * Math.cos(a), y2 = cy + (R - 12) * Math.sin(a);
      objects.push(makeObject("satin", [{ x, y }, { x: x2, y: y2 }], "c1"));
    }
    const design = generateDesign({ ...createEmptyProject(), objects }, { lockStitches: false });
    expect(design.some((s) => s.trim)).toBe(true); // exposed gaps are cut, not slashed
    let longest = 0;
    for (let i = 1; i < design.length; i++)
      if (!design[i].jump && !design[i].trim && design[i].colorId === design[i - 1].colorId)
        longest = Math.max(longest, Math.hypot(design[i].x - design[i - 1].x, design[i].y - design[i - 1].y));
    expect(longest).toBeLessThanOrEqual(9.1); // still machine-safe
  });
});

describe("satin lettering connectors (anti-slash across counters)", () => {
  // A glyph-like shape (an "H") is ONE connected fill region with several satin
  // columns and OPEN gaps between them (the counters). The bowls/stems must not be
  // joined by a bare same-region travel straight across a counter — that shows as a
  // thread slash. Satin connectors run hidden under the stitching or are trimmed.
  const H = [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 13 }, { x: 16, y: 13 },
    { x: 16, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 16, y: 30 },
    { x: 16, y: 17 }, { x: 4, y: 17 }, { x: 4, y: 30 }, { x: 0, y: 30 },
  ];

  it("never slashes across an open counter (longest stitch stays machine-safe)", () => {
    const glyph = makeObjectFromPaths("fill", [H], "c1");
    glyph.params = { ...glyph.params, fillStyle: "satin" };
    const design = generateDesign({ ...createEmptyProject(), objects: [glyph] }, { lockStitches: false });
    let longest = 0;
    for (let i = 1; i < design.length; i++) {
      const a = design[i - 1], b = design[i];
      if (!b.jump && !b.trim && a.colorId === b.colorId) {
        longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y));
      }
    }
    // The open gaps span 12mm; a bare slash would exceed the 9mm safety ceiling.
    expect(longest).toBeLessThanOrEqual(9.1);
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
