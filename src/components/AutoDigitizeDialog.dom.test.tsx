// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { Project } from "../types/project";

// A square fill object of the given color id.
const obj = (id: string, colorId: string, x: number) => ({
  id,
  name: id,
  type: "fill" as const,
  colorId,
  paths: [[{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 10 }, { x, y: 10 }]],
  params: {},
  visible: true,
});

const COLORS = [
  { id: "c1", rgb: [233, 68, 53] as [number, number, number], name: "Red" },
  { id: "c2", rgb: [53, 168, 84] as [number, number, number], name: "Green" },
  { id: "c3", rgb: [66, 133, 244] as [number, number, number], name: "Blue" },
];
const OBJECTS = [obj("o1", "c1", 0), obj("o2", "c2", 20), obj("o3", "c3", 40)];

vi.mock("../lib/image", () => ({
  loadImageData: vi.fn(async () => ({ width: 10, height: 10, data: new Uint8ClampedArray(400) })),
}));
vi.mock("../lib/trace", () => ({
  imageDataToObjects: vi.fn(() => ({ colors: COLORS, objects: OBJECTS })),
  estimateColorComplexity: vi.fn(() => 0),
  suggestColorCount: vi.fn(() => 4),
}));
// Keep fixStitches an identity so onApply gets exactly the filtered subset.
vi.mock("../lib/fix", () => ({ fixStitches: vi.fn((p: Project) => p) }));

import AutoDigitizeDialog from "./AutoDigitizeDialog";
import { imageDataToObjects } from "../lib/trace";

const HOOP = { wMm: 100, hMm: 100, name: "4×4" };

function renderDialog(onApply = vi.fn()) {
  const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
  render(<AutoDigitizeDialog file={file} hoop={HOOP} onApply={onApply} onClose={vi.fn()} />);
  return onApply;
}

// The first trace runs after the image loads + the debounce; wait for the swatches.
async function waitForColors() {
  await screen.findByRole("button", { name: /Red/ }, { timeout: 2000 });
  await waitFor(() => expect(document.querySelectorAll("svg[data-preview] path")).toHaveLength(3));
}

describe("AutoDigitizeDialog (live preview)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // jsdom lacks object URLs.
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("auto-traces and shows a swatch per color with region counts and a live preview", async () => {
    renderDialog();
    await waitForColors();
    expect(screen.getByRole("button", { name: /Red/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Green/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blue/ })).toBeTruthy();
    expect(screen.getAllByText("1 region")).toHaveLength(3);
    expect(document.querySelectorAll("svg[data-preview] path")).toHaveLength(3);
  });

  it("re-traces when the color count changes", async () => {
    renderDialog();
    await waitForColors();
    const before = vi.mocked(imageDataToObjects).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "More colors" }));
    await waitFor(() =>
      expect(vi.mocked(imageDataToObjects).mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("toggling a color updates the preview WITHOUT re-tracing", async () => {
    renderDialog();
    await waitForColors();
    const before = vi.mocked(imageDataToObjects).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Red/ })); // skip Red
    await waitFor(() => expect(document.querySelectorAll("svg[data-preview] path")).toHaveLength(2));
    expect(vi.mocked(imageDataToObjects).mock.calls.length).toBe(before); // pure filter
  });

  it("applies only the kept colors", async () => {
    const onApply = renderDialog();
    await waitForColors();
    fireEvent.click(screen.getByRole("button", { name: /Red/ })); // skip Red
    await waitFor(() => expect(document.querySelectorAll("svg[data-preview] path")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const project = onApply.mock.calls[0][0] as Project;
    expect(project.colors.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(project.objects.every((o) => o.colorId !== "c1")).toBe(true);
    expect(project.objects).toHaveLength(2);
  });

  it("disables Add to design when every color is dropped", async () => {
    renderDialog();
    await waitForColors();
    for (const name of [/Red/, /Green/, /Blue/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    const add = screen.getByRole("button", { name: /Add to design/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });
});
