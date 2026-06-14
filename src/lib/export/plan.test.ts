import { describe, it, expect } from "vitest";
import { packRgb, planFromDesign, planStitchCount } from "./index";
import type { EngineStitch } from "../engine";
import { mmToTenths } from "../units";

const colors = [
  { id: "a", rgb: [0x20, 0x50, 0xc0] as [number, number, number] },
  { id: "b", rgb: [255, 0, 0] as [number, number, number] },
];

describe("export plan", () => {
  it("packs an rgb triple into 0xRRGGBB", () => {
    expect(packRgb({ id: "c", rgb: [0x20, 0x50, 0xc0] })).toBe(0x2050c0);
    expect(packRgb({ id: "c", rgb: [255, 255, 255] })).toBe(0xffffff);
  });

  it("blocks a single-colour design and converts mm to 1/10 mm", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o" },
      { x: 2.5, y: 0, colorId: "a", objectId: "o" },
    ];
    const plan = planFromDesign(design, colors);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].rgb).toBe(0x2050c0);
    expect(plan.blocks[0].cmds).toEqual([
      ["s", 0, 0],
      ["s", mmToTenths(2.5), 0],
    ]);
  });

  it("starts a new block on a colour change", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o1" },
      { x: 5, y: 5, colorId: "b", objectId: "o2", jump: true, trim: true },
      { x: 5, y: 5, colorId: "b", objectId: "o2" },
    ];
    const plan = planFromDesign(design, colors);
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[1].rgb).toBe(0xff0000);
    // The colour-change trim is implied by the block boundary, so the new
    // block starts with the jump (not a redundant trim cmd).
    expect(plan.blocks[1].cmds[0][0]).toBe("j");
    expect(planStitchCount(plan)).toBe(2); // two penetrations, one jump
  });

  it("emits within-colour trims as explicit trim commands", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o1" },
      { x: 30, y: 0, colorId: "a", objectId: "o2", jump: true, trim: true },
      { x: 30, y: 0, colorId: "a", objectId: "o2" },
    ];
    const plan = planFromDesign(design, colors);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].cmds).toContainEqual(["t"]);
  });
});
