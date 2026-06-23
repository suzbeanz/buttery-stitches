// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { axe } from "vitest-axe";
import * as axeMatchers from "vitest-axe/matchers";
import { resetStores } from "./setup";
import { createEmptyProject } from "../lib/project";
import TopBar from "../components/TopBar";
import ToolRail from "../components/ToolRail";
import LayerPanel from "../components/LayerPanel";
import PropertiesPanel from "../components/PropertiesPanel";
import Toaster from "../components/Toaster";
import HelpOverlay from "../components/HelpOverlay";
import DesignCheck from "../components/DesignCheck";
import { toast } from "../store/toastStore";

expect.extend(axeMatchers);

// Component-level axe checks. color-contrast and the landmark "region" rules need
// full-page layout / a single top-level main, which don't apply when a single
// component is rendered in isolation, so they're disabled here. The full-page
// landmark + contrast checks run against the live app via @axe-core/playwright in
// the e2e suite (CI). These guard the structural a11y (names, roles, ARIA).
const OPTS = {
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
    "landmark-one-main": { enabled: false },
    "page-has-heading-one": { enabled: false },
  },
} as const;

describe("accessibility (axe)", () => {
  beforeEach(() => {
    cleanup();
    resetStores(createEmptyProject());
  });
  afterEach(cleanup);

  it("TopBar has no axe violations", async () => {
    const { container } = render(<TopBar onHelp={() => {}} onHome={() => {}} />);
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it("ToolRail has no axe violations", async () => {
    const { container } = render(<ToolRail />);
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it("LayerPanel has no axe violations", async () => {
    const { container } = render(<LayerPanel />);
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it("PropertiesPanel has no axe violations", async () => {
    const { container } = render(<PropertiesPanel />);
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it("Toaster (with an error toast) has no axe violations", async () => {
    toast("Something went wrong", "error");
    const { container } = render(<Toaster />);
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it("HelpOverlay dialog has no axe violations", async () => {
    const { container } = render(<HelpOverlay onClose={() => {}} />);
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it("DesignCheck dialog has no axe violations", async () => {
    const { container } = render(<DesignCheck onClose={() => {}} />);
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });
});
