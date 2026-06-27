// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ContextMenu from "./ContextMenu";
import { clampMenu } from "./contextMenuLayout";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { resetStores } from "../test/setup";
import { makeObject } from "../lib/objects";
import { createEmptyProject } from "../lib/project";

function seed(selectCount = 1) {
  const project = createEmptyProject();
  const cId = project.colors[0].id;
  const a = makeObject("running", [{ x: 0, y: 0 }, { x: 5, y: 0 }], cId);
  const b = makeObject("running", [{ x: 0, y: 5 }, { x: 5, y: 5 }], cId);
  project.objects = [a, b];
  resetStores(project);
  useProjectStore.setState({ selectedIds: [a, b].slice(0, selectCount).map((o) => o.id) });
  return { a, b };
}

describe("ContextMenu", () => {
  beforeEach(() => cleanup());

  it("deletes the selection and closes", () => {
    seed(1);
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(useProjectStore.getState().project.objects).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("duplicates the selection", () => {
    seed(1);
    render(<ContextMenu x={10} y={10} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /Duplicate/ }));
    expect(useProjectStore.getState().project.objects).toHaveLength(3);
  });

  it("disables Group for a single selection and Paste with an empty clipboard", () => {
    seed(1);
    useEditorStore.setState({ clipboard: [] });
    render(<ContextMenu x={10} y={10} onClose={vi.fn()} />);
    expect((screen.getByRole("menuitem", { name: /Group/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("menuitem", { name: /Paste/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Group when two objects are selected", () => {
    seed(2);
    render(<ContextMenu x={10} y={10} onClose={vi.fn()} />);
    expect((screen.getByRole("menuitem", { name: /Group/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("clampMenu (on-screen guarantee)", () => {
  const ITEMS = 20; // the full action list

  it("places the menu at the touch point when it fits", () => {
    const { left, top } = clampMenu(120, 80, ITEMS, 1024, 768, false);
    expect(left).toBe(120);
    expect(top).toBe(80);
  });

  it("pulls a right/bottom-edge press back so the whole menu stays on-screen", () => {
    const { left, top, maxHeight } = clampMenu(1000, 740, ITEMS, 1024, 768, false);
    expect(left + 208).toBeLessThanOrEqual(1024); // full width fits
    expect(top + Math.min(maxHeight, ITEMS * 30 + 16)).toBeLessThanOrEqual(768);
  });

  it("never positions off the top-left edge", () => {
    const { left, top } = clampMenu(-50, -50, ITEMS, 1024, 768, false);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it("keeps the tall touch menu fully on a small phone and caps its height to the viewport", () => {
    // Pixel-7-ish portrait; coarse pointer ⇒ finger-sized rows make the menu
    // taller than the screen, so it must clamp to the top and scroll.
    const vh = 800;
    const { top, maxHeight } = clampMenu(200, 600, ITEMS, 412, vh, true);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(maxHeight).toBeLessThanOrEqual(vh - 16);
    expect(top + maxHeight).toBeLessThanOrEqual(vh); // bottom never runs off-screen
  });
});
