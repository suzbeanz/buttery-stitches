import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFont } from "./text/fonts";
import { TEMPLATES, buildTemplate } from "./templates";
import { sweepProject } from "./bench/sweep";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "text", "fonts");
const buf = readFileSync(join(fontsDir, "Oswald-Medium.ttf"));
const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);

describe("starter templates", () => {
  for (const t of TEMPLATES) {
    it(`${t.id} passes the corpus quality gates`, () => {
      const project = buildTemplate(t.id, font);
      expect(project.objects.length).toBeGreaterThan(0);
      const sweep = sweepProject(project);
      for (const o of sweep.objects) {
        const covFloor = o.strokeWidthMm > 0 && o.strokeWidthMm < 0.75 ? 0.93 : 0.95;
        expect(o.coverage, `coverage of ${t.id}/${o.name}`).toBeGreaterThanOrEqual(covFloor);
        expect(o.crossings, `crossings in ${t.id}/${o.name}`).toBe(0);
        expect(o.maxSegMm, `max segment in ${t.id}/${o.name}`).toBeLessThanOrEqual(7.5);
      }
      expect(sweep.dangerCells, `density danger in ${t.id}`).toBe(0);
    });
  }
});
