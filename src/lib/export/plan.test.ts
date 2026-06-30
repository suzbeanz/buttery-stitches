import { describe, it, expect } from "vitest";
import { packRgb, planFromDesign, planStitchCount, friendlyExportError } from "./index";
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

  it("blocks a single-color design and converts mm to 1/10 mm (raw positive coords)", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o" },
      { x: 2.5, y: 0, colorId: "a", objectId: "o" },
    ];
    const plan = planFromDesign(design, colors);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].rgb).toBe(0x2050c0);
    // Coordinates stay in the design's raw hoop space — never recentered on the
    // origin (negative coords corrupt the machine sew-out by clamping to the edge).
    expect(plan.blocks[0].cmds).toEqual([
      ["s", 0, 0],
      ["s", mmToTenths(2.5), 0],
    ]);
  });

  it("never emits a negative coordinate (machine clamps negatives to the hoop edge)", () => {
    // A design laid out in raw hoop coords stays positive through the plan, so the
    // machine places it inside the hoop instead of clamping the negative quadrants.
    const design: EngineStitch[] = [
      { x: 40, y: 40, colorId: "a", objectId: "o" },
      { x: 60, y: 60, colorId: "a", objectId: "o" },
    ];
    const plan = planFromDesign(design, colors);
    for (const c of plan.blocks.flatMap((b) => b.cmds)) {
      if (c[0] === "s" || c[0] === "j") {
        expect(c[1]).toBeGreaterThanOrEqual(0);
        expect(c[2]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("starts a new block on a color change", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o1" },
      { x: 5, y: 5, colorId: "b", objectId: "o2", jump: true, trim: true },
      { x: 5, y: 5, colorId: "b", objectId: "o2" },
    ];
    const plan = planFromDesign(design, colors);
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[1].rgb).toBe(0xff0000);
    // The color-change trim is implied by the block boundary, so the new
    // block starts with the jump (not a redundant trim cmd).
    expect(plan.blocks[1].cmds[0][0]).toBe("j");
    expect(planStitchCount(plan)).toBe(2); // two penetrations, one jump
  });

  it("emits within-color trims as explicit trim commands", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o1" },
      { x: 30, y: 0, colorId: "a", objectId: "o2", jump: true, trim: true },
      { x: 30, y: 0, colorId: "a", objectId: "o2" },
    ];
    const plan = planFromDesign(design, colors);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].cmds).toContainEqual(["t"]);
  });

  it("drops non-finite coordinates so they never reach the file", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o" },
      { x: NaN, y: 5, colorId: "a", objectId: "o" },
      { x: 5, y: Infinity, colorId: "a", objectId: "o" },
      { x: 3, y: 4, colorId: "a", objectId: "o" },
    ];
    const plan = planFromDesign(design, colors);
    const coords = plan.blocks.flatMap((b) => b.cmds);
    expect(coords).toHaveLength(2); // the two finite stitches only
    for (const c of coords) {
      if (c[0] === "s" || c[0] === "j") {
        expect(Number.isFinite(c[1]) && Number.isFinite(c[2])).toBe(true);
      }
    }
  });

  it("keeps blocks in stitch order across several color changes", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o1" },
      { x: 1, y: 0, colorId: "b", objectId: "o2" },
      { x: 2, y: 0, colorId: "a", objectId: "o3" }, // back to a — a fresh block, not merged
    ];
    const plan = planFromDesign(design, colors);
    expect(plan.blocks.map((b) => b.rgb)).toEqual([0x2050c0, 0xff0000, 0x2050c0]);
  });

  it("handles an empty design without throwing", () => {
    const plan = planFromDesign([], colors);
    expect(plan.blocks).toHaveLength(0);
    expect(planStitchCount(plan)).toBe(0);
  });
});

describe("friendlyExportError", () => {
  it("maps engine load / network failures to a connection hint", () => {
    expect(friendlyExportError(new Error("Failed to load the Pyodide runtime script."))).toMatch(/export engine/i);
    expect(friendlyExportError(new Error("TypeError: Failed to fetch"))).toMatch(/connection/i);
  });

  it("maps a pyembroidery traceback to a writeable-format hint, not a stack", () => {
    const msg = friendlyExportError(new Error("Traceback (most recent call last):\n  File ...\n  in write_dst\nValueError: bad"));
    expect(msg).toMatch(/couldn't be written/i);
    expect(msg).not.toMatch(/Traceback/);
  });

  it("falls back to the last meaningful line, capped", () => {
    expect(friendlyExportError(new Error("something odd happened"))).toBe("something odd happened");
    expect(friendlyExportError(new Error("a\n\n  the real reason  "))).toBe("the real reason");
  });
});
