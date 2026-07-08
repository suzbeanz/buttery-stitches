import { describe, it, expect } from "vitest";
import { parseChartFile } from "./customCharts";

describe("parseChartFile — CSV", () => {
  it("parses code,name,#hex lines with a header row skipped", () => {
    const chart = parseChartFile(
      `code,name,color
1147,Cherry Red,#C41E3A
1076,Royal Blue,#2454B0`,
      "My Madeira",
    );
    expect(chart.name).toBe("My Madeira");
    expect(chart.id).toBe("custom-my-madeira");
    expect(chart.threads).toHaveLength(2);
    expect(chart.threads[0]).toEqual({
      brand: "My Madeira",
      code: "1147",
      name: "Cherry Red",
      rgb: [196, 30, 58],
    });
  });

  it("parses code,name,r,g,b lines", () => {
    const chart = parseChartFile(`0020,Black,20,20,22\n0015,White,248,248,244`, "Isacord");
    expect(chart.threads).toHaveLength(2);
    expect(chart.threads[1].rgb).toEqual([248, 248, 244]);
  });

  it("handles semicolon and tab delimiters", () => {
    expect(parseChartFile("A;Red;#ff0000", "S").threads[0].rgb).toEqual([255, 0, 0]);
    expect(parseChartFile("A\tRed\t#00ff00", "T").threads[0].rgb).toEqual([0, 255, 0]);
  });

  it("skips malformed rows but keeps good ones", () => {
    const chart = parseChartFile(
      `ok,Good Red,#ff0000
bad row without color
also,bad,#zzz
fine,Good Blue,0,0,255`,
      "Mixed",
    );
    expect(chart.threads.map((t) => t.code)).toEqual(["ok", "fine"]);
  });

  it("throws a friendly error when nothing parses", () => {
    expect(() => parseChartFile("hello\nworld", "Nope")).toThrow(/No usable rows/);
  });
});

describe("parseChartFile — JSON", () => {
  it("accepts a full ThreadChart shape and keeps per-row brands", () => {
    const chart = parseChartFile(
      JSON.stringify({
        name: "Rainbow 2",
        threads: [
          { brand: "BrandX", code: "1", name: "Red", rgb: [255, 0, 0] },
          { code: "2", name: "Green", hex: "#00ff00" },
        ],
      }),
      "ignored",
    );
    expect(chart.name).toBe("Rainbow 2");
    expect(chart.threads[0].brand).toBe("BrandX");
    expect(chart.threads[1].brand).toBe("Rainbow 2"); // falls back to chart name
    expect(chart.threads[1].rgb).toEqual([0, 255, 0]);
  });

  it("accepts a bare array of threads", () => {
    const chart = parseChartFile(
      JSON.stringify([{ code: "9", name: "Gold", hex: "D8A830" }]),
      "Golds",
    );
    expect(chart.threads[0].rgb).toEqual([216, 168, 48]);
  });

  it("rejects invalid JSON and empty thread lists with clear messages", () => {
    expect(() => parseChartFile("{not json", "X")).toThrow(/couldn't be read/);
    expect(() => parseChartFile("[]", "X")).toThrow(/list of threads|No usable/);
    expect(() => parseChartFile(JSON.stringify([{ name: "no code" }]), "X")).toThrow(
      /No usable threads/,
    );
  });

  it("clamps out-of-range byte values by rejecting the row", () => {
    const chart = parseChartFile(
      JSON.stringify([
        { code: "1", name: "Bad", rgb: [999, 0, 0] },
        { code: "2", name: "Good", rgb: [1, 2, 3] },
      ]),
      "R",
    );
    expect(chart.threads.map((t) => t.code)).toEqual(["2"]);
  });
});
