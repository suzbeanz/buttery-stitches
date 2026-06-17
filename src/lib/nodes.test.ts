import { describe, it, expect } from "vitest";
import {
  densifyRing,
  nodesFromPath,
  toggleNodeSmooth,
  insertNode,
  deleteNode,
  moveNode,
  type NodePath,
} from "./nodes";

describe("densifyRing", () => {
  it("all-corner open path is the straight polyline (no extra points)", () => {
    const nodes: NodePath = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(densifyRing(nodes, false)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("a smooth middle node bulges the curve off the straight chord", () => {
    const nodes: NodePath = [
      { x: 0, y: 0 },
      { x: 10, y: 0, smooth: true },
      { x: 20, y: 0 },
    ];
    // Move the middle node up and smooth it → the densified curve should leave
    // the y=0 line near the middle.
    const bent: NodePath = [
      { x: 0, y: 0 },
      { x: 10, y: 5, smooth: true },
      { x: 20, y: 0 },
    ];
    const out = densifyRing(bent, false);
    expect(out.length).toBeGreaterThan(nodes.length); // densified
    const maxY = Math.max(...out.map((p) => p.y));
    expect(maxY).toBeGreaterThan(0.5); // it curves up
    // endpoints preserved
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 20, y: 0 });
  });

  it("a closed ring does not duplicate the seam point", () => {
    const sq: NodePath = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const out = densifyRing(sq, true);
    // all corners → 4 points, first != last (consumer closes the ring)
    expect(out).toHaveLength(4);
    expect(out[0]).not.toEqual(out[out.length - 1]);
  });

  it("is deterministic", () => {
    const nodes: NodePath = [
      { x: 0, y: 0, smooth: true },
      { x: 10, y: 8, smooth: true },
      { x: 20, y: 0, smooth: true },
    ];
    expect(densifyRing(nodes, false)).toEqual(densifyRing(nodes, false));
  });
});

describe("node ops", () => {
  const tri: NodePath = nodesFromPath([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 8 },
  ]);

  it("toggles a node's smoothness immutably", () => {
    const out = toggleNodeSmooth(tri, 1);
    expect(out[1].smooth).toBe(true);
    expect(tri[1].smooth).toBeFalsy(); // original untouched
  });

  it("inserts a node on the nearest span", () => {
    const out = insertNode(tri, { x: 5, y: 0.2 }, false);
    expect(out).toHaveLength(4);
    expect(out[1].x).toBeCloseTo(5); // projected onto the bottom edge
    expect(out[1].y).toBeCloseTo(0);
  });

  it("deletes and moves nodes immutably", () => {
    expect(deleteNode(tri, 0)).toHaveLength(2);
    expect(moveNode(tri, 2, { x: 9, y: 9 })[2]).toEqual({ x: 9, y: 9, smooth: false });
    expect(tri[2]).toEqual({ x: 5, y: 8, smooth: false });
  });
});
