import { describe, it, expect } from "vitest";
import { packRgb, planFromDesign, planStitchCount, friendlyExportError, centerBlocks } from "./index";
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

  it("blocks a single-color design, converts mm to 1/10 mm, and centers on origin", () => {
    const design: EngineStitch[] = [
      { x: 0, y: 0, colorId: "a", objectId: "o" },
      { x: 2.5, y: 0, colorId: "a", objectId: "o" },
    ];
    const plan = planFromDesign(design, colors);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].rgb).toBe(0x2050c0);
    // The design is recentered on its bbox: x spans 0..25 (1/10 mm), center 13,
    // so the two stitches land at -13 and 12 — still mmToTenths(2.5)=25 apart.
    expect(plan.blocks[0].cmds).toEqual([
      ["s", -13, 0],
      ["s", 12, 0],
    ]);
    const [, x0] = plan.blocks[0].cmds[0] as ["s", number, number];
    const [, x1] = plan.blocks[0].cmds[1] as ["s", number, number];
    expect(x1 - x0).toBe(mmToTenths(2.5));
  });

  it("centers an off-center design on the origin (no corner-parking on the machine)", () => {
    // A design laid out in raw hoop coords (40..60 mm) must export centered, or
    // the machine sews it parked ~half a hoop into a corner.
    const design: EngineStitch[] = [
      { x: 40, y: 40, colorId: "a", objectId: "o" },
      { x: 60, y: 60, colorId: "a", objectId: "o" },
    ];
    const plan = planFromDesign(design, colors);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of plan.blocks.flatMap((b) => b.cmds)) {
      if (c[0] === "s" || c[0] === "j") {
        minX = Math.min(minX, c[1]); maxX = Math.max(maxX, c[1]);
        minY = Math.min(minY, c[2]); maxY = Math.max(maxY, c[2]);
      }
    }
    // bbox center within a rounding unit of (0,0).
    expect(Math.abs(minX + maxX)).toBeLessThanOrEqual(1);
    expect(Math.abs(minY + maxY)).toBeLessThanOrEqual(1);
    // extent preserved (20mm = 200 1/10mm each axis).
    expect(maxX - minX).toBe(mmToTenths(20));
  });

  it("centerBlocks leaves an already-centered design unchanged (oracle inputs)", () => {
    const blocks = [{ rgb: 0x2050c0, cmds: [["s", -100, -100], ["s", 100, 100]] as const }];
    expect(centerBlocks(blocks as never)).toEqual(blocks);
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
