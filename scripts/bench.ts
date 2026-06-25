import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { CORPUS, letteringProject } from "../src/lib/bench/corpus";
import { benchMetrics, type BenchMetrics } from "../src/lib/bench/metrics";
import { parseFont } from "../src/lib/text/fonts";

/**
 * Benchmark runner: score every corpus design and print the scoreboard, then
 * write bench/baseline.json so future runs can be diffed (a metric moving the
 * wrong way is a regression; the right way is progress toward beating Wilcom).
 *
 *   npm run bench
 */

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (x: number) => `${round(x * 100, 1)}%`;

// Real lettering, loaded from the bundled flagship font (Oswald) — added at
// runtime because parsing a .ttf needs node, which the static corpus avoids.
function letteringDesigns(): { name: string; project: import("../src/types/project").Project }[] {
  try {
    const buf = readFileSync("src/lib/text/fonts/Oswald-Medium.ttf");
    const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    return [letteringProject("lettering-STITCH", font, "STITCH")];
  } catch (e) {
    console.warn("lettering design skipped:", (e as Error).message);
    return [];
  }
}

const designs = [...CORPUS, ...letteringDesigns()];
const results: { name: string; metrics: BenchMetrics }[] = designs.map(({ name, project }) => ({
  name,
  metrics: benchMetrics(project),
}));

const table = results.map(({ name, metrics: m }) => ({
  design: name,
  stitches: m.stitches,
  jumps: m.jumps,
  trims: m.trims,
  "thread(mm)": round(m.threadLengthMm),
  "travel(mm)": round(m.travelMm),
  "travel%": pct(m.travelRatio),
  "meanLen(mm)": round(m.stitchLen.mean, 2),
  lenCV: round(m.stitchLen.cv, 2),
  "short%": pct(m.stitchLen.shortPct),
  coverage: m.fillCoverage == null ? "—" : pct(m.fillCoverage),
  "pullIn(mm)": round(m.pullInMm, 3),
}));

console.table(table);

const fillCov = results.map((r) => r.metrics.fillCoverage).filter((c): c is number => c != null);
const summary = {
  designs: results.length,
  totalStitches: results.reduce((a, r) => a + r.metrics.stitches, 0),
  totalTravelMm: round(results.reduce((a, r) => a + r.metrics.travelMm, 0)),
  meanTravelPct: pct(results.reduce((a, r) => a + r.metrics.travelRatio, 0) / results.length),
  meanFillCoverage: fillCov.length ? pct(fillCov.reduce((a, c) => a + c, 0) / fillCov.length) : "—",
};
console.log("\nSummary:", summary);

mkdirSync("bench", { recursive: true });
const baseline = { generatedAt: new Date().toISOString(), summary, results };
writeFileSync("bench/baseline.json", JSON.stringify(baseline, null, 2));
console.log("\nWrote bench/baseline.json");
