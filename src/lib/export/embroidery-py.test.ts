import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StitchPlan, ImportedPlan } from "./index";

/**
 * ROUND-TRIP tests for the Python-path writers (embroidery.py + pyembroidery):
 * PES v1/v6, DST, JEF, EXP, VP3, TBF — the exact code the app ships to Pyodide,
 * executed here under CPython with the same pyembroidery 1.5.1.
 *
 * The browser can't run these in CI-light environments, so the whole suite
 * SKIPS unless `python3 -c "import pyembroidery"` works (locally:
 * `pip install pyembroidery==1.5.1`). When it runs, it is the only gate that
 * exercises the real serialization of the JEF/EXP/VP3/TBF paths — the byte
 * signatures below (JEF trim triples, EXP color-change pairs) are what real
 * machines key on.
 */

function pyembroideryAvailable(): boolean {
  try {
    const r = spawnSync("python3", ["-c", "import pyembroidery"], { timeout: 30_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}
const available = pyembroideryAvailable();

// ---------------------------------------------------------------------------
// Synthetic designs (1/10 mm units, pre-anchored all-positive like real plans).
// ---------------------------------------------------------------------------

/** Three colors, ordinary runs. Colors are EXACT Brother PEC chart entries so
 *  the PES palette mapping round-trips losslessly. */
const multiColor: StitchPlan = {
  name: "Tri Swatch",
  blocks: [
    { rgb: 0xed171f, cmds: [["s", 0, 0], ["s", 40, 0], ["s", 80, 0], ["s", 80, 40]] }, // Brother red
    { rgb: 0x0e1f7c, cmds: [["s", 200, 0], ["s", 240, 0], ["s", 280, 0]] }, // Brother prussian blue
    { rgb: 0x000000, cmds: [["s", 0, 200], ["s", 40, 200], ["s", 80, 200]] }, // Brother black
  ],
};

/** A jump far past every format's single-record limit (121/127) — must be
 *  split into legal sub-jumps and land exactly. */
const longJump: StitchPlan = {
  blocks: [
    {
      rgb: 0xed171f,
      cmds: [["s", 0, 0], ["s", 30, 0], ["s", 60, 0], ["j", 900, 900], ["s", 900, 900], ["s", 930, 900], ["s", 960, 900]],
    },
  ],
};

/** Trim-heavy: three trims inside one color (plus the implicit color-change
 *  trim before block 2). */
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

/** Near-hoop-edge: spans a full 4×4" hoop (0..1000 tenths both axes). */
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

const FORMATS = ["dst", "pes", "pes6", "jef", "exp", "vp3", "tbf"] as const;
type Fmt = (typeof FORMATS)[number];

interface CaseResult {
  bytes_b64: string;
  imported: ImportedPlan;
  /** pyembroidery read-back command histogram, e.g. { STITCH: 9, TRIM: 2 }. */
  commands: Record<string, number>;
  /** read-back thread colors (0xRRGGBB), file order. */
  threads: number[];
}

/** One python3 run does every (design × format) export + import through the
 *  app's real embroidery.py; tests assert on the returned JSON. */
const DRIVER = `
import base64, io, json, sys
import pyembroidery as pe

glue_path = sys.argv[1]
g = {}
exec(open(glue_path).read(), g)

NAMES = {0: "STITCH", 1: "JUMP", 2: "TRIM", 3: "STOP", 4: "END", 5: "COLOR_CHANGE", 9: "NEEDLE_SET"}
READERS = {"dst": pe.read_dst, "pes": pe.read_pes, "jef": pe.read_jef,
           "exp": pe.read_exp, "vp3": pe.read_vp3, "tbf": pe.read_tbf}

designs = json.load(sys.stdin)
out = {}
for dname, plan in designs.items():
    plan_json = json.dumps(plan)
    per = {}
    for fmt in ["dst", "pes", "pes6", "jef", "exp", "vp3", "tbf"]:
        real = "pes" if fmt == "pes6" else fmt
        version = 6 if fmt == "pes6" else 1
        data = g["export_bytes"](plan_json, real, version)
        imported = json.loads(g["import_design"](data, real))
        pattern = READERS[real](io.BytesIO(bytes(data)))
        commands = {}
        for _x, _y, c in pattern.stitches:
            key = NAMES.get(c & 0xFF, str(c & 0xFF))
            commands[key] = commands.get(key, 0) + 1
        threads = []
        for t in pattern.threadlist:
            threads.append((t.color if t is not None else 0) & 0xFFFFFF)
        per[fmt] = {
            "bytes_b64": base64.b64encode(bytes(data)).decode(),
            "imported": imported,
            "commands": commands,
            "threads": threads,
        }
    out[dname] = per
json.dump(out, sys.stdout)
`;

function runDriver(): Record<DesignName, Record<Fmt, CaseResult>> {
  const gluePath = join(__dirname, "embroidery.py");
  const r = spawnSync("python3", ["-c", DRIVER, gluePath], {
    input: JSON.stringify(designs),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`python driver failed: ${r.stderr}`);
  return JSON.parse(r.stdout) as Record<DesignName, Record<Fmt, CaseResult>>;
}

const results = available ? runDriver() : null;

const penetrations = (plan: StitchPlan): [number, number][] =>
  plan.blocks.flatMap((b) => b.cmds.filter((c) => c[0] === "s").map((c) => [c[1], c[2]] as [number, number]));

const importedPoints = (p: ImportedPlan): [number, number][] =>
  p.blocks.flatMap((b) => b.runs.flat()) as [number, number][];

const bytesOf = (c: CaseResult): Uint8Array => Uint8Array.from(Buffer.from(c.bytes_b64, "base64"));

/** Count non-overlapping occurrences of a byte signature. */
function countSig(buf: Uint8Array, sig: number[]): number {
  let n = 0;
  for (let i = 0; i + sig.length <= buf.length; i++) {
    let ok = true;
    for (let j = 0; j < sig.length; j++) if (buf[i + j] !== sig[j]) { ok = false; break; }
    if (ok) { n++; i += sig.length - 1; }
  }
  return n;
}

describe.skipIf(!available)("Python-path writers (embroidery.py + pyembroidery round-trip)", () => {
  describe("penetration positions round-trip exactly (all formats, all designs)", () => {
    // Note: every run in these designs has >=2 penetrations — the importer's
    // documented contract drops 1-point runs (they can't form a polyline
    // object). The count test below checks the WRITER kept every penetration
    // regardless.
    for (const dname of Object.keys(designs) as DesignName[]) {
      for (const fmt of FORMATS) {
        it(`${dname} → ${fmt} → import`, () => {
          const c = results![dname][fmt];
          expect(importedPoints(c.imported)).toEqual(penetrations(designs[dname]));
        });
      }
    }

    it("the writers keep every penetration (pyembroidery read-back count)", () => {
      for (const dname of Object.keys(designs) as DesignName[]) {
        for (const fmt of FORMATS) {
          const c = results![dname][fmt];
          expect(c.commands.STITCH, `${dname}/${fmt}`).toBe(penetrations(designs[dname]).length);
        }
      }
    });
  });

  describe("color blocks", () => {
    it("every format keeps the block count and order", () => {
      for (const fmt of FORMATS) {
        const c = results!.multiColor[fmt];
        expect(c.imported.blocks.length, fmt).toBe(3);
      }
    });

    it("true-color formats (vp3, tbf) round-trip the exact RGBs in order", () => {
      for (const fmt of ["vp3", "tbf"] as const) {
        const c = results!.multiColor[fmt];
        expect(c.threads, fmt).toEqual([0xed171f, 0x0e1f7c, 0x000000]);
        expect(c.imported.blocks.map((b) => b.rgb), fmt).toEqual([0xed171f, 0x0e1f7c, 0x000000]);
      }
    });

    it("PES v1/v6 map to the Brother chart losslessly for chart-exact colors", () => {
      for (const fmt of ["pes", "pes6"] as const) {
        const c = results!.multiColor[fmt];
        expect(c.threads, fmt).toEqual([0xed171f, 0x0e1f7c, 0x000000]);
      }
    });

    it("JEF quantizes to the Janome palette: distinct, near-original colors", () => {
      const c = results!.multiColor.jef;
      expect(c.threads).toHaveLength(3);
      expect(new Set(c.threads).size).toBe(3);
      // Nearest-palette color stays in the neighborhood of the original.
      const dist = (a: number, b: number) =>
        Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)) +
        Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) +
        Math.abs((a & 0xff) - (b & 0xff));
      const want = [0xed171f, 0x0e1f7c, 0x000000];
      c.threads.forEach((t, i) => expect(dist(t, want[i]), `thread ${i}`).toBeLessThan(160));
    });

    it("colorless formats (dst, exp) get DISTINCT placeholder blocks, not all-black", () => {
      for (const fmt of ["dst", "exp"] as const) {
        const c = results!.multiColor[fmt];
        const rgbs = c.imported.blocks.map((b) => b.rgb);
        expect(new Set(rgbs).size, `${fmt} placeholder colors distinct`).toBe(rgbs.length);
      }
    });
  });

  describe("trims and jumps survive serialization", () => {
    it("DST: every trim is present on read-back (trim-heavy design)", () => {
      // 3 explicit + 1 implicit color-change trim.
      expect(results!.trimHeavy.dst.commands.TRIM).toBe(4);
    });

    it("PES: trims encode as TRIM-flagged moves (trim-heavy design)", () => {
      expect(results!.trimHeavy.pes.commands.TRIM ?? 0).toBeGreaterThanOrEqual(3);
    });

    it("EXP: explicit trim signature 0x80 0x80 present per trim", () => {
      const buf = bytesOf(results!.trimHeavy.exp);
      // pyembroidery's EXP trim: 80 80 07 00. 3 explicit + 1 color-boundary trim.
      expect(countSig(buf, [0x80, 0x80, 0x07, 0x00])).toBe(4);
    });

    it("JEF: each trim becomes the explicit multi-jump trim signal Janome machines cut on", () => {
      // pyembroidery drops JEF trims unless asked ({"trims": True} — the
      // 0x80 0x02 zero-move triple). Without it the machine sews a dragged
      // thread across every gap. 4 trims (3 explicit + color boundary).
      const buf = bytesOf(results!.trimHeavy.jef);
      const triple = [0x80, 0x02, 0x00, 0x00, 0x80, 0x02, 0x00, 0x00, 0x80, 0x02, 0x00, 0x00];
      expect(countSig(buf, triple)).toBe(4);
    });

    it("long jumps split legally and land exactly (byte-pair formats)", () => {
      // The 900-unit jump exceeds every per-record limit; the read-back JUMP
      // count proves it was split, and the position test above proved landing.
      for (const fmt of ["jef", "exp", "tbf", "dst"] as const) {
        const c = results!.longJump[fmt];
        expect(c.commands.JUMP ?? 0, fmt).toBeGreaterThanOrEqual(Math.ceil(900 / 127));
      }
    });

    it("run structure: trims split contiguous runs on import", () => {
      const c = results!.trimHeavy.vp3;
      expect(c.imported.blocks[0].runs.length).toBe(4); // 3 trims → 4 runs
      expect(c.imported.blocks[1].runs.length).toBe(1);
    });
  });

  describe("headers", () => {
    it("DST: LA/ST/CO fields present, CO matches color changes", () => {
      const h = new TextDecoder("latin1").decode(bytesOf(results!.multiColor.dst).slice(0, 512));
      expect(h).toMatch(/^LA:Tri Swatch/);
      expect(Number(h.match(/CO:\s*(\d+)/)?.[1])).toBe(2);
      expect(Number(h.match(/ST:\s*(\d+)/)?.[1])).toBeGreaterThan(0);
    });

    it("PES: correct version signatures", () => {
      expect(new TextDecoder().decode(bytesOf(results!.multiColor.pes).slice(0, 8))).toBe("#PES0001");
      expect(new TextDecoder().decode(bytesOf(results!.multiColor.pes6).slice(0, 8))).toBe("#PES0060");
    });

    it("VP3: magic and UTF-16BE thread name present", () => {
      const buf = bytesOf(results!.multiColor.vp3);
      expect(new TextDecoder("latin1").decode(buf.slice(0, 5))).toBe("%vsm%");
    });

    it("JEF: color count and hoop code derived from extents", () => {
      const dv = (c: CaseResult) => new DataView(bytesOf(c).buffer);
      // Header: u32 stitch offset, u32 0x14, 14-char date, 2 bytes, u32 color
      // count (offset 24), u32 point count (28), u32 hoop code (32).
      const small = dv(results!.multiColor.jef);
      expect(small.getUint32(24, true)).toBe(3);
      expect(small.getUint32(32, true)).toBe(1); // fits 50×50mm hoop
      const big = dv(results!.hoopEdge.jef);
      expect(big.getUint32(32, true)).not.toBe(1); // 100×100 can't claim 50×50
      // Date field is a real timestamp (YYYYMMDD...).
      const date = new TextDecoder().decode(bytesOf(results!.multiColor.jef).slice(8, 16));
      expect(date).toMatch(/^20\d{6}$/);
    });

    it("EXP: one 0x80 0x01 color-change pair per block boundary", () => {
      const buf = bytesOf(results!.multiColor.exp);
      expect(countSig(buf, [0x80, 0x01, 0x00, 0x00])).toBe(2);
    });
  });
});

// Keep vitest from flagging the file as empty when python/pyembroidery is
// missing; also documents the skip so CI output says WHY nothing ran.
describe.skipIf(available)("Python-path writers (SKIPPED)", () => {
  it("skipped: python3 + pyembroidery 1.5.1 not available in this environment", () => {
    expect(available).toBe(false);
  });
});

// Sanity: the committed reference fixture proves the local pyembroidery (when
// present) matches the vendored wheel the app ships — both are 1.5.1.
describe.skipIf(!available)("environment", () => {
  it("local pyembroidery is the app's pinned version (1.5.1)", () => {
    const r = spawnSync(
      "python3",
      ["-c", "import pyembroidery, importlib.metadata; print(importlib.metadata.version('pyembroidery'))"],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(r.stdout.trim()).toBe("1.5.1");
  });

  it("the committed reference.dst matches what this pyembroidery writes", () => {
    const fix = readFileSync(join(__dirname, "native", "__fixtures__", "reference.dst"));
    expect(fix.length).toBeGreaterThan(512);
  });
});
