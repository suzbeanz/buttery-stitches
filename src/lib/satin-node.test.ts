import { describe, it, expect } from "vitest";
import { makeNodeObject, makeObject } from "./objects";
import { generateDesign, countStitches } from "./engine";
import { createEmptyProject } from "./project";

describe("node-backed satin sews", () => {
  const line = [{ x: 20, y: 50 }, { x: 50, y: 50 }, { x: 80, y: 50 }];
  it("generates the same stitches as the legacy satin path", () => {
    const p1 = createEmptyProject();
    const a = makeNodeObject("satin", line, p1.colors[0].id, false);
    p1.objects = [a];
    const n1 = countStitches(generateDesign(p1));

    const p2 = createEmptyProject();
    const b = makeObject("satin", line, p2.colors[0].id);
    p2.objects = [b];
    const n2 = countStitches(generateDesign(p2));

    expect(n1).toBeGreaterThan(50);
    expect(n1).toBe(n2);
  });
});
