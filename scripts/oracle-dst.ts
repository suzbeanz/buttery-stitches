/**
 * DST oracle — step 1 (vite-node): emit the native writer's bytes + the split
 * plans to JSON, for the Pyodide comparison in oracle-dst.mjs (which needs plain
 * node — vite-node can't resolve Pyodide's internal modules).
 *
 *   vite-node scripts/oracle-dst.ts && node scripts/oracle-dst.mjs
 */
import { writeFileSync } from "node:fs";
import { encodeDst } from "../src/lib/export/native/dst";
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
];

const out = PLANS.map(({ name, plan }) => {
  const split = splitPlanForFormat(plan, "dst");
  return { name, split, mine: Array.from(encodeDst(split)) };
});
writeFileSync("/tmp/dst-mine.json", JSON.stringify(out));
console.log(`emitted ${out.length} plans → /tmp/dst-mine.json`);
