import { describe, it, expect } from "vitest";
import {
  createEmptyProject,
  parseProject,
  serializeProject,
  defaultObjectName,
  syncObjectCounter,
} from "./project";
import type { EmbObject } from "../types/project";

describe("project serialization", () => {
  it("creates an empty project sized to the default hoop", () => {
    const p = createEmptyProject();
    expect(p.version).toBe(1);
    expect(p.objects).toHaveLength(0);
    expect(p.colors.length).toBeGreaterThan(0);
    expect(p.widthMm).toBeGreaterThan(0);
    expect(p.heightMm).toBeGreaterThan(0);
  });

  it("round-trips losslessly through serialize/parse", () => {
    const p = createEmptyProject();
    const restored = parseProject(JSON.parse(serializeProject(p)));
    expect(restored).toEqual(p);
  });

  it("preserves rich object data through a round-trip (nodes, text, appliqué, satin rails)", () => {
    const p = createEmptyProject();
    p.objects = [
      {
        id: "o1",
        name: "Curve",
        type: "fill",
        colorId: "c1",
        paths: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }]],
        nodes: [[{ x: 0, y: 0, smooth: true }, { x: 10, y: 0 }, { x: 5, y: 8, smooth: true }]],
        params: { applique: true, fillStyle: "tatami" },
        visible: true,
      },
      {
        id: "o2",
        name: "Word",
        type: "fill",
        colorId: "c1",
        paths: [[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]],
        params: { fillStyle: "satin" },
        visible: true,
        text: { content: "Hi\nyou", fontId: "f1", heightMm: 10, letterSpacingMm: 0.5, lineSpacing: 1.4, archDeg: 60 },
      },
      {
        id: "o3",
        name: "Column",
        type: "satin",
        colorId: "c1",
        paths: [[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 3 }, { x: 10, y: 3 }]],
        params: {},
        visible: true,
      },
    ];
    const restored = parseProject(JSON.parse(serializeProject(p)));
    expect(restored.objects).toEqual(p.objects);
    expect(restored.objects[0].nodes).toEqual(p.objects[0].nodes);
    expect(restored.objects[1].text).toEqual(p.objects[1].text);
  });

  it("rejects a non-object", () => {
    expect(() => parseProject(42)).toThrow();
    expect(() => parseProject(null)).toThrow();
  });

  it("rejects an unsupported version", () => {
    expect(() => parseProject({ version: 2, colors: [], objects: [] })).toThrow(
      /version/i,
    );
  });

  it("rejects a project missing colors or objects", () => {
    expect(() =>
      parseProject({ version: 1, widthMm: 100, heightMm: 100 }),
    ).toThrow();
  });

  it("coerces non-finite document dimensions to a finite default", () => {
    // A hand-edited/corrupt file with NaN or Infinity dims would otherwise slip
    // past `Math.max(1, …)` (NaN stays NaN, Infinity stays Infinity) and poison
    // every canvas-fit calculation.
    const nan = parseProject({ version: 1, widthMm: NaN, heightMm: 100, colors: [], objects: [] });
    expect(Number.isFinite(nan.widthMm)).toBe(true);
    expect(nan.widthMm).toBeGreaterThan(0);
    const inf = parseProject({ version: 1, widthMm: 100, heightMm: Infinity, colors: [], objects: [] });
    expect(Number.isFinite(inf.heightMm)).toBe(true);
    // A sane finite value is preserved unchanged.
    const ok = parseProject({ version: 1, widthMm: 120, heightMm: 80, colors: [], objects: [] });
    expect(ok.widthMm).toBe(120);
    expect(ok.heightMm).toBe(80);
  });
});

describe("default object naming", () => {
  const named = (name: string): EmbObject => ({
    id: name, name, type: "fill", colorId: "c", paths: [], params: {}, visible: true,
  });

  it("reseeds only from default-form names, ignoring user renames", () => {
    // "Leaf 2024" is a user rename and must NOT push the counter to 2025.
    syncObjectCounter([named("Fill 3"), named("Leaf 2024"), named("Satin 5")]);
    expect(defaultObjectName("fill")).toBe("Fill 6"); // max default (5) + 1
  });

  it("starts a fresh document's names at 1", () => {
    createEmptyProject();
    expect(defaultObjectName("running")).toBe("Running 1");
  });
});
