// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DesignPanel from "./DesignPanel";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { resetStores } from "../test/setup";
import { makeObjectFromPaths } from "../lib/objects";
import { createEmptyProject } from "../lib/project";
import { designSize, designBounds } from "../lib/layout";

function seedSquare() {
  const p = createEmptyProject();
  const o = makeObjectFromPaths(
    "fill",
    [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]],
    p.colors[0].id,
  );
  p.objects = [o];
  resetStores(p);
}

function widthInput() {
  return screen.getByText(/Width \(mm\)/).closest("label")!.querySelector("input")!;
}

describe("DesignPanel", () => {
  beforeEach(() => {
    cleanup();
    seedSquare();
  });

  it("resizes the design (committing on blur) and re-densifies geometry", () => {
    render(<DesignPanel />);
    const input = widthInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.blur(input);
    expect(designSize(useProjectStore.getState().project.objects).w).toBeCloseTo(40);
  });

  it("fits the design to the hoop and centers it", () => {
    render(<DesignPanel />);
    fireEvent.click(screen.getByText("Fit to hoop"));
    const { project } = useProjectStore.getState();
    const b = designBounds(project.objects)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(project.hoop.wMm / 2);
  });

  it("changes the hoop via preset", () => {
    render(<DesignPanel />);
    const select = screen.getByText("Hoop").closest("label")!.querySelector("select")!;
    fireEvent.change(select, { target: { value: "1" } }); // 5×7" (130×180)
    expect(useProjectStore.getState().project.hoop.wMm).toBeCloseTo(130);
    expect(useProjectStore.getState().project.hoop.hMm).toBeCloseTo(180);
  });

  it("clicking an object-specific warning selects it and drops into edit view", () => {
    // A satin column 9 mm apart is wider than the safe max → a warning that names
    // the object, so it renders as a button.
    const p = createEmptyProject();
    const wide = makeObjectFromPaths(
      "satin",
      [[{ x: 10, y: 10 }, { x: 40, y: 10 }], [{ x: 10, y: 19 }, { x: 40, y: 19 }]],
      p.colors[0].id,
      "Wide bar",
    );
    p.objects = [wide];
    resetStores(p);
    useEditorStore.getState().setViewMode("stitch");

    render(<DesignPanel />);
    fireEvent.click(screen.getByTitle("Select this object to fix it"));

    expect(useProjectStore.getState().selectedIds).toEqual([wide.id]);
    expect(useEditorStore.getState().viewMode).toBe("edit");
  });
});
