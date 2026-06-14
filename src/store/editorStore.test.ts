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
