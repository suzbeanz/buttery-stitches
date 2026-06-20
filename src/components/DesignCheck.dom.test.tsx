// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DesignCheck from "./DesignCheck";
import { resetStores } from "../test/setup";
import { createEmptyProject } from "../lib/project";
import { makeObject } from "../lib/objects";

/** A short running line: within the hoop, no density/satin/underlay issues → ready. */
function seedReady() {
  const p = createEmptyProject();
  const o = makeObject("running", [{ x: 10, y: 10 }, { x: 30, y: 10 }], p.colors[0].id);
  p.objects = [o];
  resetStores(p);
}

describe("DesignCheck", () => {
  beforeEach(() => cleanup());

  it("offers Export now when the design is ready and invokes onExport", () => {
    seedReady();
    const onExport = vi.fn();
    render(<DesignCheck onClose={() => {}} onExport={onExport} />);
    expect(screen.getByText(/Ready to stitch/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Export now/i));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("does not offer Export now for an empty design", () => {
    resetStores(createEmptyProject());
    render(<DesignCheck onClose={() => {}} onExport={() => {}} />);
    expect(screen.queryByText(/Export now/i)).toBeNull();
  });
});
