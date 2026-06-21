// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ReviewBar from "./ReviewBar";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { resetStores } from "../test/setup";
import { makeObject } from "../lib/objects";
import { createEmptyProject } from "../lib/project";

/** Seed a project with N fill objects and return their ids in order. */
function seed(n: number): string[] {
  const project = createEmptyProject();
  const colorId = project.colors[0].id;
  const objects = Array.from({ length: n }, () =>
    makeObject(
      "fill",
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      colorId,
    ),
  );
  objects.forEach((o, i) => (o.name = `Region ${i + 1}`));
  project.objects = objects;
  resetStores(project);
  return objects.map((o) => o.id);
}

function startReview(ids: string[], index = 0) {
  useEditorStore.setState({ reviewIds: ids, reviewIndex: index });
}

describe("ReviewBar", () => {
  beforeEach(() => {
    cleanup();
    resetStores();
  });

  it("renders nothing when no review is active", () => {
    seed(2);
    const { container } = render(<ReviewBar />);
    expect(container.firstChild).toBeNull();
  });

  it("shows progress and the current region, and selects it on mount", () => {
    const ids = seed(3);
    startReview(ids, 0);
    render(<ReviewBar />);
    expect(screen.getByText("Region 1 of 3")).toBeTruthy();
    expect(screen.getByText("Region 1")).toBeTruthy();
    // The selection effect frames the current region.
    expect(useProjectStore.getState().selectedIds).toEqual([ids[0]]);
  });

  it("changes the stitch type via the type switch", () => {
    const ids = seed(1);
    startReview(ids, 0);
    render(<ReviewBar />);
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    const o = useProjectStore.getState().project.objects.find((x) => x.id === ids[0])!;
    expect(o.type).toBe("running");
  });

  it("Skip hides the region and drops it from the selection; Keep restores it", () => {
    const ids = seed(2);
    startReview(ids, 0);
    render(<ReviewBar />);
    const skip = screen.getByRole("button", { name: /Skip/i });
    fireEvent.click(skip);
    let o = useProjectStore.getState().project.objects.find((x) => x.id === ids[0])!;
    expect(o.visible).toBe(false);
    expect(useProjectStore.getState().selectedIds).not.toContain(ids[0]);
    // Card stays on the same region; label flips to "Skipped".
    expect(screen.getByText("Region 1 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Skipped/i })).toBeTruthy();
    // Keep restores it.
    fireEvent.click(screen.getByRole("button", { name: /Skipped/i }));
    o = useProjectStore.getState().project.objects.find((x) => x.id === ids[0])!;
    expect(o.visible).toBe(true);
  });

  it("Next advances and re-selects; Back steps back", () => {
    const ids = seed(3);
    startReview(ids, 0);
    render(<ReviewBar />);
    fireEvent.click(screen.getByRole("button", { name: "Next region" }));
    expect(useEditorStore.getState().reviewIndex).toBe(1);
    expect(useProjectStore.getState().selectedIds).toEqual([ids[1]]);
    fireEvent.click(screen.getByRole("button", { name: "Previous region" }));
    expect(useEditorStore.getState().reviewIndex).toBe(0);
  });

  it("shows Done on the last region and closes the review", () => {
    const ids = seed(2);
    startReview(ids, 1);
    render(<ReviewBar />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(useEditorStore.getState().reviewIds).toBeNull();
  });

  it("closes review gracefully when none of the reviewed ids survive (undo)", () => {
    seed(2);
    // Simulate an undo that wiped the digitized objects: ids no longer present.
    startReview(["gone-1", "gone-2"], 0);
    const { container } = render(<ReviewBar />);
    expect(container.firstChild).toBeNull();
    expect(useEditorStore.getState().reviewIds).toBeNull();
  });
});
