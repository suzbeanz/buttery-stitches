import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject } from "../project";
import { sweepProject } from "./sweep";

/**
 * Perfection gates over the stress corpus: full designs (lettering at three
 * sizes + an arch, thin ring bands with a rounded-square, shape samplers)
 * swept object by object. The thresholds are the campaign's exit bar — if an
 * engine change pushes any object below them, the defect is visible at studio
 * zoom and this test names the object.
 */

const dir = join(dirname(fileURLToPath(import.meta.url)), "corpus");

describe("corpus sweep gates", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".embproj"))) {
    it(`${file}: every object covered, zero mid-air crossings, sane density`, () => {
      const project = parseProject(JSON.parse(readFileSync(join(dir, file), "utf8")));
      const sweep = sweepProject(project);
      expect(sweep.objects.length).toBeGreaterThan(0);
      const lines: string[] = [];
      for (const o of sweep.objects) {
        lines.push(
          `#${o.index} ${o.name}: cov=${o.coverage.toFixed(3)} bare=${o.bareMm2.toFixed(1)} ` +
            `maxPatch=${o.maxBarePatchMm2.toFixed(1)} cross=${o.crossings} maxSeg=${o.maxSegMm.toFixed(1)}`,
        );
      }
      const detail = lines.join("\n");
      for (const o of sweep.objects) {
        // Hairline-stroke regions (4mm lettering) sew as bean CENTERLINE runs
        // — the professional treatment; full satin at that width bleeds and
        // welds neighbouring glyphs. A run credits less area than a ladder,
        // so their bar is lower, deliberately, not accidentally.
        const covFloor = o.strokeWidthMm > 0 && o.strokeWidthMm < 0.75 ? 0.93 : 0.97;
        expect(o.coverage, `coverage of #${o.index} ${o.name}\n${detail}`).toBeGreaterThanOrEqual(covFloor);
        // The eye sees a HOLE, not a sum: a compact fill must stay under 3mm²
        // total, but a big outline network (a traced cartoon's linework)
        // accrues sub-1.5mm² halo-credit specks along hundreds of mm of
        // stroke edge while never showing one visible gap — those pass on
        // the largest-single-patch bar instead.
        if (o.maxBarePatchMm2 > 1.5)
          expect(o.bareMm2, `bare area of #${o.index} ${o.name}\n${detail}`).toBeLessThanOrEqual(3);
        expect(o.bareMm2, `bare dust of #${o.index} ${o.name}\n${detail}`).toBeLessThanOrEqual(12);
        expect(o.crossings, `crossings in #${o.index} ${o.name}\n${detail}`).toBe(0);
        expect(o.maxSegMm, `max segment in #${o.index} ${o.name}\n${detail}`).toBeLessThanOrEqual(7.5);
      }
      expect(sweep.dangerCells, `density danger cells\n${detail}`).toBe(0);
    });
  }
});
