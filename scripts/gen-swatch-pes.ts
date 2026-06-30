// One-off: regenerate the calibration swatch PES (native v1, the path the app
// uses for Brother machines) so a fresh stabilized sew-out can be measured.
import { writeFileSync } from "node:fs";
import { buildTestSwatch } from "../src/lib/samples/swatch";
import { designFor } from "../src/lib/engine";
import { planFromProject, splitPlanForFormat } from "../src/lib/export";
import { encodePes } from "../src/lib/export/native/pes";

const project = buildTestSwatch();
const design = designFor(project);
const plan = planFromProject(project);
const bytes = encodePes(splitPlanForFormat(plan, "pes"));
const out = "/tmp/buttery-swatch.pes";
writeFileSync(out, bytes);
const stitches = design.filter((s) => !s.jump).length;
console.log(`wrote ${out} (${bytes.length} bytes, ${stitches} stitches, ${project.colors.length} colors)`);
