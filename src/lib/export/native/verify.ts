import type { StitchPlan } from "../index";
import { decodeTernaryStitches } from "./ternary-decode";
import { decodePecStitches } from "./pec-decode";

/**
 * Export-time self-check: decode the bytes we just wrote and confirm they
 * reconstruct the plan we meant to write. The decoders (`ternary-decode.ts`,
 * `pec-decode.ts`) were built for the test suite; running them at export makes
 * the round-trip guarantee hold for every real file, not just the fixtures —
 * a corrupt file raises here instead of reaching the user's machine.
 *
 * Both native encoders emit exactly one non-jump record per plan stitch (plans
 * are pre-split below each format's per-record delta limit), so penetration
 * count and penetration bounds must match EXACTLY. Anything else is a writer
 * bug, not tolerance.
 */

export class ExportVerifyError extends Error {
  constructor(detail: string) {
    super(
      `Export self-check failed (${detail}). The file was NOT saved. ` +
        `Please try again and report this if it keeps happening.`,
    );
    this.name = "ExportVerifyError";
  }
}

interface PlanStats {
  penetrations: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** color-block boundaries (a writer emits one color change per boundary). */
  boundaries: number;
  stops: number;
}

function planStats(plan: StitchPlan): PlanStats {
  let penetrations = 0;
  let stops = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of plan.blocks) {
    for (const c of b.cmds) {
      if (c[0] === "stop") stops++;
      if (c[0] !== "s") continue;
      penetrations++;
      if (c[1] < minX) minX = c[1];
      if (c[1] > maxX) maxX = c[1];
      if (c[2] < minY) minY = c[2];
      if (c[2] > maxY) maxY = c[2];
    }
  }
  return {
    penetrations,
    minX, minY, maxX, maxY,
    boundaries: Math.max(0, plan.blocks.length - 1),
    stops,
  };
}

function checkPenetrations(
  decoded: { x: number; y: number; jump: boolean }[],
  expect: PlanStats,
): void {
  const pen = decoded.filter((s) => !s.jump);
  if (pen.length !== expect.penetrations) {
    throw new ExportVerifyError(
      `stitch count: wrote ${expect.penetrations}, file decodes to ${pen.length}`,
    );
  }
  if (pen.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of pen) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  if (minX !== expect.minX || minY !== expect.minY || maxX !== expect.maxX || maxY !== expect.maxY) {
    throw new ExportVerifyError(
      `design bounds: wrote [${expect.minX},${expect.minY}]…[${expect.maxX},${expect.maxY}], ` +
        `file decodes to [${minX},${minY}]…[${maxX},${maxY}] (1/10 mm)`,
    );
  }
}

/** Verify freshly encoded DST/T01 bytes against the (already split) plan.
 *  STOPs encode as extra color-change records in this family, so the expected
 *  color-change count is block boundaries + stops. */
export function verifyTernaryBytes(bytes: Uint8Array, plan: StitchPlan): void {
  const decoded = decodeTernaryStitches(bytes);
  const stats = planStats(plan);
  // A color-change record is neither a jump nor a penetration — exclude it from
  // the stitch comparison (it decodes with jump=false).
  checkPenetrations(decoded.filter((s) => !s.colorChange), stats);
  const changes = decoded.filter((s) => s.colorChange).length;
  const expected = stats.boundaries + stats.stops;
  if (changes !== expected) {
    throw new ExportVerifyError(
      `color changes: wrote ${expected}, file decodes to ${changes}`,
    );
  }
}

/** Verify freshly encoded PES (v1) bytes against the (already split) plan by
 *  decoding the embedded PEC stitch stream. */
export function verifyPesBytes(bytes: Uint8Array, plan: StitchPlan): void {
  checkPenetrations(decodePecStitches(bytes), planStats(plan));
}
