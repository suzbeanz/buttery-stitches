import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "./projectStore";
import { createEmptyProject } from "../lib/project";
import { makeObject, cloneObject } from "../lib/objects";

const line = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];

describe("projectStore.addObjects", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: createEmptyProject(), selectedIds: [] });
    useProjectStore.temporal.getState().clear();
  });

  it("appends several objects at once and selects them all", () => {
    const colorId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("running", line, colorId);
    const b = makeObject("running", line, colorId);

    useProjectStore.getState().addObjects([a, b]);

    const { project, selectedIds } = useProjectStore.getState();
    expect(project.objects.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(selectedIds).toEqual([a.id, b.id]);
  });

  it("supports a paste flow: clones keep distinct ids and offset geometry", () => {
    const colorId = useProjectStore.getState().project.colors[0].id;
    const original = makeObject("fill", line, colorId);
    useProjectStore.getState().addObject(original);

    const pasted = cloneObject(original, 3, 3);
    useProjectStore.getState().addObjects([pasted]);

    const { project } = useProjectStore.getState();
    expect(project.objects).toHaveLength(2);
    expect(project.objects[1].id).not.toBe(original.id);
    expect(project.objects[1].paths[0][0]).toEqual({ x: 3, y: 3 });
  });
});
