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
  detectLineArt: vi.fn(() => ({
    isLineArt: false,
    stats: {
      opaqueFraction: 1,
      inkFraction: 0,
      largestInkShare: 0,
      erosionSurvivor2: 1,
      meanInkLum: 255,
      enclosedFaces: 0,
      faceFlatness: 255,
    },
    suggestedColors: 4,
  })),
  livePaintObjects: vi.fn(() => ({ colors: COLORS, objects: OBJECTS })),
  furObjects: vi.fn(() => ({ colors: COLORS, objects: OBJECTS })),
  detectFurArt: vi.fn(() => ({
    isFurArt: false,
    stats: { opaqueFraction: 1, furMassCount: 0, ladderDeltaL: 0, maxFamilyHueDeg: 0 },
  })),
}));
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
import { imageDataToObjects, detectLineArt, detectFurArt, livePaintObjects, furObjects } from "../lib/trace";

const LINE_ART_YES = {
  isLineArt: true,
  stats: {
    opaqueFraction: 0.44,
    inkFraction: 0.23,
    largestInkShare: 0.83,
    erosionSurvivor2: 0.06,
    meanInkLum: 13,
    enclosedFaces: 14,
    faceFlatness: 3,
  },
  suggestedColors: 4,
};

const HOOP = { wMm: 100, hMm: 100, name: "4×4" };

function renderDialog(onApply = vi.fn()) {
  const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
  render(<AutoDigitizeDialog file={file} hoop={HOOP} onApply={onApply} onClose={vi.fn()} />);
  return onApply;
}

/** The canvas preview paints the flat artwork; it exposes the kept-object count
 *  as a data attribute so the (canvas-less) jsdom tests can assert on it. */
function previewCount(): string | null {
  return document.querySelector("[data-preview]")?.getAttribute("data-preview-objects") ?? null;
}
function wizardStep(): string | null {
  return document.querySelector("[data-wizard-step]")?.getAttribute("data-wizard-step") ?? null;
}

// The first trace runs after the image loads + the debounce; wait for it to
// land in the preview and for Next to unlock.
async function waitForTrace(count = "3") {
  await waitFor(() => expect(previewCount()).toBe(count), { timeout: 2000 });
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
  );
}
function clickNext() {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}
/** Step 0 → 1 (the color list). */
async function toColors(count = "3") {
  await waitForTrace(count);
  clickNext();
  await screen.findByText(/Colors found/);
}
/** Click Add artwork on the wizard's LAST step (Colors normally; Text when
 *  text-like clusters were found) and return the applied project — the apply
 *  is synchronous verbatim artwork, no stitch pass. */
async function addArtwork(onApply: ReturnType<typeof vi.fn>) {
  const btn = (await screen.findByRole("button", { name: /Add artwork/ })) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
  await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  return onApply.mock.calls[0][0] as Project;
}

describe("AutoDigitizeDialog (wizard)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Re-establish the default trace result (clearAllMocks keeps any per-test
    // mockReturnValue override otherwise, leaking into later tests).
    vi.mocked(imageDataToObjects).mockReturnValue({ colors: COLORS, objects: OBJECTS });
    vi.mocked(livePaintObjects).mockReturnValue({ colors: COLORS, objects: OBJECTS });
    vi.mocked(furObjects).mockReturnValue({ colors: COLORS, objects: OBJECTS });
    vi.mocked(detectLineArt).mockReturnValue({
      isLineArt: false,
      stats: { ...LINE_ART_YES.stats, inkFraction: 0, enclosedFaces: 0 },
      suggestedColors: 4,
    });
    vi.mocked(detectFurArt).mockReturnValue({
      isFurArt: false,
      stats: { opaqueFraction: 1, furMassCount: 0, ladderDeltaL: 0, maxFamilyHueDeg: 0 },
    });
    // jsdom lacks object URLs.
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    // jsdom throws on canvas getContext; the preview guards on a null context, so
    // stub it to null (the kept-object count is asserted via the data attribute).
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  });

  it("auto-traces on the Image step and shows a live preview; color chips wait on step 2", async () => {
    renderDialog();
    await waitForTrace();
    expect(wizardStep()).toBe("0");
    expect(screen.getByText("Basics")).toBeTruthy();
    // The color list is NOT on this step.
    expect(screen.queryByRole("button", { name: /Red/ })).toBeNull();
    clickNext();
    await screen.findByText(/Colors found/);
    expect(wizardStep()).toBe("1");
    expect(screen.getByRole("button", { name: /Red/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Green/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blue/ })).toBeTruthy();
    expect(screen.getAllByText("1 region")).toHaveLength(3);
    expect(previewCount()).toBe("3");
  });

  it("Colors is the final step when no text was found — its action is Add artwork", async () => {
    renderDialog();
    await toColors();
    // No Next on the last step; the primary action adds the artwork.
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByRole("button", { name: /Add artwork/ })).toBeTruthy();
    // The hand-off note explains editing happens in the studio, stitches later.
    expect(screen.getByText(/EDITABLE ARTWORK/)).toBeTruthy();
    // The skipped Text chip is visible but disabled.
    const text = screen.getByRole("button", { name: /Text/ }) as HTMLButtonElement;
    expect(text.disabled).toBe(true);
  });

  it("Back returns through the steps and choices survive navigation without a re-trace", async () => {
    renderDialog();
    await toColors();
    fireEvent.click(screen.getByRole("button", { name: /Red/ })); // skip Red
    await waitFor(() => expect(previewCount()).toBe("2"));
    const traces = vi.mocked(imageDataToObjects).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(wizardStep()).toBe("0");
    clickNext();
    await screen.findByText(/Colors found/);
    // The skip stuck, and navigating didn't re-trace.
    await waitFor(() => expect(previewCount()).toBe("2"));
    expect(vi.mocked(imageDataToObjects).mock.calls.length).toBe(traces);
  });

  it("visited step chips stay tappable; skipped ones don't", async () => {
    renderDialog();
    await toColors();
    // Jump straight back to Image via its chip.
    fireEvent.click(screen.getByRole("button", { name: /Image/ }));
    expect(wizardStep()).toBe("0");
    // No text clusters — the Text chip is disabled.
    const text = screen.getByRole("button", { name: /Text/ }) as HTMLButtonElement;
    expect(text.disabled).toBe(true);
    // Colors was visited — its chip jumps forward again.
    fireEvent.click(screen.getByRole("button", { name: /Colors/ }));
    expect(wizardStep()).toBe("1");
  });

  it("adds the traced artwork VERBATIM — no stitch pass touches the shapes", async () => {
    const onApply = renderDialog();
    await toColors();
    const project = await addArtwork(onApply);
    // Exactly the trace's colors and objects, untouched: same ids, same paths,
    // same params — the studio (Clean up · Stitch view) owns stitchification.
    expect(project.colors).toEqual(COLORS);
    expect(project.objects).toEqual(OBJECTS);
    expect(project.widthMm).toBe(HOOP.wMm);
    expect(project.heightMm).toBe(HOOP.hMm);
    expect(project.hoop).toEqual(HOOP);
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
    await toColors("4");
    // The near-duplicate red folded…
    await waitFor(() => expect(screen.queryByRole("button", { name: /Red dup/ })).toBeNull());
    // …but the real dark-red feature and the blue survive.
    expect(screen.getByRole("button", { name: /Dark red/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blue/ })).toBeTruthy();
    const project = await addArtwork(onApply);
    expect(project.colors).toHaveLength(3);
    const ids = new Set(project.colors.map((c) => c.id));
    for (const o of project.objects) expect(ids.has(o.colorId)).toBe(true);
  });

  it("re-traces when the color count changes", async () => {
    renderDialog();
    await waitForTrace();
    const before = vi.mocked(imageDataToObjects).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "More colors" }));
    await waitFor(() =>
      expect(vi.mocked(imageDataToObjects).mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("re-traces when the detail level changes", async () => {
    renderDialog();
    await waitForTrace();
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
    await toColors();
    const before = vi.mocked(imageDataToObjects).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Red/ })); // skip Red
    await waitFor(() => expect(previewCount()).toBe("2"));
    expect(vi.mocked(imageDataToObjects).mock.calls.length).toBe(before); // pure filter
  });

  it("text-retype: the Text step appears, and typing swaps the cluster for authored lettering", async () => {
    // A row of six small same-colour glyph blocks — a word the trace can't set
    // cleanly. The dialog should spot it and offer a text box on the Text step.
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
    await toColors("6");
    // Text clusters exist → Colors is NOT final; Next lands on the Text step.
    clickNext();
    const box = (await screen.findByPlaceholderText(/Text area 1/, {}, { timeout: 2000 })) as HTMLInputElement;
    expect(wizardStep()).toBe("2");
    // Type the word; the traced glyphs are replaced by ONE authored lettering
    // object (fewer objects, and none of the original glyph ids remain).
    fireEvent.change(box, { target: { value: "HELLO" } });
    await waitFor(() => expect(previewCount()).toBe("1"));
    const project = await addArtwork(onApply);
    expect(project.objects).toHaveLength(1);
    expect(project.objects.some((o) => o.id.startsWith("g"))).toBe(false); // rough glyphs gone
    expect(project.objects[0].paths.length).toBeGreaterThan(0); // real lettering geometry
  });

  it("applies only the kept colors", async () => {
    const onApply = renderDialog();
    await toColors();
    fireEvent.click(screen.getByRole("button", { name: /Red/ })); // skip Red
    await waitFor(() => expect(previewCount()).toBe("2"));
    const project = await addArtwork(onApply);
    expect(project.colors.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(project.objects.every((o) => o.colorId !== "c1")).toBe(true);
    expect(project.objects).toHaveLength(2);
  });

  it("recolors a traced shade, and the new rgb flows into the applied design", async () => {
    const onApply = renderDialog();
    await toColors();
    const recolor = screen.getByLabelText(/Recolor Red/) as HTMLInputElement;
    fireEvent.input(recolor, { target: { value: "#112233" } });
    const project = await addArtwork(onApply);
    const red = project.colors.find((c) => c.id === "c1");
    expect(red?.rgb).toEqual([0x11, 0x22, 0x33]);
  });

  it("renames a traced color, and the name flows into the applied design", async () => {
    const onApply = renderDialog();
    await toColors();
    const rename = screen.getByLabelText(/Rename Red/) as HTMLInputElement;
    fireEvent.change(rename, { target: { value: "Crimson" } });
    fireEvent.blur(rename);
    const project = await addArtwork(onApply);
    expect(project.colors.find((c) => c.id === "c1")?.name).toBe("Crimson");
  });

  it("merges similar shades, reducing the palette with no orphan colorIds", async () => {
    const onApply = renderDialog();
    await toColors();
    // Recolor Green to near-Red so the two are within the merge threshold.
    fireEvent.input(screen.getByLabelText(/Recolor Green/) as HTMLInputElement, {
      target: { value: "#e74637" }, // ≈ rgb(231,70,55), within ΔE of Red
    });
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Merge similar shades/ }));
    await waitFor(() =>
      expect(screen.queryAllByRole("button", { name: /tap to (keep|skip)/ }).length).toBe(2),
    );
    const project = await addArtwork(onApply);
    expect(project.colors.length).toBe(2);
    const ids = new Set(project.colors.map((c) => c.id));
    expect(project.objects.every((o) => ids.has(o.colorId))).toBe(true);
  });

  it("matches the palette to real threads, stamping brand + code on the applied colors", async () => {
    const onApply = renderDialog();
    await toColors();
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Match to thread colors/ }));
    const project = await addArtwork(onApply);
    expect(project.colors.every((c) => c.brand && c.code)).toBe(true);
  });

  it("applies a per-color stitch style: Outline → running, Satin → satin fill", async () => {
    const onApply = renderDialog();
    await toColors();
    // Per-color stitch style lives under Advanced options.
    expect(screen.queryByLabelText(/Stitch style for Red/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.change(screen.getByLabelText(/Stitch style for Red/) as HTMLSelectElement, {
      target: { value: "outline" },
    });
    fireEvent.change(screen.getByLabelText(/Stitch style for Green/) as HTMLSelectElement, {
      target: { value: "satin" },
    });
    const project = await addArtwork(onApply);
    const red = project.objects.find((o) => o.colorId === "c1");
    const green = project.objects.find((o) => o.colorId === "c2");
    expect(red?.type).toBe("running");
    expect(green?.type).toBe("fill");
    expect(green?.params.fillStyle).toBe("satin");
  });

  it("keeps the color list calm — power tools hidden until Advanced is opened", async () => {
    renderDialog();
    await toColors();
    expect(screen.queryByRole("button", { name: /Merge similar shades/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Match to thread colors/ })).toBeNull();
    expect(screen.queryByLabelText(/Stitch style for Red/)).toBeNull();
    // Opening Advanced reveals them.
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    expect(screen.getByRole("button", { name: /Match to thread colors/ })).toBeTruthy();
    expect(screen.getByLabelText(/Stitch style for Red/)).toBeTruthy();
  });

  it("disables Add artwork when every color is dropped", async () => {
    renderDialog();
    await toColors();
    for (const name of [/Red/, /Green/, /Blue/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    await waitFor(() => expect(previewCount()).toBe("0"));
    const add = screen.getByRole("button", { name: /Add artwork/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });

  it("offers a suspected-background ring as keep/skip (default skip), clearing the flag on keep", async () => {
    // The tracer can't tell a page halo from a deliberate rim, so it flags the
    // region instead of deleting it. The chip defaults to SKIP (junk is the
    // common case) but keeping it must be one tap — and an explicit keep clears
    // the flag so Check design never re-nags a decision the user already made.
    const ring = { ...obj("halo", "c1", 60), name: "Red ring (background?)", suspectedBackground: true };
    vi.mocked(imageDataToObjects).mockReturnValue({ colors: COLORS, objects: [...OBJECTS, ring] });
    const onApply = renderDialog();
    // Default: excluded from the live preview (3 of 4 objects) and from apply.
    await toColors("3");
    await screen.findByRole("button", { name: /Red ring \(background\?\)/ }, { timeout: 2000 });
    // Keep it → preview includes it.
    fireEvent.click(screen.getByRole("button", { name: /Red ring \(background\?\) — tap to keep/ }));
    await waitFor(() => expect(previewCount()).toBe("4"));
    const project = await addArtwork(onApply);
    const applied = project.objects.find((o) => o.name === "Red ring (background?)");
    expect(applied, "kept ring lands in the project").toBeDefined();
    expect(applied!.suspectedBackground, "explicit keep clears the flag").toBeUndefined();
  });

  it("skipping a suspected-background ring keeps it out of the applied project", async () => {
    const ring = { ...obj("halo", "c1", 60), name: "Red ring (background?)", suspectedBackground: true };
    vi.mocked(imageDataToObjects).mockReturnValue({ colors: COLORS, objects: [...OBJECTS, ring] });
    const onApply = renderDialog();
    await toColors("3");
    await screen.findByRole("button", { name: /Red ring \(background\?\)/ }, { timeout: 2000 });
    const project = await addArtwork(onApply);
    expect(project.objects.some((o) => o.name === "Red ring (background?)")).toBe(false);
    expect(project.objects).toHaveLength(3);
  });

  // ── Live-Paint (line art) method ─────────────────────────────────────────
  const LP_COLORS = [
    { id: "cw", rgb: [250, 250, 250] as [number, number, number], name: "White" },
    { id: "cb", rgb: [60, 180, 240] as [number, number, number], name: "Blue" },
    { id: "cink", rgb: [15, 15, 18] as [number, number, number], name: "Ink" },
  ];
  const LP_OBJECTS = [
    obj("f1", "cw", 0),
    obj("f2", "cb", 20),
    {
      ...obj("ink", "cink", 40),
      name: "Ink lines",
      params: { fillStyle: "satin" as const, lineArt: true },
    },
  ];

  it("auto-preselects Line art for detected outlined artwork and traces via livePaintObjects", async () => {
    vi.mocked(detectLineArt).mockReturnValue(LINE_ART_YES);
    vi.mocked(livePaintObjects).mockReturnValue({ colors: LP_COLORS, objects: LP_OBJECTS });
    renderDialog();
    await waitForTrace();
    const btn = screen.getByRole("button", { name: "Line art" }) as HTMLButtonElement;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/we picked this for you/)).toBeTruthy();
    expect(vi.mocked(livePaintObjects)).toHaveBeenCalled();
    expect(vi.mocked(imageDataToObjects)).not.toHaveBeenCalled();
  });

  it("switching back to Standard trace re-traces via imageDataToObjects", async () => {
    vi.mocked(detectLineArt).mockReturnValue(LINE_ART_YES);
    vi.mocked(livePaintObjects).mockReturnValue({ colors: LP_COLORS, objects: LP_OBJECTS });
    renderDialog();
    await waitForTrace();
    fireEvent.click(screen.getByRole("button", { name: "Standard trace" }));
    await waitFor(() => expect(vi.mocked(imageDataToObjects)).toHaveBeenCalled());
  });

  const FUR_ART_YES = {
    isFurArt: true,
    stats: { opaqueFraction: 0.6, furMassCount: 3, ladderDeltaL: 40, maxFamilyHueDeg: 5 },
  };

  it("auto-preselects Fur for detected soft-shaded art and traces via furObjects", async () => {
    vi.mocked(detectFurArt).mockReturnValue(FUR_ART_YES);
    renderDialog();
    await waitForTrace();
    const btn = screen.getByRole("button", { name: "Fur" }) as HTMLButtonElement;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/soft-shaded fur art, so we picked this/)).toBeTruthy();
    expect(vi.mocked(furObjects)).toHaveBeenCalled();
    expect(vi.mocked(imageDataToObjects)).not.toHaveBeenCalled();
  });

  it("Line art WINS when both detections fire (outlined shaded art is line art first)", async () => {
    vi.mocked(detectLineArt).mockReturnValue(LINE_ART_YES);
    vi.mocked(detectFurArt).mockReturnValue(FUR_ART_YES);
    vi.mocked(livePaintObjects).mockReturnValue({ colors: LP_COLORS, objects: LP_OBJECTS });
    renderDialog();
    await waitForTrace();
    const btn = screen.getByRole("button", { name: "Line art" }) as HTMLButtonElement;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(vi.mocked(furObjects)).not.toHaveBeenCalled();
  });

  it("the Deep shade-overlap preset re-traces with furOverlapMm 1.2", async () => {
    vi.mocked(detectFurArt).mockReturnValue(FUR_ART_YES);
    renderDialog();
    await waitForTrace();
    fireEvent.click(screen.getByRole("button", { name: "Deep" }));
    await waitFor(() => {
      const calls = vi.mocked(furObjects).mock.calls;
      expect(calls[calls.length - 1][2]).toMatchObject({ furOverlapMm: 1.2 });
    });
    // …and the default preset traces at the measured 0.9mm norm.
    expect(vi.mocked(furObjects).mock.calls[0][2]).toMatchObject({ furOverlapMm: 0.9 });
  });

  it("the per-color style select offers Fur and apply stamps fillStyle: 'fur'", async () => {
    const onApply = renderDialog();
    await toColors();
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.change(screen.getByLabelText(/Stitch style for Red/) as HTMLSelectElement, {
      target: { value: "fur" },
    });
    const project = await addArtwork(onApply);
    const red = project.objects.find((o) => o.colorId === "c1")!;
    expect(red.params.fillStyle).toBe("fur");
  });

  it("Sketch look maps big faces to open sketch fills; ink, text and small faces stay solid", async () => {
    vi.mocked(detectLineArt).mockReturnValue(LINE_ART_YES);
    // A big face (30×20mm = 600mm²), a tiny face (3×3mm = 9mm²), an ink-color
    // solid blob, and the ink line network. Only the big face may go sketch.
    const colors = [
      { id: "cw", rgb: [250, 250, 250] as [number, number, number], name: "White" },
      { id: "cink", rgb: [15, 15, 18] as [number, number, number], name: "Ink" },
    ];
    const bigFace = { ...obj("big", "cw", 0), paths: [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }]] };
    const tinyFace = { ...obj("tiny", "cw", 0), paths: [[{ x: 40, y: 0 }, { x: 43, y: 0 }, { x: 43, y: 3 }, { x: 40, y: 3 }]] };
    const inkSolid = { ...obj("solid", "cink", 50), name: "Ink solids", params: { fillStyle: "satin" as const } };
    const inkLines = { ...obj("ink", "cink", 60), name: "Ink lines", params: { fillStyle: "satin" as const, lineArt: true } };
    vi.mocked(livePaintObjects).mockReturnValue({ colors, objects: [bigFace, tinyFace, inkSolid, inkLines] });
    const onApply = renderDialog();
    await waitForTrace("4");
    // The Fill look toggle exists only for line art; flip it to Sketch.
    fireEvent.click(screen.getByRole("button", { name: "Sketch" }));
    await toColors("4");
    const project = await addArtwork(onApply);
    const byId = new Map(project.objects.map((o) => [o.id, o]));
    expect(byId.get("big")!.params.fillStyle).toBe("sketch");
    expect(byId.get("big")!.params.density).toBe(0.8);
    expect(byId.get("tiny")!.params.fillStyle).toBeUndefined(); // small detail stays solid
    expect(byId.get("solid")!.params.fillStyle).toBe("satin"); // ink thread untouched
    expect(byId.get("ink")!.params.lineArt).toBe(true);
  });

  it("a per-color style override beats the sketch look", async () => {
    vi.mocked(detectLineArt).mockReturnValue(LINE_ART_YES);
    const colors = [{ id: "cw", rgb: [250, 250, 250] as [number, number, number], name: "White" }];
    const bigFace = { ...obj("big", "cw", 0), paths: [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }]] };
    vi.mocked(livePaintObjects).mockReturnValue({ colors, objects: [bigFace] });
    const onApply = renderDialog();
    await waitForTrace("1");
    fireEvent.click(screen.getByRole("button", { name: "Sketch" }));
    await toColors("1");
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.change(screen.getByLabelText(/Stitch style for White/) as HTMLSelectElement, {
      target: { value: "satin" },
    });
    const project = await addArtwork(onApply);
    expect(project.objects[0].params.fillStyle).toBe("satin");
  });

  it("the Fill look toggle is absent for the standard trace method", async () => {
    renderDialog(); // default mocks: not line art
    await waitForTrace();
    expect(screen.queryByRole("button", { name: "Sketch" })).toBeNull();
  });

  it("Line art applies colors verbatim (no fringe consolidation) with the ink object last", async () => {
    vi.mocked(detectLineArt).mockReturnValue(LINE_ART_YES);
    // Two near-identical whites that consolidateFringeColors WOULD merge —
    // live paint must keep the palette exactly as the trace produced it.
    const colors = [
      { id: "cw", rgb: [250, 250, 250] as [number, number, number], name: "White" },
      { id: "cw2", rgb: [247, 247, 247] as [number, number, number], name: "White 2" },
      { id: "cink", rgb: [15, 15, 18] as [number, number, number], name: "Ink" },
    ];
    const objects = [
      obj("f1", "cw", 0),
      obj("f2", "cw2", 20),
      { ...obj("ink", "cink", 40), name: "Ink lines", params: { fillStyle: "satin" as const, lineArt: true } },
    ];
    vi.mocked(livePaintObjects).mockReturnValue({ colors, objects });
    const onApply = renderDialog();
    await toColors();
    const project = await addArtwork(onApply);
    expect(project.colors.map((c) => c.id)).toEqual(["cw", "cw2", "cink"]);
    const last = project.objects[project.objects.length - 1];
    expect(last.params.lineArt).toBe(true);
  });
});
