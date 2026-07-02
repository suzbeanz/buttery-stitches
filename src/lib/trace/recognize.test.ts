import { describe, it, expect } from "vitest";
import { recognizeShape } from "./recognize";
import type { Path } from "../../types/project";

/** A closed ring sampled from a parametric shape, with optional radial jitter. */
function sampled(n: number, fn: (t: number) => Path[0], jitter = 0): Path {
  const out: Path = [];
  for (let i = 0; i < n; i++) {
    const p = fn(i / n);
    out.push({ x: p.x + (jitter ? (Math.sin(i * 2.3) * jitter) : 0), y: p.y + (jitter ? (Math.cos(i * 1.7) * jitter) : 0) });
  }
  return out;
}

describe("smart-shape recognition", () => {
  it("recognizes a noisy circle", () => {
    const ring = sampled(40, (t) => ({ x: 30 + 15 * Math.cos(t * 2 * Math.PI), y: 30 + 15 * Math.sin(t * 2 * Math.PI) }), 0.3);
    const r = recognizeShape(ring, 0.8);
    expect(r?.kind).toBe("circle");
  });

  it("snaps a small round dot with a shadow notch to a perfect circle", () => {
    // An ~8 mm dot (a golf ball) with a localized inward notch where its shadow
    // meets the ground — just past the strict circle test, but it should still snap
    // to a true circle rather than stay a faceted polygon.
    const ring: Path = [];
    const n = 56;
    const R = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = i >= 10 && i < 14 ? R - 0.9 : R; // the notch
      ring.push({ x: 20 + r * Math.cos(a), y: 20 + r * Math.sin(a) });
    }
    const rec = recognizeShape(ring, 1.0);
    expect(rec?.kind).toBe("circle");
    expect(rec?.ring.length).toBe(64); // a clean 64-point circle, not a faceted blob
  });

  it("recognizes a rotated rectangle", () => {
    const w = 40;
    const h = 16;
    const rot = 0.4;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const corners: [number, number][] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    // densify edges so the fit has points along them
    const ring: Path = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      for (let k = 0; k < 8; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / 8;
        const y = a[1] + ((b[1] - a[1]) * k) / 8;
        ring.push({ x: x * cs - y * sn, y: x * sn + y * cs });
      }
    }
    const r = recognizeShape(ring, 0.8);
    expect(r?.kind).toBe("rectangle");
    expect(Math.abs(r!.angleDeg - (rot * 180) / Math.PI)).toBeLessThan(6);
  });

  it("keeps a hexagon as a polygon, not a circle", () => {
    const ring = sampled(60, (t) => ({ x: 20 * Math.cos(t * 2 * Math.PI), y: 20 * Math.sin(t * 2 * Math.PI) }));
    // resample to a true hexagon outline
    const verts = Array.from({ length: 6 }, (_, i) => ({ x: 20 * Math.cos((i / 6) * 2 * Math.PI), y: 20 * Math.sin((i / 6) * 2 * Math.PI) }));
    const hex: Path = [];
    for (let i = 0; i < 6; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 6];
      for (let k = 0; k < 6; k++) hex.push({ x: a.x + ((b.x - a.x) * k) / 6, y: a.y + ((b.y - a.y) * k) / 6 });
    }
    void ring;
    const r = recognizeShape(hex, 0.6);
    expect(r?.kind).toBe("polygon");
  });

  it("does NOT snap a chamfered rectangle to an octagon (uneven edges)", () => {
    // A 12×12 square with 1.5 mm corner chamfers → 8 vertices, but the edges alternate
    // long sides (~9 mm) and short cuts (~2 mm). A real cartoon window (rounded/slanted
    // rect) looks like this; it must NOT be mis-snapped to a regular octagon — it should
    // stay a rectangle (or fall through), never "polygon".
    const s = 6, ch = 1.5;
    const v: Path = [
      { x: -s + ch, y: -s }, { x: s - ch, y: -s }, { x: s, y: -s + ch }, { x: s, y: s - ch },
      { x: s - ch, y: s }, { x: -s + ch, y: s }, { x: -s, y: s - ch }, { x: -s, y: -s + ch },
    ];
    const ring: Path = [];
    for (let i = 0; i < 8; i++) { const a = v[i], b = v[(i + 1) % 8]; for (let k = 0; k < 5; k++) ring.push({ x: a.x + ((b.x - a.x) * k) / 5, y: a.y + ((b.y - a.y) * k) / 5 }); }
    expect(recognizeShape(ring, 0.8)?.kind).not.toBe("polygon");
  });

  it("recognizes an ellipse (and not as a circle)", () => {
    const ring = sampled(64, (t) => ({ x: 30 * Math.cos(t * 2 * Math.PI), y: 12 * Math.sin(t * 2 * Math.PI) }));
    const r = recognizeShape(ring, 0.8);
    expect(r?.kind).toBe("ellipse");
  });

  it("returns null for an irregular blob (no primitive fits)", () => {
    const blob: Path = [
      { x: 0, y: 0 }, { x: 30, y: 2 }, { x: 34, y: 18 }, { x: 20, y: 22 },
      { x: 22, y: 40 }, { x: 4, y: 30 }, { x: -6, y: 12 },
    ];
    expect(recognizeShape(blob, 0.6)).toBeNull();
  });
});

describe("narrow / asymmetric shapes (a traced flag pole)", () => {
  /** A 3 mm-wide bar, ~63 mm tall, slightly tapered at the foot (asymmetric — the
   *  centroid sits below the middle) with mildly wobbly traced edges. */
  const bar = (): Path => {
    const ring: Path = [];
    for (let i = 0; i <= 20; i++) ring.push({ x: 3 + Math.sin(i) * 0.15, y: (i / 20) * 63 });
    ring.push({ x: 2.2, y: 63.4 }, { x: 0.8, y: 63.4 }); // tapered foot
    for (let i = 20; i >= 0; i--) ring.push({ x: 0 + Math.sin(i * 1.3) * 0.15, y: (i / 20) * 63 });
    ring.push({ x: 1.5, y: -0.4 }); // slightly domed head
    return ring;
  };

  it("never snaps to a primitive that overshoots the artwork", () => {
    // The old symmetric-about-the-centroid fit turned this bar into a cigar
    // ellipse poking ~5 mm above the artwork (a flag pole sticking through the
    // sky). Whatever the recognizer decides, the result must stay inside the
    // source's bounds (small tolerance for rounding).
    const r = recognizeShape(bar(), 1.0);
    if (r) {
      const ys = r.ring.map((p) => p.y);
      const xs = r.ring.map((p) => p.x);
      expect(Math.min(...ys)).toBeGreaterThan(-1);
      expect(Math.max(...ys)).toBeLessThan(64.4);
      expect(Math.min(...xs)).toBeGreaterThan(-1);
      expect(Math.max(...xs)).toBeLessThan(4.2);
    }
  });

  it("still recognizes an asymmetrically-traced true ellipse, centred correctly", () => {
    // A clean ellipse whose ring SAMPLING is denser on one side (as traces are);
    // midrange-centred fitting must recover the true centre and extents.
    const ring: Path = [];
    for (let i = 0; i < 80; i++) {
      const t = (i / 80) ** 1.35 * 2 * Math.PI; // uneven parametrisation
      ring.push({ x: 20 + 14 * Math.cos(t), y: 10 + 6 * Math.sin(t) });
    }
    const r = recognizeShape(ring, 0.8);
    expect(r?.kind).toBe("ellipse");
    const xs = r!.ring.map((p) => p.x), ys = r!.ring.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(6, 0);
    expect(Math.max(...xs)).toBeCloseTo(34, 0);
    expect(Math.min(...ys)).toBeCloseTo(4, 0);
    expect(Math.max(...ys)).toBeCloseTo(16, 0);
  });
});
