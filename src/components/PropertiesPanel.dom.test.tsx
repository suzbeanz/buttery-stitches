// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PropertiesPanel from "./PropertiesPanel";
import { useProjectStore } from "../store/projectStore";
import { resetStores } from "../test/setup";
import { makeObject, satinWidthOf } from "../lib/objects";
import { createEmptyProject } from "../lib/project";

function seedSelectedSatin() {
  const project = createEmptyProject();
  const colorId = project.colors[0].id;
  const o = makeObject("satin", [{ x: 0, y: 0 }, { x: 20, y: 0 }], colorId);
  project.objects = [o];
  resetStores(project);
  useProjectStore.setState({ selectedIds: [o.id] });
  return o.id;
}

describe("PropertiesPanel", () => {
  beforeEach(() => {
    cleanup();
  });

  it("prompts to select when nothing is selected", () => {
    resetStores();
    render(<PropertiesPanel />);
    expect(screen.getByText(/Select an object/i)).toBeTruthy();
  });

  it("shows the satin column-width control for a satin object", () => {
    seedSelectedSatin();
    render(<PropertiesPanel />);
    expect(screen.getByText(/Column width/i)).toBeTruthy();
  });

  it("converts geometry when the stitch type changes", () => {
    const id = seedSelectedSatin();
    render(<PropertiesPanel />);
    const select = screen.getByDisplayValue("Satin") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "running" } });
    const o = useProjectStore.getState().project.objects.find((x) => x.id === id)!;
    expect(o.type).toBe("running");
    // satin (2 rails) collapsed to a single centreline path
    expect(o.paths).toHaveLength(1);
  });

  it("re-densifies satin rails when width changes", () => {
    const id = seedSelectedSatin();
    render(<PropertiesPanel />);
    const label = screen.getByText(/Column width/i).closest("label")!;
    const input = label.querySelector("input")!;
    fireEvent.change(input, { target: { value: "9" } });
    const o = useProjectStore.getState().project.objects.find((x) => x.id === id)!;
    expect(satinWidthOf(o.paths)).toBeCloseTo(9, 1);
  });

  it("adds a thread colour", () => {
    resetStores();
    render(<PropertiesPanel />);
    const before = useProjectStore.getState().project.colors.length;
    fireEvent.click(screen.getByText("+ Add"));
    expect(useProjectStore.getState().project.colors.length).toBe(before + 1);
  });
});
