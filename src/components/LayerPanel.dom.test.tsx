// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LayerPanel from "./LayerPanel";
import { useProjectStore } from "../store/projectStore";
import { resetStores } from "../test/setup";
import { makeObject } from "../lib/objects";
import { createEmptyProject } from "../lib/project";

function seedTwoObjects() {
  const project = createEmptyProject();
  const colorId = project.colors[0].id;
  const a = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], colorId);
  a.name = "Alpha";
  const b = makeObject("fill", [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], colorId);
  b.name = "Beta";
  project.objects = [a, b];
  resetStores(project);
}

describe("LayerPanel", () => {
  beforeEach(() => {
    cleanup();
    seedTwoObjects();
  });

  it("lists objects in stitch order", () => {
    render(<LayerPanel />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("selects an object when its row is clicked", () => {
    render(<LayerPanel />);
    fireEvent.click(screen.getByText("Alpha"));
    expect(useProjectStore.getState().selectedIds).toHaveLength(1);
  });

  it("deletes an object", () => {
    render(<LayerPanel />);
    const before = useProjectStore.getState().project.objects.length;
    // Each row has a delete button.
    fireEvent.click(screen.getAllByLabelText("Delete")[0]);
    expect(useProjectStore.getState().project.objects.length).toBe(before - 1);
  });

  it("toggles visibility", () => {
    render(<LayerPanel />);
    const obj = useProjectStore.getState().project.objects[0];
    expect(obj.visible).toBe(true);
    fireEvent.click(screen.getAllByLabelText("Hide")[0]);
    expect(useProjectStore.getState().project.objects[0].visible).toBe(false);
  });
});
