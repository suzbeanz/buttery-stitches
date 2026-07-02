// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ColorSelect from "./ColorSelect";
import type { ThreadColor } from "../types/project";

const COLORS: ThreadColor[] = [
  { id: "c1", rgb: [233, 68, 53], name: "Red" },
  { id: "c2", rgb: [53, 168, 84], name: "Green" },
  { id: "c3", rgb: [66, 133, 244], name: "Blue" },
];

describe("ColorSelect", () => {
  beforeEach(() => cleanup());

  it("shows the current color and opens a swatch list on click", () => {
    render(<ColorSelect value="c1" colors={COLORS} onChange={vi.fn()} label="Thread color" />);
    // Trigger advertises the current color name for accessibility.
    const trigger = screen.getByRole("button", { name: /Thread color: Red/ });
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    // Each color is a swatch+name option, with a colored swatch.
    expect(screen.getByRole("option", { name: /Green/ })).toBeTruthy();
    const swatches = document.querySelectorAll('[role="listbox"] span[style*="background"]');
    expect(swatches.length).toBe(3);
  });

  it("calls onChange with the picked color and closes", () => {
    const onChange = vi.fn();
    render(<ColorSelect value="c1" colors={COLORS} onChange={onChange} label="Thread color" />);
    fireEvent.click(screen.getByRole("button", { name: /Thread color:/ }));
    fireEvent.click(screen.getByRole("option", { name: "Blue" }));
    expect(onChange).toHaveBeenCalledWith("c3");
    expect(screen.queryByRole("listbox")).toBeNull(); // closed after pick
  });

  it("renders an extra non-color choice", () => {
    const onChange = vi.fn();
    render(
      <ColorSelect
        value="c1"
        colors={COLORS}
        onChange={onChange}
        extra={[{ value: "__new__", label: "New color…" }]}
        label="Outline color"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Outline color:/ }));
    fireEvent.click(screen.getByRole("option", { name: /New color/ }));
    expect(onChange).toHaveBeenCalledWith("__new__");
  });
});

describe("ColorSelect keyboard listbox model", () => {
  beforeEach(() => cleanup());

  it("opens on ArrowDown, focuses the selected option, arrows move, Enter picks", () => {
    const onChange = vi.fn();
    render(<ColorSelect value="c1" colors={COLORS} onChange={onChange} label="Thread color" />);
    const trigger = screen.getByRole("button", { name: /Thread color:/ });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    // The selected option receives focus (roving tabindex).
    const red = screen.getByRole("option", { name: "Red" });
    expect(document.activeElement).toBe(red);
    // ArrowDown moves focus to the next option; Enter picks it.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Green" }));
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c2");
    // Closed, and focus returned to the trigger.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Home/End jump and type-ahead seeks by first letter", () => {
    const onChange = vi.fn();
    render(<ColorSelect value="c1" colors={COLORS} onChange={onChange} label="Thread color" />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Thread color:/ }), { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Blue" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Red" }));
    // Type-ahead: "g" jumps to Green.
    fireEvent.keyDown(document.activeElement!, { key: "g" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Green" }));
  });

  it("Escape closes and restores focus to the trigger", () => {
    render(<ColorSelect value="c1" colors={COLORS} onChange={vi.fn()} label="Thread color" />);
    const trigger = screen.getByRole("button", { name: /Thread color:/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
