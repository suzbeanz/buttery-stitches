import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeDst, encodeT01 } from "./dst";
import { encodePes } from "./pes";
import { decodePecStitches } from "./pec-decode";
import { decodeTernaryPlan, decodeTernaryStitches } from "./ternary-decode";
import type { StitchPlan } from "../index";

/**
 * THIRD-PARTY reference fixtures — the audit's top testing gap was that the
 * round-trip only ever decoded bytes this app produced, so an encoder+decoder
 * bug that agreed with itself was invisible. These fixtures were written by
 * CPython pyembroidery 1.5.1 (the reference implementation, fully independent
 * of the TS writers) from the committed plan; regenerate with
 * `python3 scripts/gen-reference-fixtures.py`.
 */

const FIX = join(__dirname, "__fixtures__");
const plan = JSON.parse(readFileSync(join(FIX, "reference-plan.json"), "utf8")) as StitchPlan;
const refDst = new Uint8Array(readFileSync(join(FIX, "reference.dst")));
const refPes = new Uint8Array(readFileSync(join(FIX, "reference-v1.pes")));

const planPenetrations = plan.blocks.flatMap((b) =>
  b.cmds.filter((c) => c[0] === "s").map((c) => [c[1], c[2]] as const),
);

/** Origin-normalized penetration sequence (PES files are origin-anchored). */
function normalizedPenetrations(bytes: Uint8Array): [number, number][] {
  const pen = decodePecStitches(bytes).filter((s) => !s.jump);
  const mx = Math.min(...pen.map((s) => s.x));
  const my = Math.min(...pen.map((s) => s.y));
  return pen.map((s) => [s.x - mx, s.y - my]);
}

describe("reference fixtures (pyembroidery-written, independent of our writers)", () => {
  it("our PEC decoder reads a THIRD-PARTY PES file back to the exact plan", () => {
    // This is the self-referential-loop breaker: the bytes were produced by
    // pyembroidery, never by our encoder.
    expect(normalizedPenetrations(refPes)).toEqual(planPenetrations);
  });

  it("our PES encoder is functionally identical to pyembroidery's for the plan", () => {
    expect(normalizedPenetrations(encodePes(plan))).toEqual(normalizedPenetrations(refPes));
  });

  it("our DST stitch section is byte-identical to pyembroidery's", () => {
    const ours = encodeDst(plan);
    expect(ours.length).toBe(refDst.length);
    // Stitch records start after the fixed 512-byte header.
    expect(Array.from(ours.slice(512))).toEqual(Array.from(refDst.slice(512)));
  });

  it("our DST header matches pyembroidery field-for-field except the advisory ST count", () => {
    const ours = new TextDecoder().decode(encodeDst(plan).slice(0, 125));
    const ref = new TextDecoder().decode(refDst.slice(0, 125));
    const fields = (h: string) =>
      Object.fromEntries(
        [...h.matchAll(/([A-Z+-]{2}):([^\r]*)/g)].map((m) => [m[1], m[2].trim()]),
      );
    const a = fields(ours);
    const b = fields(ref);
    // ST is informational and writer-specific (pyembroidery counts commands,
    // we count penetrations); everything a machine positions by must agree.
    for (const key of ["LA", "CO", "+X", "-X", "+Y", "-Y", "AX", "AY"]) {
      expect(a[key], `header field ${key}`).toBe(b[key]);
    }
  });
});

describe("T01 (native): the DST record stream without the header", () => {
  it("encodeT01 equals the reference DST's stitch section byte-for-byte", () => {
    // reference.dst was written by pyembroidery; its post-header bytes ARE the
    // T01 encoding of the plan — a third-party check of the whole T01 writer.
    expect(Array.from(encodeT01(plan))).toEqual(Array.from(refDst.slice(512)));
  });

  it("a machine STOP encodes as the DST-family color-change pause instead of throwing", () => {
    const withStop: StitchPlan = {
      blocks: [
        { rgb: 0xff0000, cmds: [["s", 0, 0], ["s", 30, 0], ["stop"], ["s", 60, 0]] },
      ],
    };
    const bytes = encodeT01(withStop);
    const decoded = decodeTernaryStitches(bytes);
    expect(decoded.some((s) => s.colorChange)).toBe(true); // the pause is there
    expect(decoded.filter((s) => !s.jump && !s.colorChange).length).toBe(3);
  });
});

describe("native ternary decoder (DST + T01 import without Pyodide)", () => {
  it("decodes the THIRD-PARTY reference DST back to the exact plan penetrations", () => {
    const decoded = decodeTernaryStitches(refDst);
    const pen = decoded.filter((s) => !s.jump && !s.colorChange).map((s) => [s.x, s.y]);
    expect(pen).toEqual(planPenetrations.map(([x, y]) => [x, y]));
  });

  it("round-trips our own T01 bytes to the same plan", () => {
    const decoded = decodeTernaryStitches(encodeT01(plan));
    const pen = decoded.filter((s) => !s.jump && !s.colorChange).map((s) => [s.x, s.y]);
    expect(pen).toEqual(planPenetrations.map(([x, y]) => [x, y]));
  });

  it("builds an ImportedPlan with the right block/run structure", () => {
    const imported = decodeTernaryPlan(refDst);
    expect(imported.blocks).toHaveLength(2); // the plan's two colors
    // First block: 3 runs (jump + trim split the stream in two places).
    expect(imported.blocks[0].runs).toHaveLength(3);
    expect(imported.blocks[1].runs).toHaveLength(1);
    // Every point matches a plan penetration, in order.
    const flat = imported.blocks.flatMap((b) => b.runs.flat());
    expect(flat).toEqual(planPenetrations.map(([x, y]) => [x, y]));
    // Placeholder colors are distinct (DST stores none).
    expect(imported.blocks[0].rgb).not.toBe(imported.blocks[1].rgb);
  });

  it("rejects too-short input and survives truncation/garbage without hanging", () => {
    expect(() => decodeTernaryStitches(new Uint8Array(2))).toThrow(/too short/i);
    const whole = encodeT01(plan);
    for (let len = 3; len <= whole.length; len += 5) {
      const out = decodeTernaryStitches(whole.slice(0, len));
      expect(out.length).toBeLessThanOrEqual(whole.length / 3);
    }
    // Seeded garbage: must terminate with bounded output.
    let seed = 0xbeef;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16) & 0xff;
    const junk = new Uint8Array(3000);
    for (let i = 0; i < junk.length; i++) junk[i] = rnd();
    const out = decodeTernaryStitches(junk);
    expect(out.length).toBeLessThanOrEqual(1000);
  });
});

describe("PEC decoder robustness (malformed bytes must not hang or corrupt)", () => {
  it("rejects bytes with no PEC marker", () => {
    expect(() => decodePecStitches(new Uint8Array(64))).toThrow(/marker/i);
  });

  it("survives truncation at every length without hanging", () => {
    const whole = encodePes(plan);
    for (let len = 0; len <= whole.length; len += 7) {
      const cut = whole.slice(0, len);
      try {
        const out = decodePecStitches(cut);
        // Whatever decodes must be bounded and finite.
        expect(out.length).toBeLessThanOrEqual(whole.length);
        for (const s of out.slice(-3)) {
          expect(Number.isFinite(s.x)).toBe(true);
          expect(Number.isFinite(s.y)).toBe(true);
        }
      } catch (err) {
        expect(err).toBeInstanceOf(Error); // graceful rejection is fine
      }
    }
  });

  it("survives seeded random garbage after a valid marker", () => {
    // Deterministic LCG so a failure is reproducible.
    let seed = 0x2f6e2b1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16) & 0xff;
    for (let trial = 0; trial < 25; trial++) {
      const junk = new Uint8Array(600);
      junk.set([0x31, 0xff, 0xf0], 8); // marker somewhere near the front
      for (let i = 19; i < junk.length; i++) junk[i] = rnd();
      const out = decodePecStitches(junk); // must terminate
      expect(out.length).toBeLessThan(600);
    }
  });
});
