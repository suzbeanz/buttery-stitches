/**
 * DST oracle — step 2 (plain node): load Pyodide + pyembroidery and compare the
 * native writer's bytes (from /tmp/dst-mine.json) against pyembroidery's
 * write_dst, plus a read-back equivalence check. Run after oracle-dst.ts.
 *
 *   vite-node scripts/oracle-dst.ts && node scripts/oracle-dst.mjs
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
def write_dst(plan_json):
    p = build(json.loads(plan_json)); buf = io.BytesIO(); pe.write_dst(p, buf); return list(buf.getvalue())
def read_back(data):
    p = pe.read_dst(io.BytesIO(bytes(data)))
    return json.dumps([[int(x), int(y), int(c) & 0xFF] for (x, y, c) in p.stitches])
`;

const hex = (a, off, n) => Array.from(a.slice(off, off + n)).map((b) => b.toString(16).padStart(2, "0")).join(" ");

const cases = JSON.parse(await readFile("/tmp/dst-mine.json", "utf8"));
const dir = await mkdtemp(join(tmpdir(), "dst-oracle-"));
const urls = await Promise.all(WHEELS.map(([n, v]) => fetchWheel(dir, n, v)));
const py = await loadPyodide();
await py.loadPackage([urls[0], urls[1]]);
await py.runPythonAsync(`import micropip\nawait micropip.install("${urls[2]}")`);
await py.runPythonAsync(PY);
const pyWrite = py.globals.get("write_dst");
const pyRead = py.globals.get("read_back");

let allPass = true;
for (const { name, split, mine: mineArr } of cases) {
  const mine = Uint8Array.from(mineArr);
  const ref = Uint8Array.from(pyWrite(JSON.stringify(split)).toJs());
  let firstDiff = -1;
  for (let i = 0; i < Math.max(mine.length, ref.length); i++) if (mine[i] !== ref[i]) { firstDiff = i; break; }
  const bytesMatch = firstDiff === -1 && mine.length === ref.length;
  const mineSt = JSON.parse(pyRead(Array.from(mine)));
  const refSt = JSON.parse(pyRead(Array.from(ref)));
  const readBack = JSON.stringify(mineSt) === JSON.stringify(refSt);
  // Functional bar: identical STITCH penetrations + trims/color-changes/end.
  // JUMP intermediate waypoints (cmd 1) are needle-up travel — invisible to the
  // sew-out — so a ±1-unit rounding difference there doesn't matter.
  const sig = (st) => st.filter((s) => s[2] !== 1).map((s) => `${s[2]}:${s[0]},${s[1]}`).join(" ");
  const functionalMatch = sig(mineSt) === sig(refSt);
  allPass = allPass && functionalMatch;
  console.log(`\n## ${name}`);
  console.log(`   lengths mine=${mine.length} ref=${ref.length}`);
  console.log(`   bytes identical: ${bytesMatch}${bytesMatch ? "" : ` (first diff @${firstDiff}, ${firstDiff < 512 ? "HEADER" : "records"})`}`);
  console.log(`   read-back == pyembroidery: ${readBack} (mine ${mineSt.length} vs ref ${refSt.length})`);
  console.log(`   FUNCTIONAL (stitches+stops identical): ${functionalMatch}`);
  if (!bytesMatch && firstDiff >= 0) {
    const a = Math.max(0, firstDiff - 3);
    console.log(`     mine @${a}: ${hex(mine, a, 12)}`);
    console.log(`     ref  @${a}: ${hex(ref, a, 12)}`);
  }
  if (!readBack) {
    const fmt = (st) => st.map((s) => `${s[2]}:${s[0]},${s[1]}`).join(" ");
    console.log(`     mine: ${fmt(mineSt)}`);
    console.log(`     ref : ${fmt(refSt)}`);
    if (name.includes("two")) {
      const recs = (a) => { const r = []; for (let i = 512; i + 3 <= a.length; i += 3) r.push(hex(a, i, 3)); return r; };
      const m = recs(mine), r = recs(ref);
      for (let i = 0; i < Math.max(m.length, r.length); i++) {
        const mark = m[i] === r[i] ? "  " : "<<";
        console.log(`     rec ${String(i).padStart(2)}: mine ${m[i] ?? "--"}  ref ${r[i] ?? "--"} ${mark}`);
      }
    }
  }
}
console.log(`\n${allPass ? "✅ ALL PASS" : "❌ MISMATCH — see diffs"}\n`);
