/**
 * Phase 1 de-risk: prove pyembroidery installs under Pyodide and writes valid
 * embroidery files — the WASM path the browser app depends on.
 *
 * Run with:  node scripts/derisk-pyodide.mjs
 *
 * It loads the Pyodide core from the local `pyodide` dev dependency, fetches the
 * three pure-Python wheels (packaging, micropip, pyembroidery) from PyPI, and
 * installs pyembroidery via micropip — exactly as the browser does, just sourced
 * from PyPI instead of the Pyodide CDN. Needs network access to PyPI only.
 */
import { loadPyodide } from "pyodide";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WHEELS = [
  ["packaging", "24.2"],
  ["micropip", "0.9.0"],
  ["pyembroidery", "1.5.1"],
];

async function fetchWheel(dir, name, version) {
  const meta = await fetch(`https://pypi.org/pypi/${name}/${version}/json`).then(
    (r) => r.json(),
  );
  const file = meta.urls.find((u) => u.filename.endsWith("-none-any.whl"));
  if (!file) throw new Error(`No pure-python wheel for ${name} ${version}`);
  const buf = new Uint8Array(await fetch(file.url).then((r) => r.arrayBuffer()));
  const path = join(dir, file.filename);
  await writeFile(path, buf);
  return pathToFileURL(path).href;
}

const dir = await mkdtemp(join(tmpdir(), "sf-wheels-"));
const [packagingUrl, micropipUrl, pyembUrl] = await Promise.all(
  WHEELS.map(([n, v]) => fetchWheel(dir, n, v)),
);

const py = await loadPyodide();
await py.loadPackage([packagingUrl, micropipUrl]);
await py.runPythonAsync(`import micropip\nawait micropip.install("${pyembUrl}")`);

const json = await py.runPythonAsync(`
import pyembroidery as pe, io, json
p = pe.EmbPattern()
p.add_thread({"rgb": 0x2050C0})
for x, y in [(0,0),(200,0),(200,200),(0,200),(0,0)]:
    p.add_stitch_absolute(pe.STITCH, x, y)
p.add_command(pe.END)
out = {}
for name, w in {"pes": pe.write_pes, "dst": pe.write_dst, "jef": pe.write_jef,
                "exp": pe.write_exp, "vp3": pe.write_vp3}.items():
    buf = io.BytesIO()
    w(p, buf, {"version": 1}) if name == "pes" else w(p, buf)
    out[name] = len(buf.getvalue())
json.dumps(out)
`);

const sizes = JSON.parse(json);
if (sizes.pes < 100) throw new Error("PES output looks empty");
console.log("OK — pyembroidery under Pyodide wrote:", sizes);
