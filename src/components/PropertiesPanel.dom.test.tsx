// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PropertiesPanel from "./PropertiesPanel";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { resetStores } from "../test/setup";
import { makeObject, satinWidthOf } from "../lib/objects";
import { createEmptyProject } from "../lib/project";
import { newId } from "../lib/id";

function seedSelectedSatin() {
  const project = createEmptyProject();
  const colorId = project.colors[0].id;
  const o = makeObject("satin", [{ x: 0, y: 0 }, { x: 20, y: 0 }], colorId);
  project.objects = [o];
  resetStores(project);
  useProjectStore.setState({ selectedIds: [o.id] });
  return o.id;
}

function seedSelectedFill() {
  const project = createEmptyProject();
  const colorId = project.colors[0].id;
  // A square fill region plus a second color to outline with.
  const fill = makeObject(
    "fill",
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    colorId,
  );
  const outlineColorId = newId("color");
  project.colors.push({ id: outlineColorId, rgb: [200, 0, 0], name: "Red" });
  project.objects = [fill];
  resetStores(project);
  useProjectStore.setState({ selectedIds: [fill.id] });
  return { fillId: fill.id, fillColorId: colorId, outlineColorId };
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
    // satin (2 rails) collapsed to a single centerline path
    expect(o.paths).toHaveLength(1);
  });

  it("re-densifies satin rails when width changes", () => {
    const id = seedSelectedSatin();
    render(<PropertiesPanel />);
    const label = screen.getByText(/Column width/i).closest("label")!;
    const input = label.querySelector("input")!;
    // Number fields commit on blur (not every keystroke).
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    const o = useProjectStore.getState().project.objects.find((x) => x.id === id)!;
    expect(satinWidthOf(o.paths)).toBeCloseTo(9, 1);
  });

  it("shows the add-satin-outline control for a fill object", () => {
    seedSelectedFill();
    render(<PropertiesPanel />);
    expect(screen.getByText(/Add satin outline/i)).toBeTruthy();
  });

  it("does not show the outline control for a satin object", () => {
    seedSelectedSatin();
    render(<PropertiesPanel />);
    expect(screen.queryByText(/Add satin outline/i)).toBeNull();
  });

  it("adds a satin outline after the fill in the chosen color", () => {
    const { fillId, outlineColorId } = seedSelectedFill();
    render(<PropertiesPanel />);

    // Pick the outline color (the second project color, "Red").
    const colorSelect = screen
      .getByText(/Outline color/i)
      .closest("label")!
      .querySelector("select") as HTMLSelectElement;
    fireEvent.change(colorSelect, { target: { value: outlineColorId } });

    fireEvent.click(screen.getByText(/Add satin outline/i));

    const objects = useProjectStore.getState().project.objects;
    expect(objects).toHaveLength(2);
    const fillIndex = objects.findIndex((o) => o.id === fillId);
    const outline = objects[fillIndex + 1];
    expect(outline.type).toBe("satin");
    expect(outline.colorId).toBe(outlineColorId);
    // A satin object carries exactly two rails.
    expect(outline.paths).toHaveLength(2);
  });

  it("toggles a fill's outline off via the Show outline checkbox", () => {
    const { fillId } = seedSelectedFill();
    render(<PropertiesPanel />);
    const checkbox = screen.getByLabelText("Show outline") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    const fill = useProjectStore
      .getState()
      .project.objects.find((o) => o.id === fillId)!;
    expect(fill.params.outline).toBe(false);
  });

  it("adds a thread color", () => {
    resetStores();
    render(<PropertiesPanel />);
    const before = useProjectStore.getState().project.colors.length;
    fireEvent.click(screen.getByText("+ Add"));
    expect(useProjectStore.getState().project.colors.length).toBe(before + 1);
  });

  it("clamps a numeric param to its minimum (no zero/negative density)", () => {
    const { fillId } = seedSelectedFill();
    render(<PropertiesPanel />);
    const input = screen.getByText(/Density/i).closest("label")!.querySelector("input")!;
    // Commit on blur: a typed value is clamped to the safe floor when it lands.
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    const d = useProjectStore.getState().project.objects.find((o) => o.id === fillId)!.params.density;
    expect(d).toBeGreaterThanOrEqual(0.1);
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.blur(input);
    const d2 = useProjectStore.getState().project.objects.find((o) => o.id === fillId)!.params.density;
    expect(d2).toBeGreaterThanOrEqual(0.1);
  });

  it("tucks the carve/appliqué controls behind the Advanced fill disclosure", () => {
    seedSelectedFill();
    render(<PropertiesPanel />);
    // Collapsed by default — the everyday controls show, the extras don't.
    expect(screen.getByText(/Density/i)).toBeTruthy();
    expect(screen.queryByText(/Carve pattern/i)).toBeNull();
    expect(screen.queryByText(/Appliqué/i)).toBeNull();
    // Expanding reveals them.
    fireEvent.click(screen.getByText(/Advanced fill/i));
    expect(screen.getByText(/Carve pattern/i)).toBeTruthy();
    expect(screen.getByText(/Appliqué/i)).toBeTruthy();
  });

  it("deletes an unused thread but disables deleting one in use", () => {
    seedSelectedFill(); // colors: the fill's color (in use) + "Red" (unused)
    render(<PropertiesPanel />);
    const dels = screen.getAllByLabelText(/^Delete /) as HTMLButtonElement[];
    const enabled = dels.filter((b) => !b.disabled);
    const disabled = dels.filter((b) => b.disabled);
    expect(enabled).toHaveLength(1); // only the unused "Red"
    expect(disabled).toHaveLength(1); // the in-use fill color can't be deleted
    const before = useProjectStore.getState().project.colors.length;
    fireEvent.click(enabled[0]);
    expect(useProjectStore.getState().project.colors.length).toBe(before - 1);
  });

  it("needs a confirming second click to delete the ACTIVE draw thread", () => {
    const project = createEmptyProject();
    const activeId = newId("color");
    project.colors.push({ id: activeId, rgb: [0, 200, 0], name: "Active" });
    resetStores(project); // no object uses 'Active' → unused & deletable
    useEditorStore.setState({ activeColorId: activeId });
    render(<PropertiesPanel />);

    const before = useProjectStore.getState().project.colors.length;
    // First click arms the confirm — nothing deleted yet.
    fireEvent.click(screen.getByLabelText("Delete Active"));
    expect(useProjectStore.getState().project.colors.length).toBe(before);
    // Second click (now relabeled) commits the delete.
    fireEvent.click(screen.getByLabelText("Confirm delete Active"));
    expect(useProjectStore.getState().project.colors.length).toBe(before - 1);
  });
});
