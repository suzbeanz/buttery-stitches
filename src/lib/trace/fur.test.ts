import { describe, it, expect } from "vitest";
import { furObjects } from "./fur";
import { furArt } from "./fur.fixture";
import { polygonArea, polygonPerimeter } from "./classify";
import { rgbToLab } from "../thread/match";
import { douglasPeucker } from "./simplify";
import type { EmbObject, Point } from "../../types/project";

const OPTS = { mmPerPx: 0.2, offsetX: 2, offsetY: 2, removeBackground: true } as const;

/** Even-odd point-in-rings. */
function inside(p: Point, rings: Point[][]): boolean {
  let odd = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
    }
  return odd;
}

describe("furObjects", () => {
  const res = furObjects(furArt(), 6, OPTS);
  const L = (o: EmbObject) => rgbToLab(res.colors.find((c) => c.id === o.colorId)!.rgb)[0];
  const fur = res.objects.filter((o) => o.params.fillStyle === "fur");
  const details = res.objects.filter((o) => o.params.fillStyle !== "fur");

  it("finds the three fur shades and orders them dark → light, details after", () => {
    expect(fur.length).toBe(3);
    for (let i = 1; i < fur.length; i++) expect(L(fur[i])).toBeGreaterThan(L(fur[i - 1]));
    // Every fur object precedes every detail object.
    const lastFurIdx = res.objects.indexOf(fur[fur.length - 1]);
    for (const d of details) expect(res.objects.indexOf(d)).toBeGreaterThan(lastFurIdx);
  });

  it("maps the sparkle color to line-art strokes, sewn last", () => {
    const last = res.objects[res.objects.length - 1];
    expect(last.params.lineArt).toBe(true);
    expect(L(last)).toBeGreaterThan(90); // the near-white highlight
  });

  it("upper fur shades skip underlay; the base coat keeps it", () => {
    expect(fur[0].params.underlay).not.toBe(false);
    for (const o of fur.slice(1)) expect(o.params.underlay).toBe(false);
  });

  it("bakes a real overlap: each shade tucks under the next (≥0.6mm reach)", () => {
    for (let k = 0; k + 1 < fur.length; k++) {
      // Sample the later shade's boundary; a healthy fraction of points just
      // INSIDE it must also lie inside the earlier shade (the baked tuck).
      let probes = 0;
      let tucked = 0;
      for (const ring of fur[k + 1].paths) {
        for (let i = 0; i < ring.length; i += 6) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          // 0.6mm inward normal probe (try both normals; count either).
          const nx = (-(b.y - a.y) / len) * 0.6;
          const ny = ((b.x - a.x) / len) * 0.6;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const p1 = { x: mid.x + nx, y: mid.y + ny };
          const p2 = { x: mid.x - nx, y: mid.y - ny };
          const inner = inside(p1, fur[k + 1].paths) ? p1 : inside(p2, fur[k + 1].paths) ? p2 : null;
          if (!inner) continue;
          probes++;
          if (inside(inner, fur[k].paths)) tucked++;
        }
      }
      expect(probes).toBeGreaterThan(20);
      // Only the boundary stretches ABUTTING the earlier shade tuck (stripes
      // alternate, and outer silhouette edges touch nothing) — but a real
      // share must.
      expect(tucked / probes, `tuck share ${fur[k].name} under ${fur[k + 1].name}`).toBeGreaterThan(0.2);
    }
  });

  it("keeps the sawtooth fur teeth (spiky perimeter survives the pipeline)", () => {
    // Roughness = true perimeter vs the perimeter of a 1mm-straightened copy;
    // sawtooth teeth make it longer, while an ellipse-snapped or straightened
    // ring is ~1.0. The fixture measures 1.09–1.2 across the shades (the
    // lightest carries the least boundary), so 1.05 splits both worlds.
    for (const o of fur) {
      const biggest = [...o.paths].sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0];
      const rough = polygonPerimeter(biggest) / Math.max(1, polygonPerimeter(douglasPeucker(biggest, 1.0)));
      expect(rough, `roughness of ${o.name}`).toBeGreaterThan(1.05);
    }
  });

  it("declines gracefully on non-fur art (returns the standard trace)", () => {
    // One dominant flat color plus a small dot: only ONE color can qualify as
    // a fur mass (the dot fails both the area-share and span thresholds), so
    // the shade-ladder requirement (≥2) declines to the standard trace. Two
    // big interlocking blocks would rightly READ as a two-shade coat.
    const w = 200;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dot = (x - 100) ** 2 + (y - 100) ** 2 < 20 ** 2;
        data[i] = dot ? 40 : 200;
        data[i + 1] = 60;
        data[i + 2] = 60;
        data[i + 3] = 255;
      }
    const img = { width: w, height: w, data } as ImageData;
    const out = furObjects(img, 4, { mmPerPx: 0.2, offsetX: 0, offsetY: 0, removeBackground: false });
    expect(out.objects.length).toBeGreaterThan(0);
    expect(out.objects.every((o) => o.params.fillStyle !== "fur")).toBe(true);
  });
});
