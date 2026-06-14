import { describe, it, expect } from "vitest";
import {
  createEmptyProject,
  parseProject,
  serializeProject,
} from "./project";

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
