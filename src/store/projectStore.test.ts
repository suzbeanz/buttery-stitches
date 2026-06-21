import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "./projectStore";
import { createEmptyProject } from "../lib/project";
import { makeObject, makeNodeObject, cloneObject, makeObjectFromPaths } from "../lib/objects";

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

  it("moveOrder shifts the selection one step and all the way", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("fill", line, cId);
    const b = makeObject("fill", line, cId);
    const c = makeObject("fill", line, cId);
    useProjectStore.getState().addObjects([a, b, c]); // [a, b, c]
    const order = () => useProjectStore.getState().project.objects.map((o) => o.id);

    useProjectStore.getState().moveOrder([a.id], "later"); // [b, a, c]
    expect(order()).toEqual([b.id, a.id, c.id]);
    useProjectStore.getState().moveOrder([a.id], "last"); // [b, c, a]
    expect(order()).toEqual([b.id, c.id, a.id]);
    useProjectStore.getState().moveOrder([a.id], "first"); // [a, b, c]
    expect(order()).toEqual([a.id, b.id, c.id]);
  });

  it("grouping makes a member-click select the whole group", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("fill", line, cId);
    const b = makeObject("fill", line, cId);
    const c = makeObject("fill", line, cId);
    useProjectStore.getState().addObjects([a, b, c]);

    useProjectStore.getState().groupObjects([a.id, b.id]);
    // Selecting just one group member expands to the whole group.
    useProjectStore.getState().setSelection([a.id]);
    expect(new Set(useProjectStore.getState().selectedIds)).toEqual(new Set([a.id, b.id]));
    // A non-grouped object selects alone.
    useProjectStore.getState().setSelection([c.id]);
    expect(useProjectStore.getState().selectedIds).toEqual([c.id]);

    // Ungroup dissolves it.
    useProjectStore.getState().ungroupObjects([a.id]);
    useProjectStore.getState().setSelection([a.id]);
    expect(useProjectStore.getState().selectedIds).toEqual([a.id]);
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

  it("removeColor never orphans a reference (reassigns to a remaining thread)", () => {
    const st = useProjectStore.getState();
    const c0 = st.project.colors[0].id;
    st.addColor({ id: "c_extra", rgb: [1, 2, 3], name: "Extra" });
    const o = makeObject("fill", line, "c_extra");
    st.addObject(o);

    useProjectStore.getState().removeColor("c_extra");
    const after = useProjectStore.getState().project;
    expect(after.colors.find((c) => c.id === "c_extra")).toBeUndefined();
    // the object that referenced it is reassigned, not orphaned
    expect(after.objects.find((x) => x.id === o.id)!.colorId).toBe(c0);
  });

  it("removeColor refuses to delete the last remaining thread", () => {
    const st = useProjectStore.getState();
    const only = st.project.colors[0].id;
    // collapse to a single color first
    while (useProjectStore.getState().project.colors.length > 1) {
      const extra = useProjectStore.getState().project.colors.find((c) => c.id !== only)!;
      useProjectStore.getState().removeColor(extra.id);
    }
    useProjectStore.getState().removeColor(only);
    expect(useProjectStore.getState().project.colors.length).toBe(1);
  });

  it("splitObject cuts a running line into two pieces at a point", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const o = makeNodeObject("running", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], cId, false);
    useProjectStore.getState().addObject(o);
    useProjectStore.getState().splitObject(o.id, 1, { x: 15, y: 0 }); // on segment 1 (10→20)

    const objs = useProjectStore.getState().project.objects;
    expect(objs).toHaveLength(2);
    expect(objs.find((x) => x.id === o.id)).toBeUndefined(); // original replaced
    for (const x of objs) {
      expect(x.type).toBe("running");
      expect((x.nodes?.[0].length ?? 0)).toBeGreaterThanOrEqual(2);
    }
    // both new pieces are selected
    expect(useProjectStore.getState().selectedIds).toHaveLength(2);
  });

  it("splitObject is a no-op on a closed (fill) object", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const f = makeNodeObject("fill", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], cId, false);
    useProjectStore.getState().addObject(f);
    useProjectStore.getState().splitObject(f.id, 1, { x: 5, y: 5 });
    expect(useProjectStore.getState().project.objects).toHaveLength(1); // unchanged
  });
});

describe("projectStore.smoothObjects", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: createEmptyProject(), selectedIds: [] });
    useProjectStore.temporal.getState().clear();
  });

  it("rounds a node-backed line's corners (densifies + flags nodes smooth)", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const o = makeNodeObject("running", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], cId, false);
    useProjectStore.getState().addObject(o);
    const before = o.paths[0].length;
    useProjectStore.getState().smoothObjects([o.id]);
    const after = useProjectStore.getState().project.objects[0];
    expect(after.nodes![0].every((n) => n.smooth)).toBe(true);
    expect(after.paths[0].length).toBeGreaterThan(before); // curved spans add points
  });

  it("smooths a plain running polyline and is undoable", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const o = makeObjectFromPaths("running", [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]], cId);
    useProjectStore.getState().addObject(o);
    const before = o.paths[0].length;
    useProjectStore.getState().smoothObjects([o.id]);
    expect(useProjectStore.getState().project.objects[0].paths[0].length).toBeGreaterThan(before);
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().project.objects[0].paths[0].length).toBe(before);
  });

  it("leaves a satin object untouched", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const o = makeObject("satin", [{ x: 0, y: 0 }, { x: 20, y: 0 }], cId);
    useProjectStore.getState().addObject(o);
    const before = o.paths;
    useProjectStore.getState().smoothObjects([o.id]);
    expect(useProjectStore.getState().project.objects[0].paths).toBe(before);
  });
});

describe("projectStore.mergeObjects / splitRegion", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: createEmptyProject(), selectedIds: [] });
    useProjectStore.temporal.getState().clear();
  });

  const square = (x: number, y: number, s = 10) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];

  it("merges two same-color fills into one region, undoable in one step", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("fill", square(0, 0), cId);
    const b = makeObject("fill", square(20, 0), cId);
    useProjectStore.getState().addObjects([a, b]);
    useProjectStore.getState().setSelection([a.id, b.id]);

    useProjectStore.getState().mergeObjects([a.id, b.id]);
    const { project, selectedIds } = useProjectStore.getState();
    expect(project.objects).toHaveLength(1);
    expect(project.objects[0].type).toBe("fill");
    expect(selectedIds).toEqual([project.objects[0].id]);

    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().project.objects.map((o) => o.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("refuses to merge fills of different colors", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("fill", square(0, 0), cId);
    const b = makeObject("fill", square(20, 0), cId);
    b.colorId = "other-color";
    useProjectStore.getState().addObjects([a, b]);
    useProjectStore.getState().mergeObjects([a.id, b.id]);
    expect(useProjectStore.getState().project.objects).toHaveLength(2); // unchanged
  });

  it("refuses to merge when a non-fill is selected", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const a = makeObject("fill", square(0, 0), cId);
    const b = makeObject("running", [{ x: 0, y: 0 }, { x: 10, y: 0 }], cId);
    useProjectStore.getState().addObjects([a, b]);
    useProjectStore.getState().mergeObjects([a.id, b.id]);
    expect(useProjectStore.getState().project.objects).toHaveLength(2); // unchanged
  });

  it("splits a fill with two disjoint pieces into two objects", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const o = makeObject("fill", square(0, 0), cId);
    o.paths = [square(0, 0), square(20, 0)]; // two detached blobs
    useProjectStore.getState().addObject(o);

    useProjectStore.getState().splitRegion(o.id);
    const { project, selectedIds } = useProjectStore.getState();
    expect(project.objects).toHaveLength(2);
    expect(project.objects.find((x) => x.id === o.id)).toBeUndefined();
    expect(selectedIds).toHaveLength(2);
    expect(project.objects.every((x) => x.type === "fill")).toBe(true);
  });

  it("is a no-op splitting a single-piece fill", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const o = makeObject("fill", square(0, 0), cId);
    useProjectStore.getState().addObject(o);
    useProjectStore.getState().splitRegion(o.id);
    expect(useProjectStore.getState().project.objects).toHaveLength(1); // unchanged
  });

  it("is a no-op splitting a running line", () => {
    const cId = useProjectStore.getState().project.colors[0].id;
    const o = makeObject("running", [{ x: 0, y: 0 }, { x: 10, y: 0 }], cId);
    useProjectStore.getState().addObject(o);
    useProjectStore.getState().splitRegion(o.id);
    expect(useProjectStore.getState().project.objects).toHaveLength(1); // unchanged
  });
});
