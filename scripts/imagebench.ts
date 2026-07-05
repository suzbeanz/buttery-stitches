/**
 * Render the image-pipeline corpus for human review: every corpus image runs
 * end-to-end (trace → engine) and writes a stitch-level SVG next to a metric
 * line, so a pipeline change can be EYEBALLED across all input classes at once.
 *
 *   npx vite-node scripts/imagebench.ts [outDir=/tmp/imagebench]
 */
import fs from "node:fs";
import path from "node:path";
import { imageDataToObjects } from "../src/lib/trace";
import { generateDesign } from "../src/lib/engine";
import { createEmptyProject } from "../src/lib/project";
import { corpusImages } from "../src/lib/bench/imagecorpus";

const outDir = process.argv[2] ?? "/tmp/imagebench";
fs.mkdirSync(outDir, { recursive: true });

for (const c of corpusImages()) {
  const res = imageDataToObjects(c.image as unknown as ImageData, c.colors, {
    mmPerPx: c.mmPerPx,
    removeBackground: c.removeBackground,
    detail: "balanced",
  });
  const project = {
    ...createEmptyProject(),
    colors: res.colors,
    objects: res.objects.map((o) => ({ ...o, visible: true })),
  };
  const design = generateDesign(project);
  const sewn = design.filter((s) => !s.jump && !s.trim);
  const trims = design.filter((s) => s.trim).length;

  const xs = design.map((s) => s.x);
  const ys = design.map((s) => s.y);
  const minX = Math.min(...xs) - 2;
  const maxX = Math.max(...xs) + 2;
  const minY = Math.min(...ys) - 2;
  const maxY = Math.max(...ys) + 2;
  const S = 8;
  let lines = "";
  for (let i = 1; i < design.length; i++) {
    const a = design[i - 1];
    const b = design[i];
    if (b.jump || b.trim || a.jump || a.trim || b.colorId !== a.colorId) continue;
    const col = res.colors.find((x) => x.id === b.colorId);
    lines += `<line x1="${((a.x - minX) * S).toFixed(1)}" y1="${((a.y - minY) * S).toFixed(1)}" x2="${((b.x - minX) * S).toFixed(1)}" y2="${((b.y - minY) * S).toFixed(1)}" stroke="rgb(${col?.rgb.join(",")})" stroke-width="2.6" stroke-linecap="round" opacity="0.9"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(maxX - minX) * S}" height="${(maxY - minY) * S}" style="background:#faf8f2">${lines}</svg>`;
  const file = path.join(outDir, `${c.name}.svg`);
  fs.writeFileSync(file, svg);
  console.log(
    `${c.name.padEnd(16)} colors=${res.colors.length} objects=${res.objects.length} ` +
      `stitches=${sewn.length} trims/1k=${((1000 * trims) / sewn.length).toFixed(1)} ` +
      `size=${(maxX - minX).toFixed(0)}x${(maxY - minY).toFixed(0)}mm → ${file}`,
  );
}
