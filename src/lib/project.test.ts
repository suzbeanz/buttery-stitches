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
