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
// jsdom can't fetch the font — load a real .ttf from disk so the text-retype
// path actually places lettering (keeps the other tests' fonts.ts constants).
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

import AutoDigitizeDialog from "./AutoDigitizeDialog";
import { imageDataToObjects } from "../lib/trace";

const HOOP = { wMm: 100, hMm: 100, name: "4×4" };

function renderDialog(onApply = vi.fn()) {
  const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
  render(<AutoDigitizeDialog file={file} hoop={HOOP} onApply={onApply} onClose={vi.fn()} />);
  return onApply;
}

// The first trace runs after the image loads + the debounce; wait for the swatches.
/** The canvas preview renders the real engine output; it exposes the kept-object
 *  count as a data attribute so the (canvas-less) jsdom tests can assert on it. */
function previewCount(): string | null {
  return document.querySelector("[data-preview]")?.getAttribute("data-preview-objects") ?? null;
}

async function waitForColors() {
  await screen.findByRole("button", { name: /Red/ }, { timeout: 2000 });
  await waitFor(() => expect(previewCount()).toBe("3"));
}

describe("AutoDigitizeDialog (live preview)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Re-establish the default trace result (clearAllMocks keeps any per-test
    // mockReturnValue override otherwise, leaking into later tests).
    vi.mocked(imageDataToObjects).mockReturnValue({ colors: COLORS, objects: OBJECTS });
    // jsdom lacks object URLs.
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    // jsdom throws on canvas getContext; the preview guards on a null context, so
    // stub it to null (the kept-object count is asserted via the data attribute).
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  });

  it("auto-traces and shows a swatch per color with region counts and a live preview", async () => {
    renderDialog();
    await waitForColors();
    expect(screen.getByRole("button", { name: /Red/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Green/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blue/ })).toBeTruthy();
    expect(screen.getAllByText("1 region")).toHaveLength(3);
    expect(previewCount()).toBe("3");
  });

  it("consolidates TRUE near-duplicate colors, but never trims below the colour budget", async () => {
    // A flat red split by k-means into two nearly identical reds (ΔE < 10 — a
    // true duplicate, folds at any budget) plus a distinct blue AND a genuinely
    // darker red feature. The near-dup folds; the dark red is a real feature
    // within the user's requested count and must SURVIVE — the old unbounded
    // fringe rule collapsed a 7-colour trace to three and ate a beacon dome.
    const sliver = {
      ...obj("od", "c4", 60),
      paths: [[{ x: 60, y: 0 }, { x: 62, y: 0 }, { x: 62, y: 2 }, { x: 60, y: 2 }]],
    };
    vi.mocked(imageDataToObjects).mockReturnValue({
      colors: [
        { id: "c1", rgb: [218, 29, 34], name: "Red" },
        { id: "c2", rgb: [212, 27, 31], name: "Red dup" },
        { id: "c4", rgb: [152, 17, 20], name: "Dark red" },
        { id: "c3", rgb: [30, 40, 220], name: "Blue" },
      ],
      objects: [obj("o1", "c1", 0), obj("o2", "c2", 20), sliver, obj("o3", "c3", 40)],
    });
    const onApply = renderDialog();
    await screen.findByRole("button", { name: /^Red/ }, { timeout: 2000 });
    // The near-duplicate red folded…
    await waitFor(() => expect(screen.queryByRole("button", { name: /Red dup/ })).toBeNull());
    // …but the real dark-red feature and the blue survive.
    expect(screen.getByRole("button", { name: /Dark red/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blue/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    const project = onApply.mock.calls[0][0] as Project;
    expect(project.colors).toHaveLength(3);
    const ids = new Set(project.colors.map((c) => c.id));
    for (const o of project.objects) expect(ids.has(o.colorId)).toBe(true);
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

  it("re-traces when the detail level changes", async () => {
    renderDialog();
    await waitForColors();
    const before = vi.mocked(imageDataToObjects).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Detailed" }));
    await waitFor(() =>
      expect(vi.mocked(imageDataToObjects).mock.calls.length).toBeGreaterThan(before),
    );
    // the detail choice reaches the tracer
    const lastOpts = vi.mocked(imageDataToObjects).mock.calls.at(-1)?.[2];
    expect(lastOpts?.detail).toBe("detailed");
  });

  it("toggling a color updates the preview WITHOUT re-tracing", async () => {
    renderDialog();
    await waitForColors();
    const before = vi.mocked(imageDataToObjects).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Red/ })); // skip Red
    await waitFor(() => expect(previewCount()).toBe("2"));
    expect(vi.mocked(imageDataToObjects).mock.calls.length).toBe(before); // pure filter
  });

  it("text-retype: detects a text cluster, and typing swaps it for authored lettering", async () => {
    // A row of six small same-colour glyph blocks — a word the trace can't set
    // cleanly. The dialog should spot it and offer a text box.
    const glyph = (id: string, x: number) => ({
      id,
      name: id,
      type: "fill" as const,
      colorId: "c1",
      paths: [[{ x, y: 0 }, { x: x + 3, y: 0 }, { x: x + 3, y: 4 }, { x, y: 4 }]],
      params: {},
      visible: true,
    });
    const wordObjs = Array.from({ length: 6 }, (_, i) => glyph(`g${i}`, 10 + i * 4.5));
    vi.mocked(imageDataToObjects).mockReturnValue({
      colors: [{ id: "c1", rgb: [20, 20, 20], name: "Black" }],
      objects: wordObjs,
    });
    const onApply = renderDialog();
    // The "Text found" panel appears once the trace + detection run.
    const box = (await screen.findByPlaceholderText(/Text area 1/, {}, { timeout: 2000 })) as HTMLInputElement;
    // Type the word; the traced glyphs are replaced by ONE authored lettering
    // object (fewer objects, and none of the original glyph ids remain).
    fireEvent.change(box, { target: { value: "HELLO" } });
    await waitFor(() => expect(previewCount()).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    const project = onApply.mock.calls[0][0] as Project;
    expect(project.objects).toHaveLength(1);
    expect(project.objects.some((o) => o.id.startsWith("g"))).toBe(false); // rough glyphs gone
    expect(project.objects[0].paths.length).toBeGreaterThan(0); // real lettering geometry
  });

  it("applies only the kept colors", async () => {
    const onApply = renderDialog();
    await waitForColors();
    fireEvent.click(screen.getByRole("button", { name: /Red/ })); // skip Red
    await waitFor(() => expect(previewCount()).toBe("2"));
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const project = onApply.mock.calls[0][0] as Project;
    expect(project.colors.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(project.objects.every((o) => o.colorId !== "c1")).toBe(true);
    expect(project.objects).toHaveLength(2);
  });

  it("recolors a traced shade, and the new rgb flows into the applied design", async () => {
    const onApply = renderDialog();
    await waitForColors();
    const recolor = screen.getByLabelText(/Recolor Red/) as HTMLInputElement;
    fireEvent.input(recolor, { target: { value: "#112233" } });
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    const project = onApply.mock.calls[0][0] as Project;
    const red = project.colors.find((c) => c.id === "c1");
    expect(red?.rgb).toEqual([0x11, 0x22, 0x33]);
  });

  it("renames a traced color, and the name flows into the applied design", async () => {
    const onApply = renderDialog();
    await waitForColors();
    const rename = screen.getByLabelText(/Rename Red/) as HTMLInputElement;
    fireEvent.change(rename, { target: { value: "Crimson" } });
    fireEvent.blur(rename);
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    const project = onApply.mock.calls[0][0] as Project;
    expect(project.colors.find((c) => c.id === "c1")?.name).toBe("Crimson");
  });

  it("merges similar shades, reducing the palette with no orphan colorIds", async () => {
    const onApply = renderDialog();
    await waitForColors();
    // Recolor Green to near-Red so the two are within the merge threshold.
    fireEvent.input(screen.getByLabelText(/Recolor Green/) as HTMLInputElement, {
      target: { value: "#e74637" }, // ≈ rgb(231,70,55), within ΔE of Red
    });
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Merge similar shades/ }));
    await waitFor(() =>
      expect(screen.queryAllByRole("button", { name: /tap to (keep|skip)/ }).length).toBe(2),
    );
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    const project = onApply.mock.calls[0][0] as Project;
    expect(project.colors.length).toBe(2);
    const ids = new Set(project.colors.map((c) => c.id));
    expect(project.objects.every((o) => ids.has(o.colorId))).toBe(true);
  });

  it("matches the palette to real threads, stamping brand + code on the applied colors", async () => {
    const onApply = renderDialog();
    await waitForColors();
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Match to thread colors/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    const project = onApply.mock.calls[0][0] as Project;
    expect(project.colors.every((c) => c.brand && c.code)).toBe(true);
  });

  it("applies a per-color stitch style: Outline → running, Satin → satin fill", async () => {
    const onApply = renderDialog();
    await waitForColors();
    // Per-color stitch style lives under Advanced options.
    expect(screen.queryByLabelText(/Stitch style for Red/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.change(screen.getByLabelText(/Stitch style for Red/) as HTMLSelectElement, {
      target: { value: "outline" },
    });
    fireEvent.change(screen.getByLabelText(/Stitch style for Green/) as HTMLSelectElement, {
      target: { value: "satin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add to design/ }));
    const project = onApply.mock.calls[0][0] as Project;
    const red = project.objects.find((o) => o.colorId === "c1");
    const green = project.objects.find((o) => o.colorId === "c2");
    expect(red?.type).toBe("running");
    expect(green?.type).toBe("fill");
    expect(green?.params.fillStyle).toBe("satin");
  });

  it("keeps the first view calm — power tools hidden until Advanced is opened", async () => {
    renderDialog();
    await waitForColors();
    // Basics are grouped; power tools (merge/match, per-color style) start hidden.
    expect(screen.getByText("Basics")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Merge similar shades/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Match to thread colors/ })).toBeNull();
    expect(screen.queryByLabelText(/Stitch style for Red/)).toBeNull();
    // Opening Advanced reveals them.
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    expect(screen.getByRole("button", { name: /Match to thread colors/ })).toBeTruthy();
    expect(screen.getByLabelText(/Stitch style for Red/)).toBeTruthy();
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
