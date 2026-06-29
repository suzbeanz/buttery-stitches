import { describe, it, expect } from "vitest";
import { CORPUS } from "../bench/corpus";
import { designFor, levelInnerTurns } from "./index";
import type { EngineStitch } from "./index";

const st = (x: number, y: number): EngineStitch => ({ x, y, colorId: "c", objectId: "o" });

describe("levelInnerTurns (unit)", () => {
  it("drops the apexes of a tight sharp-turn cluster (sub-0.5mm zigzag bending hard back)", () => {
    // A tight inner-edge zigzag: ~0.3mm segments reversing ~180° at each apex.
    const cluster: EngineStitch[] = [st(0, 0), st(0.3, 0.02), st(0, 0.04), st(0.3, 0.06), st(0, 0.08)];
    const out = levelInnerTurns(cluster);
    expect(out.length).toBeLessThan(cluster.length); // apexes leveled out
  });

  it("leaves a straight dense run untouched (short segments but no bend)", () => {
    const straight: EngineStitch[] = [st(0, 0), st(0.3, 0), st(0.6, 0), st(0.9, 0), st(1.2, 0)];
    expect(levelInnerTurns(straight)).toHaveLength(straight.length);
  });

  it("leaves a gentle curve untouched (sharp-bend test fails)", () => {
    const gentle: EngineStitch[] = [st(0, 0), st(0.4, 0.05), st(0.8, 0.12), st(1.2, 0.21)];
    expect(levelInnerTurns(gentle)).toHaveLength(gentle.length);
  });

  it("keeps long segments even at a sharp reversal (only short clusters level)", () => {
    const wide: EngineStitch[] = [st(0, 0), st(2, 0.05), st(0, 0.1), st(2, 0.15)];
    expect(levelInnerTurns(wide)).toHaveLength(wide.length);
  });
});

/**
 * P1b — short-stitch / inner-curve leveling as a shared stream invariant. On the
 * final stream, no penetration may sit at a SHARP inner turn (the path bends hard
 * back) with BOTH adjacent segments shorter than the inner-turn floor: that's an
 * inner-radius cluster — a ridge and thread-build the way a hand digitizer levels
 * it. Guarded across the whole corpus (curved/concave shapes included) so the
 * leveling can't silently regress. Straight dense runs (satin throws, fill rows)
 * bend little, so the rule never touches them.
 */
const FLOOR_MM = 0.5;
const SHARP_COS = -0.3; // ~107°+ bend

describe("short-stitch leveling — no inner-turn penetration cluster", () => {
  for (const { name, project } of CORPUS) {
    it(`${name}: no sharp-turn cluster under ${FLOOR_MM}mm`, () => {
      const d = designFor(project);
      let clusters = 0;
      for (let i = 1; i < d.length - 1; i++) {
        const a = d[i - 1];
        const s = d[i];
        const b = d[i + 1];
        const real = (e: typeof s) => !e.jump && !e.trim && !e.stop;
        if (!real(a) || !real(s) || !real(b)) continue;
        if (a.colorId !== s.colorId || s.colorId !== b.colorId) continue;
        const ax = s.x - a.x, ay = s.y - a.y;
        const bx = b.x - s.x, by = b.y - s.y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la < 1e-6 || lb < 1e-6) continue;
        if (la < FLOOR_MM && lb < FLOOR_MM && (ax * bx + ay * by) / (la * lb) < SHARP_COS) clusters++;
      }
      expect(clusters, `${name}: ${clusters} sharp inner-turn clusters`).toBe(0);
    });
  }
});
