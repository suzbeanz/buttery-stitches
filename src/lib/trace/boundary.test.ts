import { describe, it, expect } from "vitest";
import { traceLabelMap } from "./boundary";
import type { QuantizedImage, RasterImage } from "./quantize";

/**
 * The crack tracer's contract: exact loops around every component, holes wired
 * via holechildren, SHARED boundaries between touching colors (identical
 * polylines), and subpixel edge recovery from anti-aliased sources.
 */

type RGB = [number, number, number];

/** Build a QuantizedImage from a label grid (rows of palette indices, -1 = transparent). */
function fromGrid(grid: number[][], palette: RGB[]): QuantizedImage {
  const height = grid.length;
  const width = grid[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  const labels = new Int16Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const li = grid[y][x];
      labels[y * width + x] = li;
      const o = (y * width + x) * 4;
      if (li >= 0) {
        const [r, g, b] = palette[li];
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }
  return { width, height, data, palette, labels };
}

/** Ring vertices of a path (its segment start points). */
function ringOf(path: { segments: { x1: number; y1: number }[] }): [number, number][] {
  return path.segments.map((s) => [s.x1, s.y1]);
}

/** Canonical form of a closed ring: rotated to lexicographically-smallest
 *  start, both directions tried — lets two rings be compared as SETS of the
 *  same boundary regardless of start vertex / orientation. */
function canonical(ring: [number, number][]): string {
  const variants: string[] = [];
  for (const r of [ring, [...ring].reverse()]) {
    let best = 0;
    for (let i = 1; i < r.length; i++) {
      if (r[i][0] < r[best][0] || (r[i][0] === r[best][0] && r[i][1] < r[best][1])) best = i;
    }
    variants.push(JSON.stringify([...r.slice(best), ...r.slice(0, best)]));
  }
  return variants.sort()[0];
}

const RED: RGB = [200, 40, 40];
const BLUE: RGB = [40, 60, 200];

describe("traceLabelMap", () => {
  it("traces a solid rectangle to its exact outline", () => {
    // 3×2 red block inside a 6×5 transparent canvas at (1,1).
    const grid = [
      [-1, -1, -1, -1, -1, -1],
      [-1, 0, 0, 0, -1, -1],
      [-1, 0, 0, 0, -1, -1],
      [-1, -1, -1, -1, -1, -1],
      [-1, -1, -1, -1, -1, -1],
    ];
    const td = traceLabelMap(fromGrid(grid, [RED]), null, { pathomitPx: 0 });
    expect(td.layers).toHaveLength(1);
    expect(td.layers[0]).toHaveLength(1);
    const ring = ringOf(td.layers[0][0]);
    expect(canonical(ring)).toBe(
      canonical([
        [1, 1],
        [4, 1],
        [4, 3],
        [1, 3],
      ]),
    );
    expect(td.layers[0][0].isholepath).toBe(false);
  });

  it("wires a hole through holechildren", () => {
    // 5×5 red donut with a 1×1 hole in the middle.
    const grid = [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, -1, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    const td = traceLabelMap(fromGrid(grid, [RED]), null, { pathomitPx: 0 });
    const layer = td.layers[0];
    expect(layer).toHaveLength(2);
    const outer = layer.find((p) => !p.isholepath)!;
    const hole = layer.find((p) => p.isholepath)!;
    expect(outer.holechildren).toEqual([layer.indexOf(hole)]);
    expect(canonical(ringOf(hole))).toBe(
      canonical([
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
      ]),
    );
  });

  it("gives two touching colors the IDENTICAL shared boundary", () => {
    // Red left half, blue right half — the vertical seam must be the same
    // polyline in both rings (the gap-free guarantee).
    const grid = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
    ];
    const td = traceLabelMap(fromGrid(grid, [RED, BLUE]), null, { pathomitPx: 0 });
    const red = ringOf(td.layers[0][0]);
    const blue = ringOf(td.layers[1][0]);
    const redSeam = red.filter(([x]) => x === 2);
    const blueSeam = blue.filter(([x]) => x === 2);
    expect(redSeam.length).toBeGreaterThan(0);
    expect(new Set(redSeam.map(String))).toEqual(new Set(blueSeam.map(String)));
  });

  it("separates diagonally-touching same-label pixels into two components", () => {
    const grid = [
      [0, -1],
      [-1, 0],
    ];
    const td = traceLabelMap(fromGrid(grid, [RED]), null, { pathomitPx: 0 });
    expect(td.layers[0]).toHaveLength(2);
    expect(td.layers[0].every((p) => !p.isholepath)).toBe(true);
  });

  it("despeckles loops below pathomit", () => {
    const grid = [
      [0, -1, -1, -1, -1, -1],
      [-1, -1, -1, -1, -1, -1],
      [-1, -1, 1, 1, 1, 1],
      [-1, -1, 1, 1, 1, 1],
      [-1, -1, 1, 1, 1, 1],
    ];
    // The lone red pixel has a 4-step loop; pathomit 6 drops it, keeps the blue.
    const td = traceLabelMap(fromGrid(grid, [RED, BLUE]), null, { pathomitPx: 6 });
    expect(td.layers[0]).toHaveLength(0);
    expect(td.layers[1]).toHaveLength(1);
  });

  it("recovers a subpixel edge from an anti-aliased source", () => {
    // A vertical edge whose TRUE position is x = 4.3: pixel column 4 shows the
    // partial coverage (70% red), so the quantizer put the boundary at x=4 or 5
    // but the anti-aliasing knows better.
    const W = 10;
    const H = 6;
    const EDGE = 4.3;
    const palette: RGB[] = [RED, [255, 255, 255]];
    const grid: number[][] = [];
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const row: number[] = [];
      for (let x = 0; x < W; x++) {
        // Coverage of RED inside pixel [x, x+1): full left of the edge.
        const cov = Math.min(1, Math.max(0, EDGE - x));
        const o = (y * W + x) * 4;
        data[o] = 200 * cov + 255 * (1 - cov);
        data[o + 1] = 40 * cov + 255 * (1 - cov);
        data[o + 2] = 40 * cov + 255 * (1 - cov);
        data[o + 3] = 255;
        row.push(cov >= 0.5 ? 0 : 1);
      }
      grid.push(row);
    }
    const source: RasterImage = { width: W, height: H, data };
    const td = traceLabelMap(fromGrid(grid, palette), source, { pathomitPx: 0 });
    const red = ringOf(td.layers[0][0]);
    // Interior seam vertices (excluding the canvas-border corners) must sit at
    // the TRUE edge within a fraction of a pixel — not on the lattice at x=5.
    const seamXs = red.map(([x]) => x).filter((x) => x > 3 && x < 7);
    expect(seamXs.length).toBeGreaterThan(0);
    for (const x of seamXs) {
      expect(Math.abs(x - EDGE)).toBeLessThan(0.35);
    }
  });

  it("is deterministic", () => {
    const grid = [
      [0, 0, 1, 1],
      [0, -1, 1, 1],
      [0, 0, 0, 1],
    ];
    const flat = fromGrid(grid, [RED, BLUE]);
    expect(JSON.stringify(traceLabelMap(flat, null))).toBe(
      JSON.stringify(traceLabelMap(flat, null)),
    );
  });
});
