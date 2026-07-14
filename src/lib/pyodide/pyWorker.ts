/// <reference lib="webworker" />
import embroideryPy from "../export/embroidery.py?raw";
import { PYODIDE_VERSION, type PyodideInterface } from "./loader";

/**
 * Pyodide WORKER: runs the Python export/import engine off the main thread.
 *
 * The first Python-path export used to freeze the tab for several seconds
 * (CDN download + WASM compile + wheel install) and a large design blocked the
 * UI during encode. In here all of that happens on a worker thread; the page
 * only exchanges small messages + transferred byte buffers.
 *
 * Protocol (all messages carry `id`):
 *   in:  { id, kind: "export", planJson, format, pesVersion, wheelUrl }
 *        { id, kind: "import", bytes, format, wheelUrl }
 *   out: { id, stage }                       progress while loading
 *        { id, ok: true, bytes | json }      result (bytes transferred)
 *        { id, ok: false, error }            failure (message string)
 */

type WorkerRequest =
  | { id: number; kind: "export"; planJson: string; format: string; pesVersion: number; wheelUrl: string }
  | { id: number; kind: "import"; bytes: Uint8Array; format: string; wheelUrl: string };

const DEFAULT_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideInterface> | null = null;
let pythonLoaded = false;

function getPyodideInWorker(wheelUrl: string, report: (stage: string) => void): Promise<PyodideInterface> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    try {
      report("loading-runtime");
      // The ESM build boots cleanly inside a module worker (no importScripts).
      const mod = (await import(/* @vite-ignore */ `${DEFAULT_INDEX_URL}pyodide.mjs`)) as {
        loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInterface>;
      };
      const pyodide = await mod.loadPyodide({ indexURL: DEFAULT_INDEX_URL });
      report("loading-micropip");
      await pyodide.loadPackage("micropip");
      report("installing-pyembroidery");
      await pyodide.runPythonAsync(`import micropip\nawait micropip.install("${wheelUrl}")`);
      report("ready");
      return pyodide;
    } catch (err) {
      pyodidePromise = null; // allow retry (e.g. offline first attempt)
      report("error");
      throw err;
    }
  })();
  return pyodidePromise;
}

// Requests are serialized: Pyodide globals (__plan_json/__fmt/…) are shared
// slots, so overlapping runs would clobber each other exactly as on the main
// thread. A simple promise chain keeps strict FIFO order.
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const report = (stage: string) => self.postMessage({ id: req.id, stage });
  const run = chain.then(async () => {
    const pyodide = await getPyodideInWorker(req.wheelUrl, report);
    if (!pythonLoaded) {
      await pyodide.runPythonAsync(embroideryPy);
      pythonLoaded = true;
    }
    if (req.kind === "export") {
      pyodide.globals.set("__plan_json", req.planJson);
      pyodide.globals.set("__fmt", req.format);
      pyodide.globals.set("__pes_version", req.pesVersion);
      const result = (await pyodide.runPythonAsync(
        `export_bytes(__plan_json, __fmt, __pes_version)`,
      )) as { toJs: () => Uint8Array; destroy: () => void };
      try {
        const bytes = result.toJs();
        // Copy into a transferable buffer owned by this message.
        const out = new Uint8Array(bytes);
        self.postMessage({ id: req.id, ok: true, bytes: out }, [out.buffer]);
      } finally {
        result.destroy();
      }
    } else {
      pyodide.globals.set("__import_bytes", req.bytes);
      pyodide.globals.set("__import_fmt", req.format);
      const json = (await pyodide.runPythonAsync(
        `import_design(__import_bytes, __import_fmt)`,
      )) as string;
      self.postMessage({ id: req.id, ok: true, json });
    }
  });
  chain = run.catch(() => undefined);
  run.catch((err) => {
    self.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  });
};

export {}; // module worker
