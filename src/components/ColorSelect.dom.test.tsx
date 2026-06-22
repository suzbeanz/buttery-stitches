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
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
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
    fireEvent.click(screen.getByRole("button", { name: /New color/ }));
    expect(onChange).toHaveBeenCalledWith("__new__");
  });
});
