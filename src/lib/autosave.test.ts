// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { saveAutosave, loadAutosave, clearAutosave } from "./autosave";
import { createEmptyProject } from "./project";
import { makeObjectFromPaths } from "./objects";

/** Batch 4 — session autosave round-trip. */

function projectWithObject() {
  const p = createEmptyProject();
  const obj = makeObjectFromPaths(
    "running",
    [[{ x: 0, y: 0 }, { x: 10, y: 10 }]],
    p.colors[0].id,
  );
  return { ...p, objects: [obj] };
}

describe("autosave", () => {
  beforeEach(() => clearAutosave());

  it("round-trips a project through localStorage", () => {
    const p = projectWithObject();
    saveAutosave(p);
    const back = loadAutosave();
    expect(back).not.toBeNull();
    expect(back!.objects).toHaveLength(1);
    expect(back!.objects[0].type).toBe("running");
    expect(back!.objects[0].paths[0]).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  });

  it("does not persist (and clears) an empty document", () => {
    saveAutosave(projectWithObject());
    saveAutosave(createEmptyProject()); // empty → should clear
    expect(loadAutosave()).toBeNull();
  });

  it("returns null when there's nothing saved or it's malformed", () => {
    expect(loadAutosave()).toBeNull();
    localStorage.setItem("bs:autosave:v1", "{not json");
    expect(loadAutosave()).toBeNull();
  });
});
