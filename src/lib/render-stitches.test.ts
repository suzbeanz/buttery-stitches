import { describe, it, expect } from "vitest";
import { drawStitches, shadeRgb } from "./render-stitches";
import type { RenderSegment } from "./engine/render";
import type { ThreadColor } from "../types/project";

/** A minimal CanvasRenderingContext2D recorder — captures the calls drawStitches
 *  makes so we can assert behavior without a real canvas. */
function fakeCtx() {
  const calls: { strokes: number; moveTos: number; lineTos: number } = {
    strokes: 0,
    moveTos: 0,
    lineTos: 0,
  };
  const ctx = {
    lineCap: "",
    lineJoin: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    beginPath() {},
    moveTo() {
      calls.moveTos++;
    },
    lineTo() {
      calls.lineTos++;
    },
    stroke() {
      calls.strokes++;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const colors: ThreadColor[] = [{ id: "c1", rgb: [200, 30, 30], name: "Red" }];
const colorById = new Map(colors.map((c) => [c.id, c]));
const opts = (realistic: boolean) => ({
  colorById,
  px: (x: number) => x,
  py: (y: number) => y,
  threadPx: 2,
  realistic,
});
const seg = (underlay: boolean): RenderSegment => ({
  colorId: "c1",
  underlay,
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
});

describe("drawStitches (shared stitch painter)", () => {
  it("flat mode strokes each segment once", () => {
    const { ctx, calls } = fakeCtx();
    drawStitches(ctx, [seg(false)], opts(false));
    expect(calls.strokes).toBe(1);
    expect(calls.lineTos).toBe(1);
  });

  it("realistic mode layers multiple passes per segment (halo, body, core, fibers)", () => {
    const flat = fakeCtx();
    drawStitches(flat.ctx, [seg(false)], opts(false));
    const real = fakeCtx();
    drawStitches(real.ctx, [seg(false)], opts(true));
    expect(real.calls.strokes).toBeGreaterThan(flat.calls.strokes);
  });

  it("draws underlay as its own thin faint pass and skips degenerate segments", () => {
    const { ctx, calls } = fakeCtx();
    drawStitches(ctx, [seg(true), { colorId: "c1", underlay: false, points: [{ x: 0, y: 0 }] }], opts(false));
    expect(calls.strokes).toBe(1); // single-point segment is skipped
  });

  it("shadeRgb clamps and scales channels", () => {
    expect(shadeRgb([100, 100, 100], 1)).toBe("rgb(100,100,100)");
    expect(shadeRgb([200, 200, 200], 2)).toBe("rgb(255,255,255)"); // clamped
    expect(shadeRgb([100, 100, 100], 0.5)).toBe("rgb(50,50,50)");
  });
});
