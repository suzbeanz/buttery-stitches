import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Font } from "opentype.js";
import { parseFont } from "../text/fonts";
import { letteringProject } from "./corpus";
import { designFor } from "../engine";
import { benchMetrics } from "./metrics";

// Load the bundled flagship font straight from disk (node, no DOM/network).
const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "text", "fonts");
function loadTtf(file: string): Font {
  const buf = readFileSync(join(fontsDir, file));
  return parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe("lettering (satin, real font)", () => {
  let font: Font;
  beforeAll(() => {
    font = loadTtf("Oswald-Medium.ttf");
  });

  it("sews a word with near-full coverage and tight glyph routing", () => {
    const { project } = letteringProject("STITCH", font, "STITCH");
    const design = designFor(project);
    expect(design.length).toBeGreaterThan(200);
    const m = benchMetrics(project);
    // The satin lettering should cover its glyphs and not strand them: high
    // coverage, and travel a small fraction of the laid thread.
    expect(m.fillCoverage).not.toBeNull();
    expect(m.fillCoverage!).toBeGreaterThan(0.92);
    expect(m.travelRatio).toBeLessThan(0.12);
    // Roughly one trim per inter-glyph gap — not a trim storm.
    expect(m.trims).toBeLessThanOrEqual(8);
  });
});
