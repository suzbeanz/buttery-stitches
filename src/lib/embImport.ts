import type { EmbObject, ThreadColor } from "../types/project";
import type { ImportedPlan } from "./export";
import { newId } from "./id";
import { makeObjectFromPaths } from "./objects";

/**
 * Turn a design read from an embroidery file (an {@link ImportedPlan}) into
 * objects + colors ready to merge into the current project. Each color block
 * becomes a thread color; each contiguous stitch run becomes a RAW running
 * object — its penetrations are kept verbatim (params.raw), so the imported
 * stitching is preserved exactly rather than re-digitized. Pure + testable.
 */
export function buildImportedObjects(
  plan: ImportedPlan,
  baseName = "Imported",
): { colors: ThreadColor[]; objects: EmbObject[] } {
  const colors: ThreadColor[] = [];
  const objects: EmbObject[] = [];

  plan.blocks.forEach((block, bi) => {
    const rgb: [number, number, number] = [
      (block.rgb >> 16) & 0xff,
      (block.rgb >> 8) & 0xff,
      block.rgb & 0xff,
    ];
    const color: ThreadColor = { id: newId("color"), rgb, name: `${baseName} ${bi + 1}` };
    let used = false;
    block.runs.forEach((run) => {
      // pyembroidery units are 1/10 mm; the app works in mm.
      const pts = run.map(([x, y]) => ({ x: x / 10, y: y / 10 }));
      if (pts.length < 2) return;
      const obj = makeObjectFromPaths("running", [pts], color.id, `${baseName} ${bi + 1}`);
      obj.params = { raw: true };
      objects.push(obj);
      used = true;
    });
    if (used) colors.push(color);
  });

  return { colors, objects };
}
