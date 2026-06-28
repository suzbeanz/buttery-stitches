/**
 * PES v1 oracle — step 1 (vite-node): emit the native writer's bytes + the split
 * plans to JSON, for the Pyodide comparison in oracle-pes.mjs (which needs plain
 * node — vite-node can't resolve Pyodide's internal modules).
 *
 *   vite-node scripts/oracle-pes.ts && node scripts/oracle-pes.mjs
 */
import { writeFileSync } from "node:fs";
import { encodePes } from "../src/lib/export/native/pes";
import { splitPlanForFormat, type StitchPlan, type PlanCmd } from "../src/lib/export";

const sq = (cx: number, cy: number, r: number): PlanCmd[] => [
  ["s", cx - r, cy - r], ["s", cx + r, cy - r], ["s", cx + r, cy + r], ["s", cx - r, cy + r], ["s", cx - r, cy - r],
];

const PLANS: { name: string; plan: StitchPlan }[] = [
  { name: "single square", plan: { blocks: [{ rgb: 0x2050c0, cmds: sq(0, 0, 200) }] } },
  {
    name: "two colors + trim",
    plan: { blocks: [
      { rgb: 0xcc2020, cmds: [...sq(-300, 0, 150), ["t"]] },
      { rgb: 0x2050c0, cmds: sq(300, 0, 150) },
    ] },
  },
  { name: "long stitch (needs split)", plan: { blocks: [{ rgb: 0x10a020, cmds: [["s", 0, 0], ["s", 1500, 0], ["s", 1500, 1500]] }] } },
  { name: "with jump", plan: { blocks: [{ rgb: 0x808080, cmds: [["s", 0, 0], ["j", 500, 500], ["s", 600, 600], ["s", 700, 500]] }] } },
  {
    name: "three colors",
    plan: { blocks: [
      { rgb: 0xcc2020, cmds: sq(-400, 0, 120) },
      { rgb: 0x20a040, cmds: sq(0, 0, 120) },
      { rgb: 0x2050c0, cmds: sq(400, 0, 120) },
    ] },
  },
];

const out = PLANS.map(({ name, plan }) => {
  const split = splitPlanForFormat(plan, "pes");
  return { name, split, mine: Array.from(encodePes(split)) };
});
writeFileSync("/tmp/pes-mine.json", JSON.stringify(out));
console.log(`emitted ${out.length} plans → /tmp/pes-mine.json`);
