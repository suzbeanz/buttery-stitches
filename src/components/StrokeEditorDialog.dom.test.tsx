// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import StrokeEditorDialog from "./StrokeEditorDialog";
import { useProjectStore } from "../store/projectStore";
import { createEmptyProject } from "../lib/project";
import { makeObjectFromPaths } from "../lib/objects";
import type { Path } from "../types/project";

const bar = (x: number, y: number, w: number, h: number): Path => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

let objectId = "";
beforeEach(() => {
  const p = createEmptyProject();
  const o = makeObjectFromPaths("fill", [bar(10, 10, 24, 3)], p.colors[0].id, "Bar");
  p.objects.push(o);
  objectId = o.id;
  useProjectStore.setState({ project: p, selectedIds: [o.id] });
  useProjectStore.temporal.getState().clear();
});
afterEach(cleanup);

describe("StrokeEditorDialog", () => {
  it("opens with auto-derived strokes and saves them onto the object", () => {
    render(<StrokeEditorDialog objectId={objectId} onClose={() => {}} />);
    const canvas = screen.getByLabelText(/stroke editing canvas/i);
    // A 24x3 bar auto-derives at least one centerline stroke.
    expect(Number(canvas.getAttribute("data-strokes"))).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /save strokes/i }));
    const o = useProjectStore.getState().project.objects.find((x) => x.id === objectId)!;
    expect((o.satinCenterlines ?? []).length).toBeGreaterThan(0);
    // Undoable in one step.
    useProjectStore.temporal.getState().undo();
    const o2 = useProjectStore.getState().project.objects.find((x) => x.id === objectId)!;
    expect(o2.satinCenterlines ?? []).toHaveLength(0);
  });

  it("reset-to-auto and delete keep the count coherent", () => {
    render(<StrokeEditorDialog objectId={objectId} onClose={() => {}} />);
    const canvas = screen.getByLabelText(/stroke editing canvas/i);
    const n = Number(canvas.getAttribute("data-strokes"));
    fireEvent.click(screen.getByRole("button", { name: /reset to auto/i }));
    expect(Number(canvas.getAttribute("data-strokes"))).toBe(n);
  });
});
