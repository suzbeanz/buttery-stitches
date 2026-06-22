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

  it("organizes controls into Object / Arrange / Design / Threads tabs", () => {
    seedSelectedFill();
    render(<PropertiesPanel />);
    // Object tab is default and shows object controls.
    expect(screen.getByText(/Density/i)).toBeTruthy();
    // Threads controls are NOT in the object tab.
    expect(screen.queryByText("+ Add")).toBeNull();
    // Switching to Threads reveals palette management.
    fireEvent.click(screen.getByRole("tab", { name: "Threads" }));
    expect(screen.getByText("+ Add")).toBeTruthy();
    expect(screen.queryByText(/Density/i)).toBeNull();
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

    // Pick the outline color (the second project color, "Red") via the swatch dropdown.
    fireEvent.click(screen.getByRole("button", { name: /^Outline color:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    void outlineColorId;

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
    fireEvent.click(screen.getByRole("tab", { name: "Threads" }));
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

  it("nudges a numeric param with the branded + / − steppers", () => {
    const { fillId } = seedSelectedFill();
    render(<PropertiesPanel />);
    const input = screen.getByText(/Density/i).closest("label")!.querySelector("input") as HTMLInputElement;
    const shown = Number(input.value); // the displayed (default) density
    fireEvent.click(screen.getByRole("button", { name: /Increase Density/i }));
    const after = useProjectStore.getState().project.objects.find((o) => o.id === fillId)!.params.density!;
    expect(after).toBeGreaterThan(shown);
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

  it("shows the Angle field when no direction is painted", () => {
    seedSelectedFill();
    render(<PropertiesPanel />);
    expect(screen.getByText(/Angle \(° from auto\)/i)).toBeTruthy();
  });

  it("shows the manual Direction readout with an Auto reset that clears it", () => {
    const { fillId } = seedSelectedFill();
    useProjectStore.getState().updateObjectParams(fillId, { directionDeg: 30 });
    render(<PropertiesPanel />);
    expect(screen.getByText(/Manual — 30/)).toBeTruthy();
    expect(screen.queryByText(/Angle \(° from auto\)/i)).toBeNull(); // auto field hidden
    fireEvent.click(screen.getByText(/^Auto$/));
    const dd = useProjectStore.getState().project.objects.find((o) => o.id === fillId)!.params.directionDeg;
    expect(dd == null).toBe(true);
  });

  it("shows a Curved (flow) readout when a flow path is painted, and Auto clears it", () => {
    const { fillId } = seedSelectedFill();
    useProjectStore.getState().updateObjectParams(fillId, {
      flowPath: [[0, 0.5], [0.5, 0.2], [1, 0.5]],
    });
    render(<PropertiesPanel />);
    expect(screen.getByText(/Curved \(flow\)/i)).toBeTruthy();
    expect(screen.queryByText(/Angle \(° from auto\)/i)).toBeNull();
    fireEvent.click(screen.getByText(/^Auto$/));
    const fp = useProjectStore.getState().project.objects.find((o) => o.id === fillId)!.params.flowPath;
    expect(fp == null).toBe(true);
  });

  it("deletes an unused thread but disables deleting one in use", () => {
    seedSelectedFill(); // colors: the fill's color (in use) + "Red" (unused)
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Threads" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "Threads" }));

    const before = useProjectStore.getState().project.colors.length;
    // First click arms the confirm — nothing deleted yet.
    fireEvent.click(screen.getByLabelText("Delete Active"));
    expect(useProjectStore.getState().project.colors.length).toBe(before);
    // Second click (now relabeled) commits the delete.
    fireEvent.click(screen.getByLabelText("Confirm delete Active"));
    expect(useProjectStore.getState().project.colors.length).toBe(before - 1);
  });

  it("smooths the selected line via the Object tab button", () => {
    const project = createEmptyProject();
    const colorId = project.colors[0].id;
    const o = makeObject(
      "running",
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      colorId,
    );
    project.objects = [o];
    resetStores(project);
    useProjectStore.setState({ selectedIds: [o.id] });

    render(<PropertiesPanel />);
    const before = useProjectStore.getState().project.objects[0].paths[0].length;
    fireEvent.click(screen.getByRole("button", { name: /Smooth lines/i }));
    expect(useProjectStore.getState().project.objects[0].paths[0].length).toBeGreaterThan(before);
  });

  // ---- region merge / split ----
  const square = (x: number, y: number, s = 10) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];

  /** Two fills, same color unless `secondColor` is given; both selected. */
  function seedTwoFills(secondColor?: string) {
    const project = createEmptyProject();
    const colorId = project.colors[0].id;
    const a = makeObject("fill", square(0, 0), colorId);
    const b = makeObject("fill", square(20, 0), colorId);
    if (secondColor) {
      project.colors.push({ id: secondColor, rgb: [0, 0, 200], name: "Blue" });
      b.colorId = secondColor;
    }
    project.objects = [a, b];
    resetStores(project);
    useProjectStore.setState({ selectedIds: [a.id, b.id] });
    return { a, b };
  }

  it("disables Merge for a single selection", () => {
    seedSelectedFill();
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Arrange" }));
    expect(screen.getByLabelText(/^Merge regions/)).toHaveProperty("disabled", true);
  });

  it("disables Merge for two different-color fills", () => {
    seedTwoFills("c_blue");
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Arrange" }));
    expect(screen.getByLabelText(/^Merge regions/)).toHaveProperty("disabled", true);
  });

  it("merges two same-color fills into one region", () => {
    seedTwoFills();
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Arrange" }));
    const btn = screen.getByLabelText(/^Merge regions/) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(useProjectStore.getState().project.objects).toHaveLength(1);
  });

  it("splits a multi-piece fill into separate regions", () => {
    const project = createEmptyProject();
    const colorId = project.colors[0].id;
    const o = makeObject("fill", square(0, 0), colorId);
    o.paths = [square(0, 0), square(20, 0)]; // two detached blobs
    project.objects = [o];
    resetStores(project);
    useProjectStore.setState({ selectedIds: [o.id] });

    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Arrange" }));
    const btn = screen.getByLabelText(/^Split into/) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(useProjectStore.getState().project.objects).toHaveLength(2);
  });

  it("disables Split for a single-piece fill", () => {
    seedSelectedFill();
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Arrange" }));
    expect(screen.getByLabelText(/^Split into/)).toHaveProperty("disabled", true);
  });

  it("welds a fill's edge to an abutting neighbor from the Arrange tab", () => {
    const project = createEmptyProject();
    const colorId = project.colors[0].id;
    const sq = (x: number) => [
      { x, y: 0 },
      { x: x + 10, y: 0 },
      { x: x + 10, y: 10 },
      { x, y: 10 },
    ];
    const left = makeObject("fill", sq(0), colorId);
    const right = makeObject("fill", sq(10), colorId);
    project.objects = [left, right];
    resetStores(project);
    useProjectStore.setState({ selectedIds: [left.id] });

    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Arrange" }));
    const weld = screen.getByLabelText(/^Weld edge/) as HTMLButtonElement;
    expect(weld.disabled).toBe(false);
    const beforeMaxX = Math.max(
      ...useProjectStore.getState().project.objects[0].paths.flat().map((p) => p.x),
    );
    fireEvent.click(weld);
    const afterMaxX = Math.max(
      ...useProjectStore.getState().project.objects[0].paths.flat().map((p) => p.x),
    );
    expect(afterMaxX).toBeGreaterThan(beforeMaxX);
  });
});
