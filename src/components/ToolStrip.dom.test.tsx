// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ToolStrip from "./ToolStrip";
import { useEditorStore } from "../store/editorStore";
import { resetStores } from "../test/setup";

describe("ToolStrip", () => {
  beforeEach(() => {
    cleanup();
    resetStores();
  });

  it("switches the active tool", () => {
    render(<ToolStrip />);
    fireEvent.click(screen.getByText("Node"));
    expect(useEditorStore.getState().tool).toBe("node");
    fireEvent.click(screen.getByText("Fill"));
    expect(useEditorStore.getState().tool).toBe("fill");
  });

  it("toggles ruler units", () => {
    render(<ToolStrip />);
    fireEvent.click(screen.getByText("inch"));
    expect(useEditorStore.getState().rulerUnit).toBe("inch");
  });

  it("toggles curve (smooth) mode", () => {
    useEditorStore.setState({ smooth: false });
    render(<ToolStrip />);
    const curve = screen.getByText("Curve");
    expect(curve.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(curve);
    expect(useEditorStore.getState().smooth).toBe(true);
    expect(curve.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(curve);
    expect(useEditorStore.getState().smooth).toBe(false);
  });

  it("shows a cancel affordance only while a drawing is in progress", () => {
    render(<ToolStrip />);
    expect(screen.queryByText(/Cancel/)).toBeNull();
    useEditorStore.setState({ tool: "running", draft: [{ x: 0, y: 0 }] });
    cleanup();
    render(<ToolStrip />);
    expect(screen.getByText(/Cancel/)).toBeTruthy();
  });
});
