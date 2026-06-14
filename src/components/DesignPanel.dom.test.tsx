// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DesignPanel from "./DesignPanel";
import { useProjectStore } from "../store/projectStore";
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
    fireEvent.change(select, { target: { value: "1" } }); // 130×180
    expect(useProjectStore.getState().project.hoop.wMm).toBe(130);
  });
});
