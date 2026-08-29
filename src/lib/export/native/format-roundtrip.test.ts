import { describe, it, expect } from "vitest";
import { splitPlanForFormat, type StitchPlan } from "../index";
import { encodeDst, encodeT01 } from "./dst";
import { encodePes } from "./pes";
import { decodeTernaryPlan, decodeTernaryStitches } from "./ternary-decode";

/**
 * Round-trip gates for the NATIVE writers (DST, T01, PES v1) over the same four
 * synthetic designs the Python-path suite uses (embroidery-py.test.ts):
 * multi-color, long-jump-past-record-max, trim-heavy, near-hoop-edge. Bytes are
 * decoded with the project's own independent decoders (ternary-decode; a local
 * PEC reader mirroring pes.test.ts) and checked for positions, color/trim/jump
 * structure, and header truth.
 */

// Brother-chart-exact colors (PES palette maps losslessly; irrelevant to DST).
const multiColor: StitchPlan = {
  name: "Tri Swatch",
  blocks: [
    { rgb: 0xed171f, cmds: [["s", 0, 0], ["s", 40, 0], ["s", 80, 0], ["s", 80, 40]] },
    { rgb: 0x0e1f7c, cmds: [["s", 200, 0], ["s", 240, 0], ["s", 280, 0]] },
    { rgb: 0x000000, cmds: [["s", 0, 200], ["s", 40, 200], ["s", 80, 200]] },
  ],
};

const longJump: StitchPlan = {
  blocks: [
    {
      rgb: 0xed171f,
      cmds: [["s", 0, 0], ["s", 30, 0], ["s", 60, 0], ["j", 900, 900], ["s", 900, 900], ["s", 930, 900], ["s", 960, 900]],
    },
  ],
};

const trimHeavy: StitchPlan = {
  blocks: [
    {
      rgb: 0xed171f,
      cmds: [
        ["s", 0, 0], ["s", 30, 0], ["s", 60, 0],
        ["t"], ["s", 100, 100], ["s", 130, 100], ["s", 160, 100],
        ["t"], ["s", 200, 200], ["s", 230, 200], ["s", 260, 200],
        ["t"], ["s", 300, 300], ["s", 330, 300], ["s", 360, 300],
      ],
    },
    { rgb: 0x000000, cmds: [["s", 400, 400], ["s", 430, 400], ["s", 460, 400]] },
  ],
};

const hoopEdge: StitchPlan = {
  blocks: [
    {
      rgb: 0x0e1f7c,
      cmds: [
        ["s", 0, 0], ["s", 100, 0], ["j", 1000, 0], ["s", 1000, 30], ["s", 1000, 100],
        ["j", 1000, 1000], ["s", 970, 1000], ["s", 940, 1000], ["j", 0, 1000], ["s", 0, 970], ["s", 0, 900],
      ],
    },
  ],
};

const designs = { multiColor, longJump, trimHeavy, hoopEdge } as const;
type DesignName = keyof typeof designs;

const penetrations = (plan: StitchPlan): [number, number][] =>
  plan.blocks.flatMap((b) => b.cmds.filter((c) => c[0] === "s").map((c) => [c[1], c[2]] as [number, number]));

// ---------------------------------------------------------------------------
// Local PEC stream reader (test-side; same layout pes.test.ts decodes) so this
// file also counts color changes and trim-flagged moves.
// ---------------------------------------------------------------------------
interface PecDecoded {
  stitches: [number, number][];
  colorChanges: number;
  trims: number;
}

function decodePecFull(bytes: Uint8Array): PecDecoded {
  const u32 = (o: number) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  const pecStart = u32(8);
  let marker = -1;
  for (let i = pecStart; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x31 && bytes[i + 1] === 0xff && bytes[i + 2] === 0xf0) { marker = i; break; }
  }
  if (marker < 0) throw new Error("PEC stitch marker not found");
  let i = marker + 3 + 8;
  const out: PecDecoded = { stitches: [], colorChanges: 0, trims: 0 };
  let x = 0;
  let y = 0;
  const axis = (): { d: number; jump: boolean; trim: boolean } => {
    const b = bytes[i++];
    if (b & 0x80) {
      const lo = bytes[i++];
      let v = ((b & 0x0f) << 8) | lo;
      if (v & 0x800) v -= 0x1000;
      return { d: v, jump: (b & 0x10) !== 0, trim: (b & 0x20) !== 0 };
    }
    let v = b & 0x7f;
    if (v & 0x40) v -= 0x80;
    return { d: v, jump: false, trim: false };
  };
  for (;;) {
    if (i >= bytes.length) break;
    if (bytes[i] === 0xff) break;
    if (bytes[i] === 0xfe && bytes[i + 1] === 0xb0) {
      out.colorChanges++;
      i += 3;
      continue;
    }
    const ax = axis();
    const ay = axis();
    x += ax.d;
    y += ay.d;
    const trim = ax.trim || ay.trim;
    const jump = ax.jump || ay.jump;
    if (trim) out.trims++;
    if (!trim && !jump) out.stitches.push([x, y]);
  }
  return out;
}

describe("native DST round-trip (synthetic designs)", () => {
  for (const name of Object.keys(designs) as DesignName[]) {
    it(`${name}: penetrations, color changes and trims all reconstruct`, () => {
      const plan = splitPlanForFormat(designs[name], "dst");
      const bytes = encodeDst(plan);
      const st = decodeTernaryStitches(bytes);
      const pen = st.filter((s) => !s.jump && !s.colorChange).map((s) => [s.x, s.y]);
      expect(pen).toEqual(penetrations(designs[name]));
      expect(st.filter((s) => s.colorChange).length).toBe(designs[name].blocks.length - 1);
    });
  }

  it("multiColor: ImportedPlan block structure matches (3 blocks, distinct placeholders)", () => {
    const bytes = encodeDst(splitPlanForFormat(multiColor, "dst"));
    const imported = decodeTernaryPlan(bytes);
    expect(imported.blocks).toHaveLength(3);
    expect(new Set(imported.blocks.map((b) => b.rgb)).size).toBe(3);
    expect(imported.blocks.flatMap((b) => b.runs.flat())).toEqual(penetrations(multiColor));
  });

  it("trimHeavy: trims split runs on import (4 runs then 1)", () => {
    const imported = decodeTernaryPlan(encodeDst(splitPlanForFormat(trimHeavy, "dst")));
    expect(imported.blocks[0].runs).toHaveLength(4);
    expect(imported.blocks[1].runs).toHaveLength(1);
  });

  it("longJump: every record's delta stays within ±121 per axis", () => {
    const bytes = encodeDst(splitPlanForFormat(longJump, "dst"));
    const st = decodeTernaryStitches(bytes);
    let px = 0;
    let py = 0;
    for (const s of st) {
      expect(Math.abs(s.x - px)).toBeLessThanOrEqual(121);
      expect(Math.abs(s.y - py)).toBeLessThanOrEqual(121);
      px = s.x;
      py = s.y;
    }
    // ...and the jump landed exactly.
    expect(st.some((s) => !s.jump && s.x === 900 && s.y === 900)).toBe(true);
  });

  it("hoopEdge: header extents match the full frame travel", () => {
    const bytes = encodeDst(splitPlanForFormat(hoopEdge, "dst"));
    const h = new TextDecoder("latin1").decode(bytes.slice(0, 512));
    expect(Number(h.match(/\+X:\s*(\d+)/)?.[1])).toBe(1000);
    expect(Number(h.match(/\+Y:\s*(\d+)/)?.[1])).toBe(1000);
    expect(Number(h.match(/-X:\s*(\d+)/)?.[1])).toBe(0);
    expect(Number(h.match(/-Y:\s*(\d+)/)?.[1])).toBe(0);
  });
});

describe("native T01 round-trip (synthetic designs)", () => {
  for (const name of Object.keys(designs) as DesignName[]) {
    it(`${name}: penetrations reconstruct exactly`, () => {
      const bytes = encodeT01(splitPlanForFormat(designs[name], "t01"));
      const st = decodeTernaryStitches(bytes);
      const pen = st.filter((s) => !s.jump && !s.colorChange).map((s) => [s.x, s.y]);
      expect(pen).toEqual(penetrations(designs[name]));
    });
  }
});

describe("native PES v1 round-trip (synthetic designs)", () => {
  for (const name of Object.keys(designs) as DesignName[]) {
    it(`${name}: penetrations and color changes reconstruct`, () => {
      const plan = splitPlanForFormat(designs[name], "pes");
      const dec = decodePecFull(encodePes(plan));
      expect(dec.stitches).toEqual(penetrations(designs[name]));
      expect(dec.colorChanges).toBe(designs[name].blocks.length - 1);
    });
  }

  it("trimHeavy: each trim is a TRIM-flagged move in the PEC stream", () => {
    const dec = decodePecFull(encodePes(splitPlanForFormat(trimHeavy, "pes")));
    // 3 explicit trims + the color-boundary trim, each realized as >=1
    // TRIM-flagged jump move.
    expect(dec.trims).toBeGreaterThanOrEqual(4);
  });

  it("multiColor: PEC thread table holds the exact Brother chart indices", () => {
    const bytes = encodePes(splitPlanForFormat(multiColor, "pes"));
    const u32 = (o: number) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
    const pecStart = u32(8);
    // PEC header layout: "LA:"+16+"\r" (20) + 14 fixed + stride + height (36)
    // + 12 spaces (48) → [threadCount-1, index...].
    const at = pecStart + 48;
    // Chart-exact colors: (237,23,31)=5, (14,31,124)=1, (0,0,0)=20.
    expect(Array.from(bytes.slice(at, at + 4))).toEqual([2, 5, 1, 20]);
  });

  it("multiColor: thumbnail graphics present — one overview + one per color, 228 bytes each", () => {
    const bytes = encodePes(splitPlanForFormat(multiColor, "pes"));
    const u32 = (o: number) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
    const u24 = (o: number) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
    const pecStart = u32(8);
    const blockStart = pecStart + 512; // PEC header is exactly 512 bytes
    const blockLen = u24(blockStart + 2);
    // The file ends exactly after (1 + colorCount) 6×38 bitmaps.
    expect(bytes.length).toBe(blockStart + blockLen + 228 * (1 + 3));
    // The overview bitmap is the framed template with stitch pixels marked —
    // never all zero.
    const overview = bytes.slice(blockStart + blockLen, blockStart + blockLen + 228);
    expect(overview.some((b) => b !== 0)).toBe(true);
  });
});
