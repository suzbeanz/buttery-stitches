import type { Path, Point, TextSpec } from "../types/project";
import type { NodePath } from "./nodes";
import { applyMatrix, type Matrix } from "./geometry";

/**
 * Selection-transform math: everything the canvas needs to bake a finished
 * Konva transform (scale/rotate from the handles) back into millimeter
 * geometry, plus the input-aware aspect-ratio policy. Pure functions only —
 * the px↔mm mapping comes in as callbacks so the math is testable without a
 * stage.
 */

/** The stage's screen↔millimeter mapping (a uniform scale + translation). */
export interface MmSpace {
  px: (xMm: number) => number;
  py: (yMm: number) => number;
  toMm: (xPx: number, yPx: number) => Point;
}

/**
 * True on touch-first devices (phones/tablets), where the primary pointer is a
 * finger. Drives the transform defaults: bigger handle hit areas and
 * corner-resize locking aspect ratio. Guarded so it's safely false in
 * SSR/jsdom/test environments without matchMedia.
 */
export function isCoarsePointer(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches
    );
  } catch {
    return false;
  }
}

/**
 * Should a corner-anchor resize keep the object's aspect ratio right now?
 * The user's lock state is the base; holding Shift inverts it momentarily
 * (Figma/Illustrator convention), whichever way the base points. (Konva side
 * anchors ignore keepRatio entirely, so this only ever affects corners.)
 */
export function effectiveKeepRatio(aspectLocked: boolean, shiftHeld: boolean): boolean {
  return shiftHeld ? !aspectLocked : aspectLocked;
}

/**
 * Area-true mean scale of a transform matrix — what scalar millimeter sizes
 * (a satin's column width, a text spec's letter height) grow by under it.
 */
export function meanScaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

/** Apply a screen-space Konva matrix to millimeter paths: mm → px → matrix → mm. */
export function bakeMatrixOnPaths(paths: Path[], m: Matrix, s: MmSpace): Path[] {
  const pxPaths = paths.map((path) => path.map((p) => ({ x: s.px(p.x), y: s.py(p.y) })));
  return applyMatrix(pxPaths, m).map((path) => path.map((p) => s.toMm(p.x, p.y)));
}

/**
 * Apply a screen-space Konva matrix to control-node rings, keeping them
 * curve-editable: anchor points ride the full matrix like path points, while
 * Bézier handles — relative mm vectors — take only its LINEAR part
 * (rotation/scale, no translation), which commutes with the uniform mm→px
 * scale. Smoothness flags survive untouched.
 */
export function bakeMatrixOnNodes(nodeRings: NodePath[], m: Matrix, s: MmSpace): NodePath[] {
  const linear = (v: { x: number; y: number }) => ({
    x: m[0] * v.x + m[2] * v.y,
    y: m[1] * v.x + m[3] * v.y,
  });
  const pxNodes = nodeRings.map((r) => r.map((nd) => ({ x: s.px(nd.x), y: s.py(nd.y) })));
  return applyMatrix(pxNodes, m).map((r, ri) =>
    r.map((p, pi) => {
      const src = nodeRings[ri][pi];
      return {
        ...s.toMm(p.x, p.y),
        smooth: src.smooth,
        hIn: src.hIn ? linear(src.hIn) : undefined,
        hOut: src.hOut ? linear(src.hOut) : undefined,
      };
    }),
  );
}

/**
 * Scale a text object's layout RECIPE with its transform so a later relayout
 * (A−/A+, re-edit) reproduces the resized text instead of reverting: baseline
 * path points ride the full matrix (like paths); scalar mm sizes take the mean
 * scale; glyph nudges are mm offsets and scale the same way.
 */
export function scaleTextSpec(text: TextSpec, m: Matrix, s: MmSpace): Partial<TextSpec> {
  const meanScale = meanScaleOf(m);
  return {
    heightMm: text.heightMm * meanScale,
    letterSpacingMm: text.letterSpacingMm * meanScale,
    ...(text.circleRadiusMm !== undefined
      ? { circleRadiusMm: text.circleRadiusMm * meanScale }
      : {}),
    ...(text.pathMm
      ? { pathMm: bakeMatrixOnPaths([text.pathMm], m, s)[0] }
      : {}),
    ...(text.glyphTweaks
      ? {
          glyphTweaks: Object.fromEntries(
            Object.entries(text.glyphTweaks).map(([k, t]) => [
              k,
              {
                ...t,
                dx: t.dx !== undefined ? t.dx * meanScale : undefined,
                dy: t.dy !== undefined ? t.dy * meanScale : undefined,
              },
            ]),
          ),
        }
      : {}),
  };
}
