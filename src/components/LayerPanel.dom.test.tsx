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

  it("exposes the full name via a title so a truncated name is still readable", () => {
    render(<LayerPanel />);
    const name = screen.getByText("Alpha");
    expect(name.getAttribute("title")).toContain("Alpha");
  });

  it("keeps the secondary buttons zero-width (hidden, not opacity-0) at rest so the name fills the row", () => {
    render(<LayerPanel />);
    const wrapper = screen.getAllByLabelText("Move up")[0].closest("span");
    expect(wrapper?.className).toContain("hidden");
    expect(wrapper?.className).not.toContain("opacity-0");
  });

  it("renames an object on double-click + Enter", () => {
    render(<LayerPanel />);
    fireEvent.doubleClick(screen.getByText("Alpha"));
    const input = screen.getByLabelText("Layer name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useProjectStore.getState().project.objects[0].name).toBe("Renamed");
  });

  it("⌘/Ctrl-click toggles a row in and out of the selection", () => {
    render(<LayerPanel />);
    fireEvent.click(screen.getByText("Alpha")); // select just Alpha
    expect(useProjectStore.getState().selectedIds).toHaveLength(1);
    fireEvent.click(screen.getByText("Beta"), { metaKey: true }); // add Beta
    expect(useProjectStore.getState().selectedIds).toHaveLength(2);
    fireEvent.click(screen.getByText("Beta"), { metaKey: true }); // remove Beta
    expect(useProjectStore.getState().selectedIds).toEqual([
      useProjectStore.getState().project.objects[0].id,
    ]);
  });

  it("Shift-click selects the contiguous range from the anchor", () => {
    render(<LayerPanel />);
    fireEvent.click(screen.getByText("Alpha")); // anchor
    fireEvent.click(screen.getByText("Beta"), { shiftKey: true }); // range Alpha..Beta
    expect(useProjectStore.getState().selectedIds).toHaveLength(2);
  });
});
