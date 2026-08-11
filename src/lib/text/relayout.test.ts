import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFont } from "./fonts";
import { nextSizeMm } from "./relayout";

vi.mock("./fonts", async (importActual) => {
  const actual = await importActual<typeof import("./fonts")>();
  const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "fonts");
  const buf = readFileSync(join(fontsDir, "Oswald-Medium.ttf"));
  const font = actual.parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return { ...actual, loadFont: vi.fn(async () => font) };
});

import { relayoutTextObject } from "./relayout";
import { layoutText } from "./layout";
import { pathsBounds } from "../geometry";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const buf = readFileSync(join(fontsDir, "Oswald-Medium.ttf"));
const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);

describe("relayoutTextObject", () => {
  it("resizes in place, preserving the center", async () => {
    const { object } = layoutText({ text: "HI", font, fontId: "oswald", heightMm: 10, colorId: "c", name: "HI" });
    object.text = { content: "HI", fontId: "oswald", heightMm: 10, letterSpacingMm: 0 };
    const before = pathsBounds(object.paths)!;
    const patch = await relayoutTextObject(object, { heightMm: 20 });
    expect(patch).toBeTruthy();
    const after = pathsBounds(patch!.paths)!;
    // Doubled height, same center within tolerance.
    expect((after.maxY - after.minY) / (before.maxY - before.minY)).toBeGreaterThan(1.7);
    expect(Math.abs((after.minX + after.maxX) / 2 - (before.minX + before.maxX) / 2)).toBeLessThan(0.2);
    expect(Math.abs((after.minY + after.maxY) / 2 - (before.minY + before.maxY) / 2)).toBeLessThan(0.2);
    expect(patch!.text!.heightMm).toBe(20);
  });

  it("steps the size ladder both ways", () => {
    expect(nextSizeMm(10, 1)).toBe(12);
    expect(nextSizeMm(10, -1)).toBe(8);
    expect(nextSizeMm(75, 1)).toBe(75);
    expect(nextSizeMm(4, -1)).toBe(4);
  });
});
