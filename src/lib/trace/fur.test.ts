import { describe, it, expect } from "vitest";
import { furObjects, detectFurArt } from "./fur";
import { furArt, furArtAA, FUR_EYE, FUR_TONGUE } from "./fur.fixture";
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

  it("keeps the eye and tongue on ANTIALIASED art at the wizard's fur floor", () => {
    // The measured wizard failure: on a browser-rendered (antialiased) upload
    // the sub-0.4% eye and tongue quantize fine, then region consolidation
    // dissolves them into the near-enough fur — the detail-rescue pass in
    // quantizeImage hands them back. Gate the whole furObjects result at the
    // dialog's fur color floor of 5. (Sparkle is NOT asserted: at n=5 a thin
    // near-white bar legitimately loses to the shade ladder.)
    const res = furObjects(furArtAA(), 5, OPTS);
    const near = (rgb: readonly number[], target: readonly number[]) =>
      Math.max(...rgb.map((v, k) => Math.abs(v - target[k]))) <= 24;
    const eyeColor = res.colors.find((c) => near(c.rgb, FUR_EYE));
    const tongueColor = res.colors.find((c) => near(c.rgb, FUR_TONGUE));
    expect(eyeColor, "an eye-black thread survives").toBeTruthy();
    expect(tongueColor, "a tongue-pink thread survives").toBeTruthy();
    const furAA = res.objects.filter((o) => o.params.fillStyle === "fur");
    expect(furAA.length).toBeGreaterThanOrEqual(2);
    // Both details sew AFTER every fur mass, as plain stacked fills (an eye is
    // never a sparkle highlight stroke, however small it traces).
    const lastFurIdx = Math.max(...furAA.map((o) => res.objects.indexOf(o)));
    for (const cid of [eyeColor!.id, tongueColor!.id]) {
      const objs = res.objects.filter((o) => o.colorId === cid);
      expect(objs.length).toBeGreaterThan(0);
      for (const o of objs) {
        expect(res.objects.indexOf(o)).toBeGreaterThan(lastFurIdx);
        expect(o.params.lineArt ?? false).toBe(false);
      }
    }
  });

  it("bakes a DEEPER overlap when asked, a shallower one when asked (the knob)", () => {
    // The wizard's shade-overlap presets flow through DigitizeOptions: measure
    // shared coverage between consecutive fur shades on a coarse grid — deeper
    // tuck ⇒ strictly more shared area, subtler ⇒ strictly less.
    const shared = (objs: EmbObject[]): number => {
      const furs = objs.filter((o) => o.params.fillStyle === "fur");
      let n = 0;
      for (let k = 0; k + 1 < furs.length; k++)
        for (let y = 0; y < 100; y += 0.8)
          for (let x = 0; x < 100; x += 0.8)
            if (inside({ x, y }, furs[k].paths) && inside({ x, y }, furs[k + 1].paths)) n++;
      return n;
    };
    const deep = shared(furObjects(furArt(), 6, { ...OPTS, furOverlapMm: 1.5 }).objects);
    const std = shared(furObjects(furArt(), 6, OPTS).objects);
    const subtle = shared(furObjects(furArt(), 6, { ...OPTS, furOverlapMm: 0.4 }).objects);
    expect(deep, `deep ${deep} vs standard ${std}`).toBeGreaterThan(std * 1.2);
    expect(subtle, `subtle ${subtle} vs standard ${std}`).toBeLessThan(std * 0.8);
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

describe("detectFurArt (auto-preselect)", () => {
  /** Flat opaque test image from a per-pixel painter. */
  function paint(
    w: number,
    h: number,
    f: (x: number, y: number) => [number, number, number],
  ): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const [r, g, b] = f(x, y);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
  }

  it("detects the fur fixture (a same-hue shade ladder as large masses)", () => {
    const d = detectFurArt(furArt());
    expect(d.isFurArt).toBe(true);
    expect(d.stats.furMassCount).toBeGreaterThanOrEqual(2);
    expect(d.stats.ladderDeltaL).toBeGreaterThan(12);
  });

  it("detects the ANTIALIASED fixture too (real uploads are resampled)", () => {
    expect(detectFurArt(furArtAA()).isFurArt).toBe(true);
  });

  it("rejects a flat one-color logo (no shade ladder)", () => {
    const d = detectFurArt(
      paint(200, 200, (x, y) =>
        Math.hypot(x - 100, y - 100) < 15 ? [40, 40, 40] : [200, 60, 60],
      ),
    );
    expect(d.isFurArt).toBe(false);
  });

  it("rejects a red/blue two-block logo — big masses, but not one hue family", () => {
    // Both halves pass the area/span mass gates; the hue gate must refuse
    // (red 36.3° vs blue 300.7° in Lab — 95.6° apart, far past the 20° bar).
    const d = detectFurArt(paint(200, 200, (x) => (x < 100 ? [220, 30, 30] : [30, 60, 220])));
    expect(d.isFurArt).toBe(false);
    expect(d.stats.furMassCount).toBeLessThan(2);
  });

  it("accepts a NEUTRAL grey ladder (hue is noise at zero chroma)", () => {
    const d = detectFurArt(
      paint(200, 200, (x, y) => {
        const stripe = Math.floor((y + 20 * Math.sin(x / 25)) / 60);
        const s = ((stripe % 3) + 3) % 3;
        return s === 0 ? [40, 40, 42] : s === 1 ? [120, 120, 122] : [200, 200, 202];
      }),
    );
    expect(d.isFurArt).toBe(true);
  });
});
