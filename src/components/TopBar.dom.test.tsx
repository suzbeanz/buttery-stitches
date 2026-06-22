// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TopBar from "./TopBar";
import { resetStores } from "../test/setup";
import { createEmptyProject } from "../lib/project";

describe("TopBar overflow menu", () => {
  beforeEach(() => {
    cleanup();
    resetStores(createEmptyProject());
  });

  it("tucks low-frequency actions into a More menu (closed by default)", () => {
    render(<TopBar onHelp={() => {}} />);
    // The More toggle is present (it's the narrow-screen affordance).
    expect(screen.getByRole("button", { name: /More actions/ })).toBeTruthy();
    // The menu's items aren't rendered until it's opened. "Save a copy" / "Check
    // design" are the exact menu labels (the inline buttons carry longer labels),
    // so an exact-name query matches only the menu item.
    expect(screen.queryByRole("button", { name: "Save a copy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check design" })).toBeNull();
  });

  it("opens the More menu and exposes the tucked actions", () => {
    render(<TopBar onHelp={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    expect(screen.getByRole("button", { name: "Save a copy" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check design" })).toBeTruthy();
  });
});
