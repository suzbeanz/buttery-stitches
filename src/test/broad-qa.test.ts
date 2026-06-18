import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Font } from "opentype.js";
import type { EmbObject, Path } from "../types/project";
import { parseFont } from "../lib/text/fonts";
import { layoutText } from "../lib/text/layout";
import { makeObjectFromPaths } from "../lib/objects";
import { shapeRings } from "../lib/shapes";
import { fixObjectStitches } from "../lib/fix";
import { generateDesign, type EngineStitch } from "../lib/engine";
import { createEmptyProject } from "../lib/project";

/**
 * Broad QA: run a representative spread of the WHOLE pipeline (lettering in every
 * baseline mode, every auto-treated shape, rings, multi-blend) and assert the
 * invariants that make a design sewable and trustworthy — finite coordinates, no
 * stitch longer than the machine ceiling, deterministic output, and fills that
 * actually cover their region. A guard so future engine work can't regress them.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fontFile: Record<string, string> = {
  oswald: "Oswald-Medium.ttf",
  pacifico: "Pacifico-Regular.ttf",
  playfair: "PlayfairDisplay-Bold.ttf",
};
const fonts: Record<string, Font> = {};
beforeAll(() => {
  for (const [id, file] of Object.entries(fontFile)) {
    const buf = readFileSync(join(here, "..", "lib", "text", "fonts", file));
    fonts[id] = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  }
});

const MAX_STITCH_MM = 9.2;

function longestSewn(design: EngineStitch[]): number {
  let m = 0;
  for (let i = 1; i < design.length; i++) {
    const a = design[i - 1];
    const b = design[i];
    if (!b.jump && !b.trim && a.colorId === b.colorId) m = Math.max(m, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return m;
}
function allFinite(design: EngineStitch[]): boolean {
  return design.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
}
function pointInRings(p: { x: number; y: number }, rings: Path[]): boolean {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function coverage(rings: Path[], design: EngineStitch[], cell = 0.5): number {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const r of rings) for (const p of r) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  const W = Math.ceil((maxx - minx) / cell) + 1, H = Math.ceil((maxy - miny) / cell) + 1;
  const inside = new Uint8Array(W * H);
  let tot = 0;
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
    if (pointInRings({ x: minx + gx * cell, y: miny + gy * cell }, rings)) { inside[gy * W + gx] = 1; tot++; }
  }
  if (!tot) return 1;
  const cov = new Uint8Array(W * H);
  const mark = (x: number, y: number) => {
    const gx = Math.round((x - minx) / cell), gy = Math.round((y - miny) / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx, cy = gy + dy;
      if (cx >= 0 && cy >= 0 && cx < W && cy < H) cov[cy * W + cx] = 1;
    }
  };
  let prev: EngineStitch | null = null;
  for (const s of design) {
    if (prev && !s.jump && !s.trim) {
      const steps = Math.max(1, Math.ceil(Math.hypot(s.x - prev.x, s.y - prev.y) / (cell * 0.7)));
      for (let k = 0; k <= steps; k++) mark(prev.x + (s.x - prev.x) * k / steps, prev.y + (s.y - prev.y) * k / steps);
    }
    prev = s;
  }
  let hit = 0;
  for (let i = 0; i < inside.length; i++) if (inside[i] && cov[i]) hit++;
  return hit / tot;
}
function assertSewable(name: string, objs: EmbObject[], colors?: { id: string; rgb: [number, number, number] }[]) {
  const proj = createEmptyProject();
  if (colors) proj.colors = colors;
  proj.objects = objs;
  const design = generateDesign(proj, { lockStitches: true });
  expect(design.length, `${name}: empty`).toBeGreaterThan(0);
  expect(allFinite(design), `${name}: non-finite`).toBe(true);
  expect(longestSewn(design), `${name}: long stitch`).toBeLessThanOrEqual(MAX_STITCH_MM);
  // deterministic
  expect(generateDesign(proj, { lockStitches: true }).length, `${name}: nondeterministic`).toBe(design.length);
  return design;
}

describe("broad QA — sewability across the pipeline", () => {
  it("lettering: every font × size × baseline mode is sewable", () => {
    for (const id of Object.keys(fontFile)) {
      for (const heightMm of [7, 18]) {
        for (const mode of [{}, { archDeg: 120 }, { circleRadiusMm: 30, circleSide: "top" as const }, { circleRadiusMm: 30, circleSide: "bottom" as const }]) {
          const { object } = layoutText({ text: "Wax 5", font: fonts[id], heightMm, colorId: "c1", fontId: id, ...mode });
          assertSewable(`${id} h${heightMm} ${JSON.stringify(mode)}`, [object]);
        }
      }
    }
  });

  it("auto-treated shapes are sewable and cover their region", () => {
    for (const kind of ["rectangle", "ellipse", "star", "triangle", "heart"] as const) {
      for (const sz of [12, 45]) {
        const rings = shapeRings(kind, { width: sz, height: sz * 0.8, points: 5, outerR: sz / 2, innerR: sz / 4 });
        const obj = fixObjectStitches(makeObjectFromPaths("fill", rings, "c1"));
        const design = assertSewable(`${kind} ${sz}`, [obj]);
        expect(coverage(obj.paths, design), `${kind} ${sz} coverage`).toBeGreaterThan(0.8);
      }
    }
  });

  it("multi-blend and rings are sewable", () => {
    const mb = makeObjectFromPaths("fill", [[{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }]], "c1");
    mb.params = { ...mb.params, fillStyle: "blend", blendColorId: "c2" };
    assertSewable("multi-blend", [mb], [{ id: "c1", rgb: [200, 0, 0] }, { id: "c2", rgb: [0, 0, 200] }]);

    const circle = (r: number, n = 64) => Array.from({ length: n }, (_, i) => ({ x: 30 + r * Math.cos((i / n) * 2 * Math.PI), y: 30 + r * Math.sin((i / n) * 2 * Math.PI) }));
    assertSewable("broad ring", [fixObjectStitches(makeObjectFromPaths("fill", [circle(20), circle(8)], "c1"))]);
  });
});
