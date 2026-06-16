import { describe, it, expect } from "vitest";
import { satinColumn, autoSatinDensity, shortStitchPairs } from "./satin";
import { railsFromCenterline } from "../geometry";
import type { Path, Point } from "../../types/project";

/** Phase B — satin finesse: width-scaled auto-spacing + push compensation. */

const xs = (pts: Point[]) => pts.map((p) => p.x);

describe("autoSatinDensity (width-scaled auto-spacing)", () => {
  it("keeps the drawn density for narrow/mid columns (≤4mm)", () => {
    expect(autoSatinDensity(0.4, 1.5)).toBe(0.4);
    expect(autoSatinDensity(0.4, 4)).toBe(0.4);
  });

  it("tightens the gap for wide columns, clamped to a safe floor", () => {
    const wide = autoSatinDensity(0.4, 10);
    expect(wide).toBeLessThan(0.4); // denser
    expect(wide).toBeGreaterThanOrEqual(0.36); // but not below the floor
  });

  it("never loosens a density the user already set tight", () => {
    expect(autoSatinDensity(0.3, 10)).toBeLessThanOrEqual(0.3);
  });
});

describe("satin push compensation", () => {
  const left: Path = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
  const right: Path = [{ x: 0, y: 4 }, { x: 20, y: 4 }];

  it("pulls the ends of an OPEN column inward by ~push", () => {
    const none = satinColumn(left, right, { density: 0.4, pullComp: 0, push: 0 });
    const pushed = satinColumn(left, right, { density: 0.4, pullComp: 0, push: 0.5 });
    // The column should no longer reach x=0 / x=20 at the ends.
    expect(Math.min(...xs(pushed))).toBeGreaterThan(Math.min(...xs(none)) + 0.3);
    expect(Math.max(...xs(pushed))).toBeLessThan(Math.max(...xs(none)) - 0.3);
  });

  it("leaves a CLOSED ring's coverage alone (no ends to trim)", () => {
    const center = Array.from({ length: 48 }, (_, i) => {
      const a = (2 * Math.PI * i) / 48;
      return { x: 10 + 5 * Math.cos(a), y: 10 + 5 * Math.sin(a) };
    });
    const [l, r] = railsFromCenterline(center, 3, true);
    const ring = satinColumn(l, r, { density: 0.4, pullComp: 0, push: 0.5 });
    const ringNoPush = satinColumn(l, r, { density: 0.4, pullComp: 0, push: 0 });
    // A loop is detected and push is skipped → identical stitch count.
    expect(ring.length).toBe(ringNoPush.length);
  });

  it("is deterministic", () => {
    const a = satinColumn(left, right, { density: 0.4, pullComp: 0.2, push: 0.2 });
    const b = satinColumn(left, right, { density: 0.4, pullComp: 0.2, push: 0.2 });
    expect(a).toEqual(b);
  });
});

describe("shortStitchPairs (inner-curve short stitches)", () => {
  it("leaves a straight column (equal rail gaps) untouched", () => {
    const ls = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }];
    const rs = [{ x: 4, y: 0 }, { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }];
    const out = shortStitchPairs(ls, rs);
    out.forEach(([l, r], k) => {
      expect(l).toEqual(ls[k]);
      expect(r).toEqual(rs[k]);
    });
  });

  it("pulls alternate inner endpoints toward center on a curve", () => {
    // Left rail barely advances (inner/concave), right rail advances fast (outer).
    const ls = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.3, y: 0 }];
    const rs = [{ x: 4, y: 0 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 4, y: 6 }];
    const out = shortStitchPairs(ls, rs);
    // k=1 is the shortened inner stitch: its left endpoint moved toward the right.
    expect(out[1][0].x).toBeGreaterThan(ls[1].x + 0.5);
    // Endpoints (k=0, last) are never shortened.
    expect(out[0][0]).toEqual(ls[0]);
    expect(out[3][0]).toEqual(ls[3]);
  });

  it("is deterministic", () => {
    const ls = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }];
    const rs = [{ x: 4, y: 0 }, { x: 4, y: 2 }, { x: 4, y: 4 }];
    expect(shortStitchPairs(ls, rs)).toEqual(shortStitchPairs(ls, rs));
  });
});
