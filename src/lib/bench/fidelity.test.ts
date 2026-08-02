import { describe, it, expect } from "vitest";
import { fidelityScore, type FidelityResult } from "./fidelity";
import type { RasterImage } from "../trace/quantize";
import type { EngineStitch } from "../engine";
import type { ThreadColor } from "../../types/project";

/**
 * The fidelity metric must reward stitches that land where the image's colors
 * are and punish stitches that miss, spill, or skip regions — and it must be
 * perfectly deterministic, because the corpus ratchet gates CI with it.
 */

const red: ThreadColor = { id: "c-red", rgb: [210, 40, 40], name: "Red" };
const blue: ThreadColor = { id: "c-blue", rgb: [40, 70, 200], name: "Blue" };

/** Solid-color source: a red 20×20 mm square at (5,5)–(25,25) on transparent,
 *  at 0.5 mm/px (60×60 px canvas). */
function redSquareImage(): RasterImage {
  const w = 60;
  const h = 60;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = x >= 10 && x < 50 && y >= 10 && y < 50;
      data[i] = 210;
      data[i + 1] = 40;
      data[i + 2] = 40;
      data[i + 3] = inside ? 255 : 0;
    }
  return { width: w, height: h, data };
}

/** A dense serpentine covering (x0,y0)–(x1,y1) with `pitch` mm rows. */
function serpentine(
  colorId: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pitch = 0.3,
): EngineStitch[] {
  const out: EngineStitch[] = [];
  let flip = false;
  for (let y = y0; y <= y1 + 1e-9; y += pitch) {
    const [a, b] = flip ? [x1, x0] : [x0, x1];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      out.push({ x: a + (b - a) * t, y, colorId, objectId: "o1" });
    }
    flip = !flip;
  }
  return out;
}

const MM_PER_PX = 0.5;

describe("fidelityScore", () => {
  it("scores a faithful reproduction high", () => {
    const r = fidelityScore(redSquareImage(), serpentine("c-red", 5, 5, 25, 25), [red], MM_PER_PX, { removeBackground: false })!;
    expect(r.score).toBeGreaterThan(85);
    expect(r.regionIoU).toBeGreaterThan(0.9);
    expect(r.chamferMm).toBeLessThan(0.4);
    expect(r.spill).toBeLessThan(0.05);
  });

  it("punishes stitches sewn in the wrong place", () => {
    const good = fidelityScore(redSquareImage(), serpentine("c-red", 5, 5, 25, 25), [red], MM_PER_PX, { removeBackground: false })!;
    const offset = fidelityScore(redSquareImage(), serpentine("c-red", 12, 12, 32, 32), [red], MM_PER_PX, { removeBackground: false })!;
    expect(offset.score).toBeLessThan(good.score - 15);
    expect(offset.spill).toBeGreaterThan(0.2); // hangs off the shape onto background
  });

  it("punishes a skipped region", () => {
    // Source wants red AND blue halves; the design only sews the red half.
    const w = 60, h = 60;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inside = x >= 10 && x < 50 && y >= 10 && y < 50;
        const isRed = x < 30;
        data[i] = isRed ? 210 : 40;
        data[i + 1] = isRed ? 40 : 70;
        data[i + 2] = isRed ? 40 : 200;
        data[i + 3] = inside ? 255 : 0;
      }
    const img: RasterImage = { width: w, height: h, data };
    const colors = [red, blue];
    const both = fidelityScore(
      img,
      [...serpentine("c-red", 5, 5, 15, 25), ...serpentine("c-blue", 15, 5, 25, 25)],
      colors,
      MM_PER_PX,
      { removeBackground: false },
    )!;
    const half = fidelityScore(img, serpentine("c-red", 5, 5, 15, 25), colors, MM_PER_PX, {
      removeBackground: false,
    })!;
    expect(both.score).toBeGreaterThan(half.score + 10);
  });

  it("reports thread-gamut error honestly (off-color thread lowers deltaE term)", () => {
    const offThread: ThreadColor = { id: "c-red", rgb: [120, 90, 200], name: "Wrong" };
    const good = fidelityScore(redSquareImage(), serpentine("c-red", 5, 5, 25, 25), [red], MM_PER_PX, { removeBackground: false })!;
    const off = fidelityScore(redSquareImage(), serpentine("c-red", 5, 5, 25, 25), [offThread], MM_PER_PX, { removeBackground: false })!;
    expect(off.deltaE).toBeGreaterThan(good.deltaE + 20);
    expect(off.score).toBeLessThan(good.score);
  });

  it("is deterministic", () => {
    const run = (): FidelityResult =>
      fidelityScore(redSquareImage(), serpentine("c-red", 5, 5, 25, 25), [red], MM_PER_PX, { removeBackground: false })!;
    expect(run()).toEqual(run());
  });

  it("returns null when there is nothing to compare", () => {
    expect(fidelityScore(redSquareImage(), [], [red], MM_PER_PX)).toBeNull();
    const empty: RasterImage = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
    expect(fidelityScore(empty, serpentine("c-red", 0, 0, 2, 2), [red], MM_PER_PX)).toBeNull();
  });
});
