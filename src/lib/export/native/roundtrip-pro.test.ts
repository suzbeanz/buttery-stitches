import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { livePaintObjects } from "../../trace/livepaint";
import { fixStitches } from "../../fix";
import { createEmptyProject, parseProject } from "../../project";
import { planFromProject, splitPlanForFormat, type StitchPlan } from "../index";
import { encodeDst } from "./dst";
import { encodePes } from "./pes";
import { decodeTernaryStitches, type TernaryStitch } from "./ternary-decode";
import { decodePecStitches } from "./pec-decode";
import type { Project } from "../../../types/project";

/**
 * PRO-METRIC gates on our own EXPORTED BYTES. The engine's trim/lock quality
 * was measured against five commercial reference files — but the machine never
 * sees the engine's stitch stream, only the encoded file. These tests decode
 * the DST/PES bytes we write and assert the professional metrics survived the
 * encoding: every trim intact, every thread cut locked, stitch lengths in the
 * professional band, and zero accumulated delta-encoding drift.
 */

function build(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  return { width: w, height: h, data } as ImageData;
}

/** The outlined 2×2-rooms cartoon (same fixture as the live-paint pipeline gates). */
function livePaintProject(): Project {
  const img = build(480, 480, (x, y) => {
    if (!(x >= 40 && x < 440 && y >= 40 && y < 440)) return [0, 0, 0, 0];
    const onOuter = x < 52 || x >= 428 || y < 52 || y >= 428;
    const onVert = x >= 234 && x < 246;
    const onHoriz = y >= 234 && y < 246;
    if (onOuter || onVert || onHoriz) return [20, 20, 24, 255];
    const left = x < 240;
    const top = y < 240;
    if (top && left) return [60, 180, 240, 255];
    if (top && !left) return [252, 252, 252, 255];
    if (!top && left) return [210, 20, 45, 255];
    return [60, 180, 240, 255];
  });
  const res = livePaintObjects(img, 5, { mmPerPx: 0.2, offsetX: 0, offsetY: 0, removeBackground: true });
  return fixStitches({
    ...createEmptyProject(),
    widthMm: 96,
    heightMm: 96,
    colors: res.colors,
    objects: res.objects,
  });
}

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bench", "corpus");
function corpusProject(name: string): Project {
  return parseProject(JSON.parse(readFileSync(join(corpusDir, name), "utf8")));
}

/** How many trim sentinels the DST writer will emit for this plan — replicate
 *  its exact rule: a trim before every color change and at every ["t"], except
 *  when the previous record already was a trim. */
function expectedDstTrims(plan: StitchPlan): number {
  let trims = 0;
  let lastTrim = false;
  plan.blocks.forEach((block, bi) => {
    if (bi > 0) {
      if (!lastTrim) trims++;
      lastTrim = false; // the color-change record clears it
    }
    for (const cmd of block.cmds) {
      if (cmd[0] === "t") {
        if (!lastTrim) trims++;
        lastTrim = true;
      } else {
        lastTrim = false;
      }
    }
  });
  return trims;
}

/** Find the trim sentinels in a decoded DST stream: the writer's exact
 *  3-jump zero-net jitter (+2,-2 / -4,+4 / +2,-2 in file axes). Returns the
 *  index of each sentinel's first record. */
function dstTrimSentinels(st: TernaryStitch[]): number[] {
  const out: number[] = [];
  for (let i = 2; i < st.length; i++) {
    if (!st[i].jump || !st[i - 1].jump || !st[i - 2].jump) continue;
    // Net-zero displacement across the triple, tiny individual moves.
    const dx1 = st[i - 2].x - (st[i - 3]?.x ?? 0);
    if (Math.abs(dx1) > 4) continue;
    if (st[i].x === (st[i - 3]?.x ?? 0) && st[i].y === (st[i - 3]?.y ?? 0)) {
      out.push(i - 2);
      i += 2; // don't double-count overlapping windows
    }
  }
  return out;
}

/** ≥2 penetration-to-penetration gaps ≤ 1.2mm within a few records on the
 *  given side of index `at` — the decoded shape of the engine's tie stitches. */
function lockedSide(st: TernaryStitch[], at: number, dir: -1 | 1): boolean {
  let short = 0;
  let steps = 0;
  let i = at;
  // Skip adjacent non-penetration records (jumps / color changes).
  while (i >= 0 && i < st.length && (st[i].jump || st[i].colorChange)) i += dir;
  while (steps < 7 && i + dir >= 0 && i + dir < st.length) {
    const a = st[i];
    const b = st[i + dir];
    if (a.jump || a.colorChange || b.jump || b.colorChange) break;
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 12) short++;
    i += dir;
    steps++;
  }
  return short >= 2;
}

function q95PenetrationGap(st: { x: number; y: number; jump: boolean }[]): number {
  const lens: number[] = [];
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1] as { x: number; y: number; jump: boolean; colorChange?: boolean };
    const b = st[i] as { x: number; y: number; jump: boolean; colorChange?: boolean };
    if (a.jump || b.jump || a.colorChange || b.colorChange) continue;
    lens.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  lens.sort((x, y) => x - y);
  return lens.length ? lens[Math.min(lens.length - 1, Math.floor(0.95 * lens.length))] : 0;
}

describe("exported bytes keep the professional metrics", () => {
  const fixtures: [string, () => Project][] = [
    ["live-paint cartoon", livePaintProject],
    ["corpus lettering", () => corpusProject("corpus-lettering.embproj")],
  ];

  for (const [name, make] of fixtures) {
    describe(name, () => {
      const project = make();
      const basePlan = planFromProject(project);

      it("DST: trims, locks, lengths and drift all survive to the bytes", () => {
        const plan = splitPlanForFormat(basePlan, "dst");
        const bytes = encodeDst(plan);
        const st = decodeTernaryStitches(bytes);

        // Penetration count: exactly the plan's stitch commands.
        const planStitches = plan.blocks.reduce(
          (n, b) => n + b.cmds.filter((c) => c[0] === "s").length,
          0,
        );
        const penetrations = st.filter((s) => !s.jump && !s.colorChange).length;
        expect(penetrations).toBe(planStitches);

        // Every trim the plan asked for is a sentinel in the bytes.
        const sentinels = dstTrimSentinels(st);
        expect(sentinels.length).toBe(expectedDstTrims(plan));

        // Every thread cut is LOCKED on both sides (tie-out before, tie-in
        // after) — the reference files lock every cut.
        for (const at of sentinels) {
          expect(lockedSide(st, at - 1, -1), `tie-out before sentinel @${at}`).toBe(true);
          expect(lockedSide(st, at + 3, 1), `tie-in after sentinel @${at}`).toBe(true);
        }

        // Color changes: one per block transition.
        const colorChanges = st.filter((s) => s.colorChange).length;
        expect(colorChanges).toBe(plan.blocks.length - 1);

        // Professional stitch-length band on the decoded stream (1/10mm units).
        expect(q95PenetrationGap(st)).toBeLessThanOrEqual(50);

        // Zero accumulated drift: the decoder's final position equals the last
        // planned coordinate (delta encoding must round-trip exactly).
        const lastCmd = [...plan.blocks.flatMap((b) => b.cmds)].reverse().find((c) => c.length === 3)!;
        const end = st[st.length - 1];
        expect(end.x).toBe(Math.round(lastCmd[1] as number));
        expect(end.y).toBe(Math.round(lastCmd[2] as number));
      });

      it("PES: penetration count, lengths and extent survive to the bytes", () => {
        const plan = splitPlanForFormat(basePlan, "pes");
        const bytes = encodePes(plan);
        const st = decodePecStitches(bytes);
        const planStitches = plan.blocks.reduce(
          (n, b) => n + b.cmds.filter((c) => c[0] === "s").length,
          0,
        );
        const penetrations = st.filter((s) => !s.jump).length;
        // PEC carries no explicit trim opcode; allow the writer's few pad/lead
        // moves but never a real loss.
        expect(Math.abs(penetrations - planStitches)).toBeLessThanOrEqual(
          Math.max(4, planStitches * 0.01),
        );
        expect(q95PenetrationGap(st)).toBeLessThanOrEqual(50);
        // Extent matches the plan bounds within a millimetre (PEC recenters,
        // so compare sizes, not positions).
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const b of plan.blocks)
          for (const c of b.cmds)
            if (c[0] === "s") {
              minX = Math.min(minX, c[1]); maxX = Math.max(maxX, c[1]);
              minY = Math.min(minY, c[2]); maxY = Math.max(maxY, c[2]);
            }
        let dMinX = Infinity, dMinY = Infinity, dMaxX = -Infinity, dMaxY = -Infinity;
        for (const s of st)
          if (!s.jump) {
            dMinX = Math.min(dMinX, s.x); dMaxX = Math.max(dMaxX, s.x);
            dMinY = Math.min(dMinY, s.y); dMaxY = Math.max(dMaxY, s.y);
          }
        expect(Math.abs(dMaxX - dMinX - (maxX - minX))).toBeLessThanOrEqual(10);
        expect(Math.abs(dMaxY - dMinY - (maxY - minY))).toBeLessThanOrEqual(10);
      });
    });
  }
});
