import { describe, it, expect } from "vitest";
import {
  isCoarsePointer,
  effectiveKeepRatio,
  meanScaleOf,
  bakeMatrixOnPaths,
  bakeMatrixOnNodes,
  scaleTextSpec,
  type MmSpace,
} from "./transform";
import type { Matrix } from "./geometry";
import type { NodePath, TextSpec } from "../types/project";

/** Screen == mm (scale 1, no offset) — matrix effects read directly in mm. */
const IDENTITY_SPACE: MmSpace = {
  px: (x) => x,
  py: (y) => y,
  toMm: (x, y) => ({ x, y }),
};

/** A realistic stage mapping: 3px per mm with a panned origin. The bake must
 *  return the same MM result as the identity space for a mm-space transform. */
const OFFSET_SPACE: MmSpace = {
  px: (x) => x * 3 + 40,
  py: (y) => y * 3 + 25,
  toMm: (x, y) => ({ x: (x - 40) / 3, y: (y - 25) / 3 }),
};

const IDENT: Matrix = [1, 0, 0, 1, 0, 0];
const SCALE2: Matrix = [2, 0, 0, 2, 0, 0];
const STRETCH_X: Matrix = [2, 0, 0, 0.5, 0, 0];
const ROT90: Matrix = [0, 1, -1, 0, 0, 0]; // 90° CCW in screen coords

describe("effectiveKeepRatio", () => {
  it("follows the lock when Shift is up", () => {
    expect(effectiveKeepRatio(true, false)).toBe(true);
    expect(effectiveKeepRatio(false, false)).toBe(false);
  });
  it("Shift inverts the lock, whichever way it points", () => {
    expect(effectiveKeepRatio(true, true)).toBe(false);
    expect(effectiveKeepRatio(false, true)).toBe(true);
  });
});

describe("isCoarsePointer", () => {
  it("is safely false without a browser matchMedia", () => {
    expect(isCoarsePointer()).toBe(false);
  });
});

describe("meanScaleOf", () => {
  it("is 1 for identity and pure rotation", () => {
    expect(meanScaleOf(IDENT)).toBeCloseTo(1, 9);
    expect(meanScaleOf(ROT90)).toBeCloseTo(1, 9);
  });
  it("is the uniform factor for a uniform scale", () => {
    expect(meanScaleOf(SCALE2)).toBeCloseTo(2, 9);
  });
  it("is area-true for a non-uniform stretch", () => {
    expect(meanScaleOf(STRETCH_X)).toBeCloseTo(1, 9); // 2 × 0.5 area factor
  });
  it("never returns 0 for a degenerate matrix", () => {
    expect(meanScaleOf([0, 0, 0, 0, 0, 0])).toBe(1);
  });
});

describe("bakeMatrixOnPaths", () => {
  const square = [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ],
  ];

  it("applies a scale about the screen origin in mm space", () => {
    const out = bakeMatrixOnPaths(square, SCALE2, IDENTITY_SPACE);
    expect(out[0][2]).toEqual({ x: 20, y: 12 });
  });

  it("translation in screen px maps back through the stage scale", () => {
    // +30px x under 3px/mm = +10mm.
    const out = bakeMatrixOnPaths(square, [1, 0, 0, 1, 30, 0], OFFSET_SPACE);
    expect(out[0][0].x).toBeCloseTo(10, 9);
    expect(out[0][0].y).toBeCloseTo(0, 9);
  });

  it("a scale about a point in OFFSET space keeps mm geometry consistent", () => {
    // Screen-space scale ×2 about the stage origin pixel (40,25): the mm point
    // (0,0) sits AT that pixel and must not move; spans double.
    const m: Matrix = [2, 0, 0, 2, -40, -25];
    const out = bakeMatrixOnPaths(square, m, OFFSET_SPACE);
    expect(out[0][0].x).toBeCloseTo(0, 9);
    expect(out[0][0].y).toBeCloseTo(0, 9);
    expect(out[0][1].x).toBeCloseTo(20, 9);
  });
});

describe("bakeMatrixOnNodes", () => {
  const ring: NodePath = [
    { x: 5, y: 0, smooth: true, hIn: { x: -2, y: 0 }, hOut: { x: 2, y: 0 } },
    { x: 10, y: 5, smooth: false },
  ];

  it("scales anchor points and Bézier handles together", () => {
    const out = bakeMatrixOnNodes([ring], SCALE2, IDENTITY_SPACE);
    expect(out[0][0].x).toBeCloseTo(10, 9);
    expect(out[0][0].hOut!.x).toBeCloseTo(4, 9);
    expect(out[0][0].hIn!.x).toBeCloseTo(-4, 9);
  });

  it("rotates handles through the matrix's linear part only", () => {
    const out = bakeMatrixOnNodes([ring], ROT90, IDENTITY_SPACE);
    // Anchor (5,0) rotates to (0,5); the +x handle now points +y.
    expect(out[0][0].x).toBeCloseTo(0, 9);
    expect(out[0][0].y).toBeCloseTo(5, 9);
    expect(out[0][0].hOut!.x).toBeCloseTo(0, 9);
    expect(out[0][0].hOut!.y).toBeCloseTo(2, 9);
  });

  it("preserves smooth flags and leaves absent handles absent", () => {
    const out = bakeMatrixOnNodes([ring], SCALE2, OFFSET_SPACE);
    expect(out[0][0].smooth).toBe(true);
    expect(out[0][1].smooth).toBe(false);
    expect(out[0][1].hIn).toBeUndefined();
    expect(out[0][1].hOut).toBeUndefined();
  });

  it("handle vectors are unchanged by the stage's px offset (relative mm)", () => {
    const out = bakeMatrixOnNodes([ring], IDENT, OFFSET_SPACE);
    expect(out[0][0].hOut).toEqual({ x: 2, y: 0 });
    expect(out[0][0].x).toBeCloseTo(5, 9);
  });
});

describe("scaleTextSpec", () => {
  const text = {
    heightMm: 10,
    letterSpacingMm: 1.5,
    circleRadiusMm: 20,
    pathMm: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
    glyphTweaks: { 1: { dx: 2, dy: -1, rotDeg: 15 }, 2: { scale: 1.2 } },
  } as unknown as TextSpec;

  it("scales scalar mm sizes by the mean scale", () => {
    const patch = scaleTextSpec(text, SCALE2, IDENTITY_SPACE);
    expect(patch.heightMm).toBeCloseTo(20, 9);
    expect(patch.letterSpacingMm).toBeCloseTo(3, 9);
    expect(patch.circleRadiusMm).toBeCloseTo(40, 9);
  });

  it("keeps scalar sizes area-true under a pure stretch (mean scale 1)", () => {
    const patch = scaleTextSpec(text, STRETCH_X, IDENTITY_SPACE);
    expect(patch.heightMm).toBeCloseTo(10, 9);
  });

  it("runs the baseline path through the full matrix", () => {
    const patch = scaleTextSpec(text, ROT90, IDENTITY_SPACE);
    expect(patch.pathMm![1].x).toBeCloseTo(0, 9);
    expect(patch.pathMm![1].y).toBeCloseTo(30, 9);
  });

  it("scales glyph nudges but preserves their other fields", () => {
    const patch = scaleTextSpec(text, SCALE2, IDENTITY_SPACE);
    expect(patch.glyphTweaks![1].dx).toBeCloseTo(4, 9);
    expect(patch.glyphTweaks![1].dy).toBeCloseTo(-2, 9);
    expect(patch.glyphTweaks![1].rotDeg).toBe(15);
    expect(patch.glyphTweaks![2].scale).toBe(1.2);
    expect(patch.glyphTweaks![2].dx).toBeUndefined();
  });

  it("omits optional fields the spec does not carry", () => {
    const bare = { heightMm: 8, letterSpacingMm: 0 } as unknown as TextSpec;
    const patch = scaleTextSpec(bare, SCALE2, IDENTITY_SPACE);
    expect("circleRadiusMm" in patch).toBe(false);
    expect("pathMm" in patch).toBe(false);
    expect("glyphTweaks" in patch).toBe(false);
  });
});
