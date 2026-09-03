// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ReviewBar from "./ReviewBar";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { resetStores } from "../test/setup";
import { makeObject } from "../lib/objects";
import { createEmptyProject } from "../lib/project";
import { generateObjectStitches } from "../lib/engine";
import type { EmbObject } from "../types/project";

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

  it("groups controls into two phone rows that dissolve into one at sm+ (sm:contents)", () => {
    // On a 360-412px phone the old single flex-wrap row broke into 2-3 ragged
    // rows over the canvas. The layout now has an identity row (progress +
    // name + keep/skip) and an action row (type switch + nav + close); both
    // wrappers are `sm:contents` so wider screens keep the classic one-row bar.
    const ids = seed(2);
    startReview(ids, 0);
    render(<ReviewBar />);
    const group = screen.getByRole("group", { name: "Review regions" });
    const rows = group.querySelectorAll(":scope > div.sm\\:contents");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("Region 1 of 2");
    expect(rows[1].contains(screen.getByRole("button", { name: "Next region" }))).toBe(true);
    expect(rows[1].contains(screen.getByRole("button", { name: "Close review" }))).toBe(true);
  });

  // ── Optional per-region refine ─────────────────────────────────────────

  const objById = (id: string): EmbObject =>
    useProjectStore.getState().project.objects.find((o) => o.id === id)!;

  function openRefine() {
    fireEvent.click(screen.getByRole("button", { name: "Refine stitches" }));
  }

  it("refine is collapsed by default and reveals style, angle, density and outline", () => {
    const ids = seed(2);
    startReview(ids, 0);
    render(<ReviewBar />);
    expect(screen.queryByLabelText("Region stitch style")).toBeNull();
    openRefine();
    expect(screen.getByLabelText("Region stitch style")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase angle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase density" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Satin outline" })).toBeTruthy();
  });

  it("the style select reuses the wizard's styleObject mapping (fur / outline), and Auto restores", () => {
    const ids = seed(1);
    startReview(ids, 0);
    render(<ReviewBar />);
    openRefine();
    const select = screen.getByLabelText("Region stitch style") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "fur" } });
    expect(objById(ids[0]).params.fillStyle).toBe("fur");
    fireEvent.change(select, { target: { value: "outline" } });
    expect(objById(ids[0]).type).toBe("running");
    // Auto genuinely restores the trace's own classification, not a guess.
    fireEvent.change(select, { target: { value: "auto" } });
    expect(objById(ids[0]).type).toBe("fill");
    expect(objById(ids[0]).params.fillStyle).toBeUndefined();
  });

  it("hides the Angle stepper when a painted direction overrides the base angle", () => {
    const ids = seed(1);
    // angleGuides (>=2) take precedence over the base angle, so an Angle edit
    // would be a dead control — the stepper must not be offered.
    useProjectStore.getState().updateObject(ids[0], {
      params: {
        ...useProjectStore.getState().project.objects.find((o) => o.id === ids[0])!.params,
        angleGuides: [
          [0, 0, 0],
          [10, 10, 90],
        ],
      },
    });
    startReview(ids, 0);
    render(<ReviewBar />);
    openRefine();
    expect(screen.queryByRole("button", { name: "Increase angle" })).toBeNull();
    // Density is still offered — only the angle control is direction-driven.
    expect(screen.getByRole("button", { name: "Increase density" })).toBeTruthy();
  });

  it("the Outline toggle survives a retype while its outline exists — never orphaned", () => {
    const ids = seed(1);
    startReview(ids, 0);
    render(<ReviewBar />);
    openRefine();
    // Insert an outline for the fill region, then retype the region away from
    // fill. The checkbox must stay offered so the inserted outline remains
    // removable — hiding it would orphan the outline objects.
    fireEvent.click(screen.getByRole("checkbox", { name: "Satin outline" }));
    const before = useProjectStore.getState().project.objects.length;
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    const box = screen.getByRole("checkbox", { name: "Satin outline" });
    expect(box).toBeTruthy();
    fireEvent.click(box); // and removing it still works post-retype
    expect(useProjectStore.getState().project.objects.length).toBe(before - 1);
  });

  it("the Refine button itself survives a retype while an outline exists", () => {
    const ids = seed(1);
    startReview(ids, 0);
    render(<ReviewBar />);
    openRefine();
    fireEvent.click(screen.getByRole("checkbox", { name: "Satin outline" }));
    // Collapse refine, then retype away from fill: the Refine toggle must stay
    // offered so the row can be reopened to remove the inserted outline.
    fireEvent.click(screen.getByRole("button", { name: "Refine stitches" }));
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    const refine = screen.getByRole("button", { name: "Refine stitches" });
    fireEvent.click(refine);
    expect(screen.getByRole("checkbox", { name: "Satin outline" })).toBeTruthy();
  });

  it("an explicit retype clears any style override — no stale styling of converted geometry", () => {
    const ids = seed(1);
    startReview(ids, 0);
    render(<ReviewBar />);
    openRefine();
    // Override the fill region's style, then retype it via the Stitch Type
    // switch. convertObjectType converts the GEOMETRY, so the override and its
    // captured original are stale: without clearing them, the style select
    // stayed visible and a later pick ran styleObject on non-fill geometry.
    const select = screen.getByLabelText("Region stitch style") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "fur" } });
    expect(objById(ids[0]).params.fillStyle).toBe("fur");
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    const o = objById(ids[0]);
    expect(o.type).toBe("running"); // convertObjectType's output stands
    // The override is gone: the region reads as Auto, and for a non-fill type
    // the style select is not offered at all (the safe state).
    expect(screen.queryByLabelText("Region stitch style")).toBeNull();
  });

  it("angle and density steppers edit only the current region's params", () => {
    const ids = seed(2);
    startReview(ids, 0);
    render(<ReviewBar />);
    openRefine();
    fireEvent.click(screen.getByRole("button", { name: "Increase angle" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase density" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase density" }));
    expect(objById(ids[0]).params.angle).toBe(5);
    expect(objById(ids[0]).params.density).toBeCloseTo(0.4, 5);
    expect(objById(ids[1]).params).toEqual({});
    // Density floors at 0.1 — the stepper can never reach a machine-melting 0.
    for (let i = 0; i < 12; i++)
      fireEvent.click(screen.getByRole("button", { name: "Decrease density" }));
    expect(objById(ids[0]).params.density).toBeCloseTo(0.1, 5);
  });

  it("outline on inserts a satin outline right after the region (own thread); off removes it", () => {
    const ids = seed(2);
    startReview(ids, 0);
    render(<ReviewBar />);
    openRefine();
    const box = screen.getByRole("checkbox", { name: "Satin outline" }) as HTMLInputElement;
    fireEvent.click(box);
    let objects = useProjectStore.getState().project.objects;
    expect(objects).toHaveLength(3);
    const outline = objects[1]; // inserted immediately after region 1
    expect(outline.type).toBe("satin");
    expect(outline.colorId).toBe(objById(ids[0]).colorId); // no new thread
    // The review frame stays on the region, not the freshly inserted outline.
    expect(useProjectStore.getState().selectedIds).toEqual([ids[0]]);
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    objects = useProjectStore.getState().project.objects;
    expect(objects).toHaveLength(2);
    expect(objects.map((o) => o.id)).toEqual(ids);
  });

  it("a single-region tweak leaves every OTHER region's stitches byte-identical", () => {
    const ids = seed(3);
    // Distinct geometry per region so the guard isn't comparing twins.
    useProjectStore.setState((s) => ({
      project: {
        ...s.project,
        objects: s.project.objects.map((o, i) => ({
          ...o,
          paths: [o.paths[0].map((p) => ({ x: p.x + i * 14, y: p.y + i * 3 }))],
        })),
      },
    }));
    const stitchesOf = (id: string) => JSON.stringify(generateObjectStitches(objById(id)));
    const before = [stitchesOf(ids[1]), stitchesOf(ids[2])];
    const rawBefore = [JSON.stringify(objById(ids[1])), JSON.stringify(objById(ids[2]))];

    startReview(ids, 0);
    render(<ReviewBar />);
    openRefine();
    // Hit every refine lever on region 1: style, angle, density, outline.
    fireEvent.change(screen.getByLabelText("Region stitch style"), { target: { value: "sketch" } });
    fireEvent.click(screen.getByRole("button", { name: "Increase angle" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease density" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Satin outline" }));
    // Region 1 really changed…
    expect(objById(ids[0]).params.fillStyle).toBe("sketch");
    // …and regions 2 and 3 are untouched — object data AND generated stitches.
    expect(JSON.stringify(objById(ids[1]))).toBe(rawBefore[0]);
    expect(JSON.stringify(objById(ids[2]))).toBe(rawBefore[1]);
    expect(stitchesOf(ids[1])).toBe(before[0]);
    expect(stitchesOf(ids[2])).toBe(before[1]);
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
