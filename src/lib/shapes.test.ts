import { describe, it, expect } from "vitest";
import {
  rectangle,
  roundedRect,
  ellipse,
  triangle,
  star,
  heart,
  line,
  shapeRings,
  makeShapeObject,
  type ShapeKind,
} from "./shapes";
import { pathsBounds, polylineLength } from "./geometry";
import type { Path } from "../types/project";

/** Signed area of a closed ring via the shoelace formula (abs = area). */
function ringArea(ring: Path): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i].x * ring[i + 1].y - ring[i + 1].x * ring[i].y;
  }
  return Math.abs(sum) / 2;
}

function isClosed(ring: Path): boolean {
  const f = ring[0];
  const l = ring[ring.length - 1];
  return f.x === l.x && f.y === l.y;
}

describe("rectangle", () => {
  it("is a closed ring with the requested size centered on origin", () => {
    const [ring] = rectangle(40, 20);
    expect(ring.length).toBeGreaterThan(0);
    expect(isClosed(ring)).toBe(true);
    const b = pathsBounds([ring])!;
    expect(b.maxX - b.minX).toBeCloseTo(40);
    expect(b.maxY - b.minY).toBeCloseTo(20);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0);
  });

  it("has area w*h", () => {
    const [ring] = rectangle(40, 20);
    expect(ringArea(ring)).toBeCloseTo(800);
  });
});

describe("roundedRect", () => {
  it("matches the bounding box and is closed", () => {
    const [ring] = roundedRect(40, 20, 5);
    expect(ring.length).toBeGreaterThan(0);
    expect(isClosed(ring)).toBe(true);
    const b = pathsBounds([ring])!;
    expect(b.maxX - b.minX).toBeCloseTo(40);
    expect(b.maxY - b.minY).toBeCloseTo(20);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0);
  });

  it("area is between the inscribed and full rectangle (corners trimmed)", () => {
    const [ring] = roundedRect(40, 20, 5);
    const area = ringArea(ring);
    expect(area).toBeLessThan(800);
    // Corner removal is 4*(r^2 - pi*r^2/4) = r^2*(4-pi) ~= 21.5 mm^2; the
    // polygonal arc approximation trims a touch more, so allow a small margin.
    expect(area).toBeCloseTo(800 - 25 * (4 - Math.PI), -1);
  });

  it("falls back to a plain rectangle when radius is 0", () => {
    const [ring] = roundedRect(10, 10, 0);
    expect(ringArea(ring)).toBeCloseTo(100);
  });

  it("clamps radius to half the shorter side", () => {
    const [ring] = roundedRect(20, 20, 999);
    const b = pathsBounds([ring])!;
    expect(b.maxX - b.minX).toBeCloseTo(20);
    expect(b.maxY - b.minY).toBeCloseTo(20);
    // With r = 10 on a 20x20 box this is a circle of area ~pi*100.
    expect(ringArea(ring)).toBeCloseTo(Math.PI * 100, -1);
  });
});

describe("ellipse", () => {
  it("approximates area ~ pi*a*b and matches the bounding box", () => {
    const [ring] = ellipse(40, 20, 256);
    expect(ring.length).toBeGreaterThan(0);
    expect(isClosed(ring)).toBe(true);
    const b = pathsBounds([ring])!;
    expect(b.maxX - b.minX).toBeCloseTo(40);
    expect(b.maxY - b.minY).toBeCloseTo(20);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0);
    expect(ringArea(ring)).toBeCloseTo(Math.PI * 20 * 10, 0);
  });

  it("is a circle when w === h", () => {
    const [ring] = ellipse(30, 30, 256);
    expect(ringArea(ring)).toBeCloseTo(Math.PI * 15 * 15, 0);
  });

  it("honors the requested segment count", () => {
    const [ring] = ellipse(20, 20, 12);
    // 12 unique points + repeated closing point.
    expect(ring.length).toBe(13);
  });
});

describe("triangle", () => {
  it("matches the bounding box, is closed, and has area w*h/2", () => {
    const [ring] = triangle(40, 20);
    expect(isClosed(ring)).toBe(true);
    const b = pathsBounds([ring])!;
    expect(b.maxX - b.minX).toBeCloseTo(40);
    expect(b.maxY - b.minY).toBeCloseTo(20);
    expect(ringArea(ring)).toBeCloseTo((40 * 20) / 2);
  });
});

describe("star", () => {
  it("has exactly 2*points vertices plus the closing point", () => {
    const [ring] = star(5, 20, 8);
    expect(ring.length).toBe(2 * 5 + 1);
    expect(isClosed(ring)).toBe(true);
  });

  it("fits within the outer radius", () => {
    const [ring] = star(6, 20, 10);
    expect(ring.length).toBe(2 * 6 + 1);
    const b = pathsBounds([ring])!;
    expect(Math.max(b.maxX, -b.minX, b.maxY, -b.minY)).toBeCloseTo(20);
  });
});

describe("heart", () => {
  it("matches the bounding box, is closed, and is centered", () => {
    const [ring] = heart(40, 36);
    expect(ring.length).toBeGreaterThan(0);
    expect(isClosed(ring)).toBe(true);
    const b = pathsBounds([ring])!;
    expect(b.maxX - b.minX).toBeCloseTo(40);
    expect(b.maxY - b.minY).toBeCloseTo(36);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0);
  });
});

describe("line", () => {
  it("is an open two-point polyline of the requested length, centered", () => {
    const [path] = line(50);
    expect(path.length).toBe(2);
    expect(isClosed(path)).toBe(false);
    expect(polylineLength(path)).toBeCloseTo(50);
    const b = pathsBounds([path])!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0);
  });
});

describe("determinism", () => {
  const kinds: ShapeKind[] = [
    "rectangle",
    "roundedRect",
    "ellipse",
    "triangle",
    "star",
    "heart",
    "line",
  ];
  it("produces identical output for identical input", () => {
    for (const kind of kinds) {
      const a = shapeRings(kind, { width: 30, height: 24 });
      const b = shapeRings(kind, { width: 30, height: 24 });
      expect(a).toEqual(b);
    }
  });
});

describe("makeShapeObject", () => {
  it("makes a fill object for closed shapes, centered on the requested point", () => {
    const obj = makeShapeObject(
      "rectangle",
      { center: { x: 100, y: 50 }, width: 20, height: 10 },
      "c1",
    );
    expect(obj.type).toBe("fill");
    expect(obj.colorId).toBe("c1");
    const b = pathsBounds(obj.paths)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(100);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(50);
    expect(b.maxX - b.minX).toBeCloseTo(20);
    expect(b.maxY - b.minY).toBeCloseTo(10);
  });

  it("makes a running object for a line", () => {
    const obj = makeShapeObject(
      "line",
      { center: { x: 0, y: 0 }, length: 40 },
      "c2",
    );
    expect(obj.type).toBe("running");
    expect(obj.paths[0].length).toBe(2);
    expect(polylineLength(obj.paths[0])).toBeCloseTo(40);
  });

  it("defaults the center to the origin", () => {
    const obj = makeShapeObject("ellipse", { width: 20, height: 20 }, "c3");
    const b = pathsBounds(obj.paths)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0);
  });
});
