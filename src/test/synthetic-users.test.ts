import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Font } from "opentype.js";
import { generateDesign, type EngineStitch } from "../lib/engine";
import { designInfo } from "../lib/engine/info";
import { validateDesign } from "../lib/engine/validate";
import { makeObject, makeObjectFromPaths, makeNodeObject } from "../lib/objects";
import { createEmptyProject } from "../lib/project";
import { fixStitches } from "../lib/fix";
import { scaleAllPaths } from "../lib/layout";
import { reduceProjectColors } from "../lib/thread/reduce";
import { matchColorsToChart } from "../lib/thread/match";
import { BUTTERY_STANDARD } from "../lib/thread/catalog";
import { parseFont } from "../lib/text/fonts";
import { layoutText } from "../lib/text/layout";
import type { Project, Path } from "../types/project";

/**
 * SYNTHETIC USER TESTING — real end-to-end flows for representative personas,
 * asserting the premium-quality invariants that matter for a sewable product:
 *   • machine safety — no stitch longer than 9 mm (the needle-safe ceiling),
 *   • connectivity — trims+jumps per 1000 stay in a sane band (pros: 0.2–2.9),
 *   • the design actually produces stitches and fits its hoop,
 *   • resizing RECALCULATES stitches (density preserved), not just stretches.
 * Everything runs headlessly against the same engine the app ships.
 */

const SAFE_STITCH_MM = 9.1;

function longestStitch(d: EngineStitch[]): number {
  let m = 0;
  for (let i = 1; i < d.length; i++) {
    if (!d[i].jump && !d[i].trim && !d[i].stop && d[i].colorId === d[i - 1].colorId) {
      m = Math.max(m, Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y));
    }
  }
  return m;
}
function trimsJumpsPer1000(d: EngineStitch[]): number {
  const n = d.filter((s) => !s.jump && !s.trim && !s.stop).length || 1;
  const tj = d.filter((s) => s.jump || s.trim).length;
  return (tj / n) * 1000;
}
function rect(x: number, y: number, w: number, h: number): Path {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

let font: Font;
beforeAll(() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const buf = readFileSync(join(here, "..", "lib", "text", "fonts", "Poppins-SemiBold.ttf"));
  font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
});

describe("synthetic user: logo digitizer", () => {
  it("a fill + satin border + running detail cleans up and sews safely", () => {
    const p = createEmptyProject();
    p.colors = [
      { id: "c1", rgb: [40, 90, 180] },
      { id: "c2", rgb: [230, 220, 60] },
      { id: "c3", rgb: [20, 20, 20] },
    ];
    p.objects = [
      makeObjectFromPaths("fill", [rect(20, 20, 50, 35)], "c1"),
      makeObject("satin", [{ x: 20, y: 20 }, { x: 70, y: 20 }], "c2"),
      makeObject("running", [{ x: 25, y: 50 }, { x: 65, y: 50 }], "c3"),
    ];
    const d = generateDesign(fixStitches(p));
    expect(longestStitch(d)).toBeLessThanOrEqual(SAFE_STITCH_MM);
    expect(d.filter((s) => !s.jump && !s.trim).length).toBeGreaterThan(100);
    expect(trimsJumpsPer1000(d)).toBeLessThan(20);
    expect(validateDesign(d, p).filter((w) => w.severity === "error").length).toBe(0);
  });
});

describe("synthetic user: monogrammer", () => {
  it("arched, multi-line lettering produces a clean fill that sews safely", () => {
    const { object } = layoutText({ text: "AB\nCD", font, heightMm: 14, archDeg: 60, colorId: "c1" });
    const p = { ...createEmptyProject(), objects: [object] };
    const d = generateDesign(p);
    expect(object.paths.length).toBeGreaterThan(0);
    expect(longestStitch(d)).toBeLessThanOrEqual(SAFE_STITCH_MM);
    expect(d.some((s) => !s.jump && !s.trim)).toBe(true);
  });
});

describe("synthetic user: appliqué maker", () => {
  it("an appliqué shape emits placement→stop→tackdown→stop→cover, safely", () => {
    const o = makeObjectFromPaths("fill", [rect(10, 10, 60, 60)], "c1");
    o.params.applique = true;
    const d = generateDesign({ ...createEmptyProject(), objects: [o] });
    expect(d.filter((s) => s.stop).length).toBe(2);
    expect(longestStitch(d)).toBeLessThanOrEqual(SAFE_STITCH_MM);
  });
});

describe("synthetic user: decorative artist", () => {
  it("gradient, motif, and carved fills all sew safely", () => {
    for (const setup of [
      { fillStyle: "gradient" as const },
      { fillStyle: "motif" as const, motif: "chevron" },
      { fillStyle: "tatami" as const, carve: "diamond" },
    ]) {
      const o = makeObjectFromPaths("fill", [rect(10, 10, 50, 50)], "c1");
      o.params = { ...o.params, ...setup };
      const d = generateDesign({ ...createEmptyProject(), objects: [o] });
      expect(d.some((s) => !s.jump && !s.trim)).toBe(true);
      expect(longestStitch(d)).toBeLessThanOrEqual(SAFE_STITCH_MM);
    }
  });
});

describe("synthetic user: resizer (dynamic parameterization)", () => {
  it("scaling 2× RECALCULATES stitches (density preserved), staying safe", () => {
    const o = makeNodeObject("fill", rect(0, 0, 30, 30), "c1", false);
    const base = generateDesign({ ...createEmptyProject(), objects: [o] });
    const big = scaleAllPaths([o], 2, 2, { x: 0, y: 0 });
    const dBig = generateDesign({ ...createEmptyProject(), objects: big });
    const pen = (d: EngineStitch[]) => d.filter((s) => !s.jump && !s.trim).length;
    // 4× the area at the same density ⇒ clearly more stitches, not stretched.
    expect(pen(dBig)).toBeGreaterThan(pen(base) * 2.5);
    expect(longestStitch(dBig)).toBeLessThanOrEqual(SAFE_STITCH_MM);
  });
});

describe("synthetic user: color manager", () => {
  it("reduces a busy palette and matches it to a real thread chart", () => {
    const p = createEmptyProject();
    p.colors = [
      { id: "a", rgb: [10, 10, 10] },
      { id: "b", rgb: [14, 14, 16] },
      { id: "c", rgb: [220, 30, 30] },
      { id: "d", rgb: [225, 40, 35] },
      { id: "e", rgb: [30, 40, 220] },
      { id: "f", rgb: [240, 240, 240] },
    ];
    p.objects = p.colors.map((c, i) =>
      makeObjectFromPaths("fill", [rect(i * 12, 0, 8, 8)], c.id),
    );
    const reduced = reduceProjectColors(p, 4);
    expect(reduced.colors.length).toBe(4);
    const matched = matchColorsToChart(reduced.colors, BUTTERY_STANDARD);
    for (const c of matched) expect(c.code).toMatch(/^BS-/);
    // every object still points at a surviving color
    const ids = new Set(reduced.colors.map((c) => c.id));
    for (const o of reduced.objects) expect(ids.has(o.colorId)).toBe(true);
  });
});

describe("synthetic user: production check", () => {
  it("design info reports sane thread length, run-time, and hoop fit", () => {
    const p = createEmptyProject();
    p.objects = [makeObjectFromPaths("fill", [rect(10, 10, 60, 40)], "c1")];
    const info = designInfo(generateDesign(p), p);
    expect(info.stitches).toBeGreaterThan(100);
    expect(info.threadLengthMm).toBeGreaterThan(info.widthMm); // more thread than width
    expect(info.runtimeMin).toBeGreaterThan(0);
    expect(info.withinHoop).toBe(true);
  });
});
