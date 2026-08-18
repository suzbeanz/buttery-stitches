import { describe, it, expect } from "vitest";
import { livePaintObjects } from "../trace/livepaint";
import { fixStitches } from "../fix";
import { generateDesign } from "../engine";
import { sweepObject } from "./sweep";
import { createEmptyProject } from "../project";
import type { Project } from "../../types/project";

/**
 * PRODUCT-SEQUENCE gates for the Live-Paint wizard path: exactly what the
 * dialog does — livePaintObjects → (no fringe consolidation) → fixStitches →
 * generateDesign — asserted end to end, so a change anywhere in that chain
 * that breaks the fills-first-ink-last contract or sews unsafely fails here
 * by name.
 */

function build(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  return { width: w, height: h, data } as ImageData;
}

/** Outlined 2×2 rooms (blue/white/red/blue) — the synthetic cartoon. */
function fixture(): ImageData {
  return build(480, 480, (x, y) => {
    const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
    if (!(x >= 40 && x < 440 && y >= 40 && y < 440)) return CLEAR;
    const onOuter = x < 52 || x >= 428 || y < 52 || y >= 428;
    const onVert = x >= 234 && x < 246;
    const onHoriz = y >= 234 && y < 246;
    if (onOuter || onVert || onHoriz) return [20, 20, 24, 255];
    const left = x < 240;
    const top = y < 240;
    if (top && left) return [60, 180, 240, 255];
    if (top && !left) return [252, 252, 252, 255];
    if (!top && left) return [210, 20, 45, 255];
    return [60, 180, 240, 255];
  });
}

describe("live-paint pipeline gates", () => {
  const res = livePaintObjects(fixture(), 5, {
    mmPerPx: 0.2,
    offsetX: 0,
    offsetY: 0,
    removeBackground: true,
  });
  const project: Project = {
    ...createEmptyProject(),
    widthMm: 96,
    heightMm: 96,
    colors: res.colors,
    objects: res.objects,
  };
  const fixed = fixStitches(project);
  const design = generateDesign(fixed);

  it("sews the ink as the FINAL color block", () => {
    const ink = fixed.objects[fixed.objects.length - 1];
    expect(ink.params.lineArt).toBe(true);
    const inkColor = ink.colorId;
    // Once the ink color starts sewing, no other color follows it.
    let seenInk = false;
    for (const s of design) {
      if (s.colorId === inkColor) seenInk = true;
      else expect(seenInk, "a non-ink stitch after the ink block").toBe(false);
    }
    expect(seenInk).toBe(true);
  });

  it("every stitch is machine-safe (≤ 9mm)", () => {
    let longest = 0;
    for (let i = 1; i < design.length; i++) {
      if (design[i].jump || design[i].trim || design[i].colorId !== design[i - 1].colorId) continue;
      longest = Math.max(
        longest,
        Math.hypot(design[i].x - design[i - 1].x, design[i].y - design[i - 1].y),
      );
    }
    expect(longest).toBeLessThanOrEqual(9);
  });

  it("keeps trims at professional counts (the network sews connected)", () => {
    // The commercial reference files trim 9-22 times per 10k stitches (a Wilcom
    // production sheet lists 12 for 13.5k). This fixture's ink is ONE connected
    // grid — the skeleton router sews it as a single pass, so the only cuts are
    // the color changes plus the ink entry. 8 = 3 color changes + entry + slack.
    const trims = design.filter((s) => s.trim).length;
    expect(trims).toBeLessThanOrEqual(8);
  });

  it("each piece passes the sweep coverage bar", () => {
    fixed.objects.forEach((o, i) => {
      const s = sweepObject(o, i);
      if (!s) return;
      expect(s.coverage, `coverage of ${o.name}`).toBeGreaterThanOrEqual(0.9);
      expect(s.maxSegMm, `max segment of ${o.name}`).toBeLessThanOrEqual(9);
    });
  });
});
