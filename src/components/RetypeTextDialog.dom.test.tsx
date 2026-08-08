// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// jsdom can't fetch the font — load a real .ttf from disk (same pattern as
// the auto-digitize dialog tests).
vi.mock("../lib/text/fonts", async (importActual) => {
  const actual = await importActual<typeof import("../lib/text/fonts")>();
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const buf = readFileSync(join(here, "..", "lib", "text", "fonts", "Oswald-Medium.ttf"));
  const font = actual.parseFont(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  return { ...actual, loadFont: vi.fn(async () => font) };
});
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import RetypeTextDialog from "./RetypeTextDialog";
import { useProjectStore } from "../store/projectStore";
import { createEmptyProject } from "../lib/project";
import { makeObjectFromPaths } from "../lib/objects";
import type { Path } from "../types/project";

const sq = (x: number, y: number, w: number, h: number): Path => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

beforeEach(() => {
  const p = createEmptyProject();
  const a = makeObjectFromPaths("fill", [sq(10, 10, 4, 5)], p.colors[0].id, "A");
  const b = makeObjectFromPaths("fill", [sq(16, 10, 4, 5)], p.colors[0].id, "B");
  p.objects.push(a, b);
  useProjectStore.setState({ project: p, selectedIds: [a.id, b.id] });
  useProjectStore.temporal.getState().clear();
});
afterEach(cleanup);

describe("RetypeTextDialog", () => {
  it("replaces the selection with one authored text object (undoable)", async () => {
    render(<RetypeTextDialog onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/what do the traced letters say/i), {
      target: { value: "HI" },
    });
    // Wait for the font to load and the Replace button to arm.
    const btn = screen.getByRole("button", { name: /replace/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 });
    fireEvent.click(btn);
    const { project, selectedIds } = useProjectStore.getState();
    expect(project.objects).toHaveLength(1);
    expect(project.objects[0].name).toBe("HI");
    expect(project.objects[0].params.fillStyle).toBe("satin");
    expect(selectedIds).toEqual([project.objects[0].id]);
    // One undo restores the traced originals.
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().project.objects).toHaveLength(2);
  }, 15000);
});
