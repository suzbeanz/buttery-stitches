/**
 * PES v1 oracle — step 2 (plain node): load Pyodide + pyembroidery and compare
 * the native writer's bytes (from /tmp/pes-mine.json) against pyembroidery's
 * write_pes(version=1), plus a read-back equivalence check. Run after
 * oracle-pes.ts (vite-node can't resolve Pyodide's internal modules).
 *
 *   vite-node scripts/oracle-pes.ts && node scripts/oracle-pes.mjs
 *
 * The PASS bar is FUNCTIONAL equivalence: identical STITCH penetration points
 * (in order), identical COLOR_CHANGE count/positions, identical thread RGB list.
 * Needle-up JUMP intermediate waypoints may differ by <=1 unit (ignored, like
 * the DST oracle did via filter(s => s[2] !== 1)); thumbnail pixels are ignored.
 *
 * Pass --dump to print pyembroidery's raw PES v1 structure for the first plan
 * (handy when reverse-engineering the layout).
 */
import { loadPyodide } from "pyodide";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WHEELS = [["packaging", "24.2"], ["micropip", "0.9.0"], ["pyembroidery", "1.5.1"]];

async function fetchWheel(dir, name, version) {
  const meta = await fetch(`https://pypi.org/pypi/${name}/${version}/json`).then((r) => r.json());
  const file = meta.urls.find((u) => u.filename.endsWith("-none-any.whl"));
  const buf = new Uint8Array(await fetch(file.url).then((r) => r.arrayBuffer()));
  const path = join(dir, file.filename);
  await writeFile(path, buf);
  return pathToFileURL(path).href;
}

const PY = `
import io, json
import pyembroidery as pe
def build(plan):
    p = pe.EmbPattern()
    for i, b in enumerate(plan["blocks"]):
        if i > 0:
            p.add_command(pe.TRIM); p.add_command(pe.COLOR_CHANGE)
        p.add_thread({"rgb": int(b["rgb"])})
        for c in b["cmds"]:
            k = c[0]
            if k == "s": p.add_stitch_absolute(pe.STITCH, int(c[1]), int(c[2]))
            elif k == "j": p.add_stitch_absolute(pe.JUMP, int(c[1]), int(c[2]))
            elif k == "t": p.add_command(pe.TRIM)
            elif k == "stop": p.add_command(pe.STOP)
    p.add_command(pe.END)
    return p
def write_pes(plan_json, version):
    p = build(json.loads(plan_json)); buf = io.BytesIO(); pe.write_pes(p, buf, {"version": int(version)}); return list(buf.getvalue())
def read_back(data):
    p = pe.read_pes(io.BytesIO(bytes(data)))
    threads = []
    for t in p.threadlist:
        try: threads.append((t.get_red() << 16) | (t.get_green() << 8) | t.get_blue())
        except Exception: threads.append(int(getattr(t, "color", 0)) & 0xFFFFFF)
    return json.dumps({
        "stitches": [[int(x), int(y), int(c) & 0xFF] for (x, y, c) in p.stitches],
        "threads": threads,
    })
`;

const hex = (a, off, n) => Array.from(a.slice(off, off + Math.min(n, a.length - off))).map((b) => b.toString(16).padStart(2, "0")).join(" ");
const ascii = (a, off, n) => Array.from(a.slice(off, off + Math.min(n, a.length - off))).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
const u32 = (a, off) => (a[off] | (a[off + 1] << 8) | (a[off + 2] << 16) | (a[off + 3] << 24)) >>> 0;

const cases = JSON.parse(await readFile("/tmp/pes-mine.json", "utf8"));
const dir = await mkdtemp(join(tmpdir(), "pes-oracle-"));
const urls = await Promise.all(WHEELS.map(([n, v]) => fetchWheel(dir, n, v)));
const py = await loadPyodide();
await py.loadPackage([urls[0], urls[1]]);
await py.runPythonAsync(`import micropip\nawait micropip.install("${urls[2]}")`);
await py.runPythonAsync(PY);
const pyWrite = py.globals.get("write_pes");
const pyRead = py.globals.get("read_back");

const DUMP = process.argv.includes("--dump");
if (DUMP) {
  const { split } = cases[1] ?? cases[0];
  const ref = Uint8Array.from(pyWrite(JSON.stringify(split), 1).toJs());
  console.log(`\n=== DUMP pyembroidery PES v1 (${cases[1] ? cases[1].name : cases[0].name}) ===`);
  console.log(`total length: ${ref.length}`);
  const pec = u32(ref, 8);
  console.log(`PEC pointer (u32 @8): ${pec}`);
  for (const m of ["#PES", "CEmbOne", "CSewSeg", "LA:"]) {
    const idx = Buffer.from(ref).indexOf(Buffer.from(m, "latin1"));
    console.log(`marker ${m}: @${idx}`);
  }
  console.log(`\n-- PES section (0..${pec}) --`);
  for (let o = 0; o < pec; o += 16) console.log(`  @${String(o).padStart(4)}: ${hex(ref, o, 16).padEnd(48)}  ${ascii(ref, o, 16)}`);
  console.log(`\n-- PEC block (@${pec}..end) --`);
  for (let o = pec; o < ref.length; o += 16) console.log(`  @${String(o).padStart(4)}: ${hex(ref, o, 16).padEnd(48)}  ${ascii(ref, o, 16)}`);
}

let allPass = true;
const rows = [];
for (const { name, split, mine: mineArr } of cases) {
  const mine = Uint8Array.from(mineArr);
  const ref = Uint8Array.from(pyWrite(JSON.stringify(split), 1).toJs());
  let firstDiff = -1;
  for (let i = 0; i < Math.max(mine.length, ref.length); i++) if (mine[i] !== ref[i]) { firstDiff = i; break; }
  const bytesMatch = firstDiff === -1 && mine.length === ref.length;

  const mineDec = JSON.parse(pyRead(Array.from(mine)));
  const refDec = JSON.parse(pyRead(Array.from(ref)));
  // Functional signature: STITCH penetrations (cmd 0) + COLOR_CHANGE (cmd) +
  // STOP + END, ignoring needle-up JUMP waypoints (cmd 1) and TRIM jitter.
  const sig = (st) => st.filter((s) => s[2] !== 1).map((s) => `${s[2]}:${s[0]},${s[1]}`).join(" ");
  const stitchMatch = sig(mineDec.stitches) === sig(refDec.stitches);
  const threadMatch = JSON.stringify(mineDec.threads) === JSON.stringify(refDec.threads);
  const colorChanges = (st) => st.filter((s) => s[2] === 0xe6 /*COLOR_CHANGE*/).length;
  const ccMatch = colorChanges(mineDec.stitches) === colorChanges(refDec.stitches);
  const functionalMatch = stitchMatch && threadMatch;
  allPass = allPass && functionalMatch;

  console.log(`\n## ${name}`);
  console.log(`   lengths mine=${mine.length} ref=${ref.length}`);
  console.log(`   bytes identical: ${bytesMatch}${bytesMatch ? "" : ` (first diff @${firstDiff})`}`);
  console.log(`   read-back stitches mine=${mineDec.stitches.length} ref=${refDec.stitches.length}`);
  console.log(`   STITCH penetrations identical: ${stitchMatch}`);
  console.log(`   thread RGB list identical: ${threadMatch} (mine ${JSON.stringify(mineDec.threads)} ref ${JSON.stringify(refDec.threads)})`);
  console.log(`   color-change count identical: ${ccMatch}`);
  console.log(`   FUNCTIONAL (stitches+colors): ${functionalMatch}`);
  if (!bytesMatch && firstDiff >= 0) {
    const a = Math.max(0, firstDiff - 4);
    console.log(`     mine @${a}: ${hex(mine, a, 16)}`);
    console.log(`     ref  @${a}: ${hex(ref, a, 16)}`);
  }
  if (!stitchMatch) {
    const fmt = (st) => st.filter((s) => s[2] !== 1).map((s) => `${s[2]}:${s[0]},${s[1]}`).join(" ");
    console.log(`     mine: ${fmt(mineDec.stitches)}`);
    console.log(`     ref : ${fmt(refDec.stitches)}`);
  }
  rows.push({ name, bytesMatch, functionalMatch });
}

console.log(`\n=== SUMMARY ===`);
for (const r of rows) console.log(`  ${r.functionalMatch ? "✅" : "❌"} ${r.name}  (bytes ${r.bytesMatch ? "identical" : "differ"})`);
console.log(`\n${allPass ? "✅ ALL PASS" : "❌ MISMATCH — see diffs"}\n`);
process.exit(allPass ? 0 : 1);
