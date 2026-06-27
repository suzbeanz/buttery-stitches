/**
 * PES oracle (study step): dump pyembroidery's PES v1 output structure for a few
 * plans so the native writer can be built to match it. PES = a PES wrapper with
 * an embedded PEC stitch block; this prints the section markers, key offsets, and
 * hex of the header + PEC header so we can reverse the exact layout.
 *
 *   node scripts/oracle-pes.mjs
 */
import { loadPyodide } from "pyodide";
import { mkdtemp, writeFile } from "node:fs/promises";
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
def make(plan):
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
    p.add_command(pe.END)
    return p
def write_pes(plan_json, version):
    p = make(json.loads(plan_json)); buf = io.BytesIO(); pe.write_pes(p, buf, {"version": int(version)}); return list(buf.getvalue())
`;

const sq = (cx, cy, r) => [["s", cx - r, cy - r], ["s", cx + r, cy - r], ["s", cx + r, cy + r], ["s", cx - r, cy + r], ["s", cx - r, cy - r]];
const plan = { blocks: [{ rgb: 0xcc2020, cmds: sq(0, 0, 100) }, { rgb: 0x2050c0, cmds: sq(300, 0, 100) }] };

const dir = await mkdtemp(join(tmpdir(), "pes-oracle-"));
const urls = await Promise.all(WHEELS.map(([n, v]) => fetchWheel(dir, n, v)));
const py = await loadPyodide();
await py.loadPackage([urls[0], urls[1]]);
await py.runPythonAsync(`import micropip\nawait micropip.install("${urls[2]}")`);
await py.runPythonAsync(PY);
const bytes = Uint8Array.from(py.globals.get("write_pes")(JSON.stringify(plan), 1).toJs());

const ascii = (a, off, n) => Array.from(a.slice(off, off + n)).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
const hex = (a, off, n) => Array.from(a.slice(off, off + n)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
const u32 = (a, off) => a[off] | (a[off + 1] << 8) | (a[off + 2] << 16) | (a[off + 3] << 24);

console.log(`PES v1 total length: ${bytes.length}`);
console.log(`bytes 0..15 ascii: "${ascii(bytes, 0, 16)}"  hex: ${hex(bytes, 0, 16)}`);
const pecStart = u32(bytes, 8);
console.log(`PEC pointer (offset 8 u32): ${pecStart}`);
// find ASCII markers
for (const marker of ["#PES", "CEmbOne", "CSewSeg", "#PEC"]) {
  const idx = Buffer.from(bytes).indexOf(Buffer.from(marker, "latin1"));
  console.log(`marker ${marker}: offset ${idx}`);
}
console.log(`\nPES header (0..${Math.min(64, pecStart)}):`);
for (let o = 0; o < Math.min(pecStart, 80); o += 16) console.log(`  @${String(o).padStart(4)}: ${hex(bytes, o, 16)}  ${ascii(bytes, o, 16)}`);
console.log(`\nPEC block header (@${pecStart}, 64 bytes):`);
for (let o = pecStart; o < pecStart + 80 && o < bytes.length; o += 16) console.log(`  @${String(o).padStart(4)}: ${hex(bytes, o, 16)}  ${ascii(bytes, o, 16)}`);
