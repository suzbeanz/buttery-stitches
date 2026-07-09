import { describe, it, expect } from "vitest";
import {
  densifyRing,
  nodesFromPath,
  toggleNodeSmooth,
  insertNode,
  deleteNode,
  moveNode,
  impliedHandles,
  setNodeHandle,
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

describe("Bézier tangent handles", () => {
  // Three collinear points: with automatic tangents the middle stays on the
  // line; an explicit handle bends the curve off it.
  const line: NodePath = [
    { x: 0, y: 0 },
    { x: 10, y: 0, smooth: true },
    { x: 20, y: 0 },
  ];

  it("an explicit handle overrides the automatic tangent and bends the curve", () => {
    const auto = densifyRing(line, false);
    expect(Math.max(...auto.map((p) => Math.abs(p.y)))).toBeLessThan(0.05);
    // Pull the middle node's tangent upward.
    const bent = setNodeHandle(line, 1, "out", { x: 3, y: -4 }, true, false);
    const path = densifyRing(bent, false);
    expect(Math.max(...path.map((p) => Math.abs(p.y)))).toBeGreaterThan(1);
  });

  it("impliedHandles matches what densifyRing draws (grabbing an ear never jumps)", () => {
    const hs = impliedHandles(line, 1, false);
    // Cardinal tangent at the middle node = (next-prev)/2 = (10,0); handles = ±(10,0)/3.
    expect(hs.hOut.x).toBeCloseTo(10 / 3);
    expect(hs.hOut.y).toBeCloseTo(0);
    expect(hs.hIn.x).toBeCloseTo(-10 / 3);
    // Setting the implied handles explicitly must not change the densified shape.
    const explicit = line.map((nd, i) =>
      i === 1 ? { ...nd, hIn: hs.hIn, hOut: hs.hOut } : nd,
    );
    const a = densifyRing(line, false);
    const b = densifyRing(explicit, false);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].x).toBeCloseTo(a[i].x, 6);
      expect(b[i].y).toBeCloseTo(a[i].y, 6);
    }
  });

  it("mirror keeps the opposite handle collinear but preserves its length", () => {
    const withIn = setNodeHandle(line, 1, "in", { x: -2, y: 0 }, false, false);
    const out = setNodeHandle(withIn, 1, "out", { x: 0, y: 5 }, true, false);
    const nd = out[1];
    expect(nd.hOut).toEqual({ x: 0, y: 5 });
    // hIn re-aligned opposite (0,-1 direction) but kept its own length 2.
    expect(nd.hIn!.x).toBeCloseTo(0);
    expect(nd.hIn!.y).toBeCloseTo(-2);
  });

  it("Alt (mirror off) moves only one side — a cusp", () => {
    const withBoth = setNodeHandle(line, 1, "out", { x: 3, y: 3 }, true, false);
    const cusp = setNodeHandle(withBoth, 1, "in", { x: -1, y: 4 }, false, false);
    expect(cusp[1].hIn).toEqual({ x: -1, y: 4 });
    expect(cusp[1].hOut).toEqual({ x: 3, y: 3 }); // untouched
  });

  it("turning a node into a corner clears its handles", () => {
    const withHandles = setNodeHandle(line, 1, "out", { x: 3, y: -4 }, true, false);
    const corner = toggleNodeSmooth(withHandles, 1);
    expect(corner[1].smooth).toBe(false);
    expect(corner[1].hIn).toBeUndefined();
    expect(corner[1].hOut).toBeUndefined();
  });

  it("setting a handle marks the node smooth", () => {
    const sharp: NodePath = nodesFromPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    const out = setNodeHandle(sharp, 1, "out", { x: 2, y: 2 }, true, false);
    expect(out[1].smooth).toBe(true);
  });
});
