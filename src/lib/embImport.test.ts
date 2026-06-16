import { describe, it, expect } from "vitest";
import { buildImportedObjects } from "./embImport";
import type { ImportedPlan } from "./export";

/** Stitch-file import — reconstructing objects from a read embroidery plan. */

const plan: ImportedPlan = {
  blocks: [
    {
      rgb: 0xff0000,
      runs: [
        [
          [0, 0],
          [50, 0],
          [50, 50],
        ],
      ],
    },
    {
      rgb: 0x0000ff,
      runs: [
        [
          [100, 100],
          [120, 140],
        ],
        [[200, 200]], // single point — not a real run, dropped
      ],
    },
  ],
};

describe("buildImportedObjects", () => {
  it("makes one color per used block and a raw running object per run", () => {
    const { colors, objects } = buildImportedObjects(plan);
    expect(colors).toHaveLength(2);
    expect(colors[0].rgb).toEqual([255, 0, 0]);
    expect(colors[1].rgb).toEqual([0, 0, 255]);
    // 1 run in block 0 + 1 valid run in block 1 (the single-point run is dropped).
    expect(objects).toHaveLength(2);
    expect(objects.every((o) => o.type === "running")).toBe(true);
    expect(objects.every((o) => o.params.raw === true)).toBe(true);
  });

  it("converts 1/10 mm units to mm and preserves the points verbatim", () => {
    const { objects } = buildImportedObjects(plan);
    expect(objects[0].paths[0]).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it("assigns each object its block's color", () => {
    const { colors, objects } = buildImportedObjects(plan);
    expect(objects[0].colorId).toBe(colors[0].id);
    expect(objects[1].colorId).toBe(colors[1].id);
  });

  it("drops empty blocks (no usable runs) entirely", () => {
    const empty: ImportedPlan = { blocks: [{ rgb: 0, runs: [[[1, 1]]] }] };
    const { colors, objects } = buildImportedObjects(empty);
    expect(colors).toHaveLength(0);
    expect(objects).toHaveLength(0);
  });
});
