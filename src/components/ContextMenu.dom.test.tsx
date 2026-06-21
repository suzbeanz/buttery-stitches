// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ContextMenu from "./ContextMenu";
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
