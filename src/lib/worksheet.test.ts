import { describe, it, expect } from "vitest";
import { buildWorksheet, formatDuration, worksheetHtml } from "./worksheet";
import { createEmptyProject } from "./project";
import { makeObject } from "./objects";

function twoColorProject() {
  const p = createEmptyProject();
  p.colors = [
    { id: "c1", rgb: [200, 20, 30], name: "Red", brand: "Madeira", code: "1147" },
    { id: "c2", rgb: [10, 60, 200], name: "Blue" },
  ];
  p.objects = [
    makeObject("running", [{ x: 0, y: 0 }, { x: 20, y: 0 }], "c1"),
    makeObject("running", [{ x: 40, y: 40 }, { x: 60, y: 40 }], "c2"),
  ];
  return p;
}

describe("buildWorksheet", () => {
  it("lists colour stops in order with per-stop stitch counts", () => {
    const ws = buildWorksheet(twoColorProject());
    expect(ws.rows).toHaveLength(2);
    expect(ws.colorStops).toBe(2);
    expect(ws.rows[0].name).toBe("Red");
    expect(ws.rows[0].brand).toBe("Madeira");
    expect(ws.rows[0].stitches).toBeGreaterThan(0);
    expect(ws.totalStitches).toBe(ws.rows[0].stitches + ws.rows[1].stitches);
    expect(ws.estMinutes).toBeGreaterThan(0);
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(7)).toBe("7 m");
    expect(formatDuration(64)).toBe("1 h 04 m");
  });
});

describe("worksheetHtml", () => {
  it("produces a self-contained HTML document with swatches and totals", () => {
    const html = worksheetHtml(buildWorksheet(twoColorProject()), "Logo");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Thread Worksheet");
    expect(html).toContain("#c8141e"); // red swatch hex
    expect(html).toContain("Madeira");
  });
});
