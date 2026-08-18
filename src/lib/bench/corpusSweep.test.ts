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
      // PRO-METRIC design gates, thresholds measured from five commercial
      // reference bundles (DST/PES decoded stitch-by-stitch; one ships its
      // Wilcom production worksheet):
      //  • trims: 12 per 13.5k stitches on the flagship dog; small designs run
      //    to ~22/10k. Standalone lettering is the exception the pros make
      //    too: every glyph is an island on open fabric and cuts about once —
      //    so the gate also scales with the design's disjoint piece count.
      //  • stitch length: every reference FILL block's q95 is 3.99-4.10mm;
      //    their decorative satin runs 4.5-6.3 (a ring band measured 4.54).
      //    Gate at 5.0 so satin-heavy designs pass while runaway fills fail.
      //  • locks: the references tie in and out at every thread cut.
      const proDetail =
        `trims=${sweep.trims} (${sweep.trimsPer10k.toFixed(1)}/10k, ${sweep.pieces} pieces) ` +
        `q95=${sweep.stitchQ95Mm.toFixed(2)} locked=${sweep.lockedBoundaries}/${sweep.boundaries}\n${detail}`;
      expect(sweep.trims, `trims vs pro band\n${proDetail}`).toBeLessThanOrEqual(
        Math.max(6, (24 / 10_000) * sweep.stitches, sweep.pieces + 4),
      );
      expect(sweep.stitchQ95Mm, `stitch q95 vs pro band\n${proDetail}`).toBeLessThanOrEqual(5.0);
      expect(sweep.lockedBoundaries, `locked boundaries\n${proDetail}`).toBe(sweep.boundaries);
    });
  }
});
