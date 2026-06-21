import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";

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
