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

  it("drops selection that no longer exists after an undo", () => {
    const colorId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("running", line, colorId);
    useProjectStore.getState().addObject(a);
    expect(useProjectStore.getState().selectedIds).toEqual([a.id]);

    // Undo the add: the object is gone, so the stale selection must clear
    // (otherwise the Transformer/Properties would target a ghost object).
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().project.objects).toHaveLength(0);
    expect(useProjectStore.getState().selectedIds).toEqual([]);
  });
});

describe("projectStore — QA fixes", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: createEmptyProject(), selectedIds: [] });
    useProjectStore.temporal.getState().clear();
  });

  it("insertObjectsAfter places objects right after the anchor in one undo step", () => {
    const colorId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("fill", line, colorId);
    const b = makeObject("running", line, colorId);
    useProjectStore.getState().addObjects([a, b]); // [a, b]

    const o1 = makeObject("satin", line, colorId);
    const o2 = makeObject("satin", line, colorId);
    useProjectStore.getState().insertObjectsAfter(a.id, [o1, o2]);

    const { project, selectedIds } = useProjectStore.getState();
    expect(project.objects.map((o) => o.id)).toEqual([a.id, o1.id, o2.id, b.id]);
    expect(selectedIds).toEqual([o1.id, o2.id]);

    // Whole insertion is a SINGLE undo step.
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().project.objects.map((o) => o.id)).toEqual([a.id, b.id]);
  });

  it("hiding an object removes it from the selection", () => {
    const colorId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("fill", line, colorId);
    useProjectStore.getState().addObject(a);
    expect(useProjectStore.getState().selectedIds).toEqual([a.id]);

    useProjectStore.getState().updateObject(a.id, { visible: false });
    expect(useProjectStore.getState().selectedIds).toEqual([]);

    // Showing it again does not force-select it (no surprise reselection).
    useProjectStore.getState().updateObject(a.id, { visible: true });
    expect(useProjectStore.getState().selectedIds).toEqual([]);
  });
});
