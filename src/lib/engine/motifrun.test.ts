import { describe, it, expect } from "vitest";
import { motifRunAlong } from "./fill";
import { generateDesign } from "./index";
import { makeObject } from "../objects";
import { createEmptyProject } from "../project";
import type { Path } from "../../types/project";

const path: Path = [{ x: 0, y: 0 }, { x: 40, y: 0 }];

describe("motif run", () => {
  it("repeats the motif along the path, inside its span", () => {
    const r = motifRunAlong(path, { motifId: "chevron", sizeMm: 5 });
    expect(r.length).toBeGreaterThan(4);
    for (const s of r)
      for (const p of s) {
        expect(p.x).toBeGreaterThan(-3);
        expect(p.x).toBeLessThan(43);
      }
  });

  it("bigger motif size => fewer repeats", () => {
    const small = motifRunAlong(path, { motifId: "diamond", sizeMm: 3 }).length;
    const big = motifRunAlong(path, { motifId: "diamond", sizeMm: 9 }).length;
    expect(big).toBeLessThan(small);
  });

  it("engine: a running object with motifRun sews safely", () => {
    const o = makeObject("running", path, "c1");
    o.params.motifRun = "chevron";
    const d = generateDesign({ ...createEmptyProject(), objects: [o] }, { lockStitches: true });
    expect(d.some((s) => !s.jump && !s.trim)).toBe(true);
    let longest = 0;
    for (let i = 1; i < d.length; i++)
      if (!d[i].jump && !d[i].trim && d[i].colorId === d[i - 1].colorId)
        longest = Math.max(longest, Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y));
    expect(longest).toBeLessThanOrEqual(9.1);
  });
});
