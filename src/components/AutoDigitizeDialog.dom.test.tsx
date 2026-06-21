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
}));
// Keep fixStitches an identity so onApply gets exactly the filtered subset.
vi.mock("../lib/fix", () => ({ fixStitches: vi.fn((p: Project) => p) }));

import AutoDigitizeDialog from "./AutoDigitizeDialog";

const HOOP = { wMm: 100, hMm: 100, name: "4×4" };

function renderDialog(onApply = vi.fn()) {
  const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
  render(<AutoDigitizeDialog file={file} hoop={HOOP} onApply={onApply} onClose={vi.fn()} />);
  return onApply;
}

describe("AutoDigitizeDialog color picking", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // jsdom lacks object URLs.
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  async function digitizeToReview() {
    fireEvent.click(await screen.findByRole("button", { name: "Digitize" }));
    // Wait for the review step (the 30ms yield + trace).
    await screen.findByRole("button", { name: /Add to design/ });
  }

  it("shows a swatch per detected color with region counts and a preview", async () => {
    renderDialog();
    await digitizeToReview();
    expect(screen.getByRole("button", { name: /Red/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Green/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blue/ })).toBeTruthy();
    // One region each.
    expect(screen.getAllByText("1 region")).toHaveLength(3);
    // Preview renders one <path> per kept object.
    expect(document.querySelectorAll("svg path")).toHaveLength(3);
  });

  it("dropping a color removes it from the preview and the applied project", async () => {
    const onApply = renderDialog();
    await digitizeToReview();

    fireEvent.click(screen.getByRole("button", { name: /Red/ })); // skip Red
    await waitFor(() => expect(document.querySelectorAll("svg path")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const project = onApply.mock.calls[0][0] as Project;
    expect(project.colors.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(project.objects.every((o) => o.colorId !== "c1")).toBe(true);
    expect(project.objects).toHaveLength(2);
  });

  it("disables Add to design when every color is dropped", async () => {
    renderDialog();
    await digitizeToReview();
    for (const name of [/Red/, /Green/, /Blue/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    const add = screen.getByRole("button", { name: /Add to design/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });

  it("Back returns to the options step without applying", async () => {
    const onApply = renderDialog();
    await digitizeToReview();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Digitize" })).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });
});
