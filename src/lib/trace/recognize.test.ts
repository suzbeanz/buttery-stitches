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
