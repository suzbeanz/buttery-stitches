import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";
import { isCoarsePointer } from "../lib/transform";

// Captured at import time, before any test mutates the store — this IS the
// value the initializer computed.
const initialAspectLocked = useEditorStore.getState().aspectLocked;

describe("editorStore panels", () => {
  beforeEach(() => {
    useEditorStore.setState({ layersOpen: true, propertiesOpen: true });
  });

  it("defaults both side panels open", () => {
    expect(useEditorStore.getState().layersOpen).toBe(true);
    expect(useEditorStore.getState().propertiesOpen).toBe(true);
  });

  it("toggles each panel independently", () => {
    useEditorStore.getState().toggleLayers();
    expect(useEditorStore.getState().layersOpen).toBe(false);
    expect(useEditorStore.getState().propertiesOpen).toBe(true);

    useEditorStore.getState().toggleProperties();
    expect(useEditorStore.getState().propertiesOpen).toBe(false);
  });

  it("sets panel visibility explicitly", () => {
    useEditorStore.getState().setLayersOpen(false);
    useEditorStore.getState().setPropertiesOpen(false);
    expect(useEditorStore.getState().layersOpen).toBe(false);
    expect(useEditorStore.getState().propertiesOpen).toBe(false);
  });
});

describe("editorStore region review", () => {
  beforeEach(() => {
    useEditorStore.setState({
      reviewIds: null,
      reviewIndex: 0,
      viewMode: "stitch",
      tool: "running",
    });
  });

  it("startReview sets the walk order, resets the cursor, and forces edit/select", () => {
    useEditorStore.getState().startReview(["a", "b", "c"]);
    const s = useEditorStore.getState();
    expect(s.reviewIds).toEqual(["a", "b", "c"]);
    expect(s.reviewIndex).toBe(0);
    expect(s.viewMode).toBe("edit");
    expect(s.tool).toBe("select");
  });

  it("startReview([]) is a no-op", () => {
    useEditorStore.getState().startReview([]);
    expect(useEditorStore.getState().reviewIds).toBeNull();
    // Did not yank the user out of stitch view for an empty trace.
    expect(useEditorStore.getState().viewMode).toBe("stitch");
  });

  it("next/prev clamp at the ends (no wrap, no overflow)", () => {
    useEditorStore.getState().startReview(["a", "b"]);
    const { reviewPrev, reviewNext } = useEditorStore.getState();
    reviewPrev();
    expect(useEditorStore.getState().reviewIndex).toBe(0); // clamps at start
    reviewNext();
    expect(useEditorStore.getState().reviewIndex).toBe(1);
    reviewNext();
    expect(useEditorStore.getState().reviewIndex).toBe(1); // clamps at end
  });

  it("reviewGoto clamps out-of-range indices", () => {
    useEditorStore.getState().startReview(["a", "b", "c"]);
    useEditorStore.getState().reviewGoto(99);
    expect(useEditorStore.getState().reviewIndex).toBe(2);
    useEditorStore.getState().reviewGoto(-5);
    expect(useEditorStore.getState().reviewIndex).toBe(0);
  });

  it("endReview clears the review slice", () => {
    useEditorStore.getState().startReview(["a", "b"]);
    useEditorStore.getState().reviewNext();
    useEditorStore.getState().endReview();
    expect(useEditorStore.getState().reviewIds).toBeNull();
    expect(useEditorStore.getState().reviewIndex).toBe(0);
  });

  it("startReview while reviewing replaces ids and resets the cursor", () => {
    useEditorStore.getState().startReview(["a", "b", "c"]);
    useEditorStore.getState().reviewNext();
    useEditorStore.getState().startReview(["x", "y"]);
    const s = useEditorStore.getState();
    expect(s.reviewIds).toEqual(["x", "y"]);
    expect(s.reviewIndex).toBe(0);
  });
});

describe("editorStore aspect lock", () => {
  beforeEach(() => {
    useEditorStore.setState({ aspectLocked: false });
  });

  it("defaults FREE outside a touch environment (no matchMedia here)", () => {
    // The initial value comes from isCoarsePointer(); this env has no coarse
    // pointer, so the default must be FREE — desktop muscle memory (free
    // corner resize) is preserved. Both asserted exactly so a regression in
    // either the env assumption or the default itself fails loudly.
    expect(isCoarsePointer()).toBe(false);
    expect(initialAspectLocked).toBe(false);
  });

  it("toggles and sets explicitly", () => {
    useEditorStore.getState().toggleAspectLock();
    expect(useEditorStore.getState().aspectLocked).toBe(true);
    useEditorStore.getState().toggleAspectLock();
    expect(useEditorStore.getState().aspectLocked).toBe(false);
    useEditorStore.getState().setAspectLocked(true);
    expect(useEditorStore.getState().aspectLocked).toBe(true);
  });
});

describe("editorStore adoptCoarsePointer (first-touch upgrade)", () => {
  beforeEach(() => {
    useEditorStore.setState({
      aspectLocked: false,
      aspectLockedExplicit: false,
      coarsePointer: false,
    });
  });

  it("a first real touch flips the device to coarse AND locks aspect", () => {
    // The shipped DDG/iPhone failure: media queries misreported at startup, so
    // the store booted with desktop defaults on a touch device.
    useEditorStore.getState().adoptCoarsePointer();
    const s = useEditorStore.getState();
    expect(s.coarsePointer).toBe(true);
    expect(s.aspectLocked).toBe(true);
  });

  it("never overrides a lock state the user chose explicitly", () => {
    useEditorStore.getState().toggleAspectLock(); // user: lock ON
    useEditorStore.getState().toggleAspectLock(); // user: lock OFF (explicit)
    useEditorStore.getState().adoptCoarsePointer();
    const s = useEditorStore.getState();
    expect(s.coarsePointer).toBe(true);
    expect(s.aspectLocked).toBe(false); // user's choice stands
  });

  it("is idempotent once coarse", () => {
    useEditorStore.getState().adoptCoarsePointer();
    useEditorStore.getState().setAspectLocked(false); // later user choice
    useEditorStore.getState().adoptCoarsePointer(); // e.g. every touchstart
    expect(useEditorStore.getState().aspectLocked).toBe(false);
    expect(useEditorStore.getState().coarsePointer).toBe(true);
  });
});
