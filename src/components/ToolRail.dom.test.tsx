// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ToolRail from "./ToolRail";
import { useEditorStore } from "../store/editorStore";
import { resetStores } from "../test/setup";

describe("ToolRail", () => {
  beforeEach(() => {
    cleanup();
    resetStores();
  });

  it("switches the active tool", () => {
    render(<ToolRail />);
    fireEvent.click(screen.getByRole("button", { name: "Points" }));
    expect(useEditorStore.getState().tool).toBe("node");
    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    expect(useEditorStore.getState().tool).toBe("fill");
  });

  it("toggles ruler units", () => {
    render(<ToolRail />);
    fireEvent.click(screen.getByRole("button", { name: "in" }));
    expect(useEditorStore.getState().rulerUnit).toBe("inch");
    fireEvent.click(screen.getByRole("button", { name: "mm" }));
    expect(useEditorStore.getState().rulerUnit).toBe("mm");
  });

  it("toggles curve (smooth) mode", () => {
    useEditorStore.setState({ smooth: false });
    render(<ToolRail />);
    const curve = screen.getByRole("button", { name: "Curve" });
    expect(curve.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(curve);
    expect(useEditorStore.getState().smooth).toBe(true);
    expect(curve.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the Add-words flow from the Make group", () => {
    render(<ToolRail />);
    fireEvent.click(screen.getByRole("button", { name: "Words" }));
    expect(useEditorStore.getState().pendingStart).toBe("text");
  });

  it("toggles snap and guides", () => {
    useEditorStore.setState({ snapEnabled: true, guidesEnabled: true });
    render(<ToolRail />);
    fireEvent.click(screen.getByRole("button", { name: "Snap" }));
    expect(useEditorStore.getState().snapEnabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(useEditorStore.getState().guidesEnabled).toBe(false);
  });
});
