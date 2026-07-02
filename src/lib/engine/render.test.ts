import { describe, it, expect } from "vitest";
import type { EngineStitch } from "./index";
import { designToSegments, extendSegments, needleAt } from "./render";

const design: EngineStitch[] = [
  { x: 0, y: 0, colorId: "a", objectId: "o" },
  { x: 1, y: 0, colorId: "a", objectId: "o" },
  { x: 5, y: 5, colorId: "b", objectId: "p", jump: true, trim: true },
  { x: 5, y: 5, colorId: "b", objectId: "p" },
  { x: 6, y: 5, colorId: "b", objectId: "p" },
];

describe("designToSegments", () => {
  it("breaks segments at jumps and color boundaries", () => {
    const segs = designToSegments(design);
    expect(segs).toHaveLength(2);
    expect(segs[0].colorId).toBe("a");
    expect(segs[0].points).toHaveLength(2);
    expect(segs[1].colorId).toBe("b");
    expect(segs[1].points).toHaveLength(2);
  });

  it("respects the upTo cursor (partial redraw)", () => {
    const segs = designToSegments(design, 1);
    expect(segs).toHaveLength(1);
    expect(segs[0].points).toHaveLength(1);
  });
});

describe("needleAt", () => {
  it("returns the last real penetration, skipping jumps", () => {
    expect(needleAt(design, 5)).toEqual({ x: 6, y: 5 });
    // after 4 events (0..3): index 3 is the first stitch of color b
    expect(needleAt(design, 4)).toEqual({ x: 5, y: 5 });
    // after 3 events (0..2): index 2 is a jump, so the last real one is index 1
    expect(needleAt(design, 3)).toEqual({ x: 1, y: 0 });
    expect(needleAt(design, 0)).toBeNull();
  });

  it("handles a fractional cursor without indexing undefined (playback)", () => {
    // simIndex is a float mid-playback; needleAt/designToSegments must floor it,
    // not read design[4.7] (undefined) and crash on `.jump`.
    expect(needleAt(design, 4.7)).toEqual({ x: 5, y: 5 });
    expect(() => designToSegments(design, 3.9)).not.toThrow();
    expect(designToSegments(design, 3.9)).toEqual(designToSegments(design, 3));
  });
});

describe("extendSegments (playback fast-path)", () => {
  const mk = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    ({ x, y, colorId: "c1", objectId: "o", ...extra }) as EngineStitch;
  // A stream exercising every boundary the segmenter handles: color change,
  // underlay flip, jumps (also as the resume point), and a trailing run.
  const stream: EngineStitch[] = [
    mk(0, 0, { underlay: true }), mk(1, 0, { underlay: true }),
    mk(2, 0), mk(3, 0),
    mk(10, 0, { jump: true }),
    mk(10, 1), mk(11, 1),
    mk(12, 1, { colorId: "c2" }), mk(13, 1, { colorId: "c2" }),
    mk(20, 5, { jump: true, colorId: "c2" }),
    mk(20, 6, { colorId: "c2" }),
  ];

  it("stepwise extension is identical to a fresh full walk at every prefix", () => {
    const cache = { upTo: 0, segs: designToSegments(stream, 0) };
    for (let upTo = 0; upTo <= stream.length; upTo++) {
      extendSegments(stream, cache, upTo);
      expect(cache.segs).toEqual(designToSegments(stream, upTo));
    }
  });

  it("resumes correctly when the boundary event was a jump", () => {
    // Stop exactly ON the jump, then extend past it: the open segment must not
    // swallow the post-jump points.
    const cache = { upTo: 0, segs: designToSegments(stream, 5) };
    cache.upTo = 5;
    extendSegments(stream, cache, stream.length);
    expect(cache.segs).toEqual(designToSegments(stream, stream.length));
  });

  it("handles fractional upTo like designToSegments (floors)", () => {
    const cache = { upTo: 0, segs: [] as ReturnType<typeof designToSegments> };
    extendSegments(stream, cache, 3.7);
    expect(cache.segs).toEqual(designToSegments(stream, 3.7));
  });
});
