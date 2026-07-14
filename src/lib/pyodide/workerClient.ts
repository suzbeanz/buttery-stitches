import { PYEMBROIDERY_WHEEL, type LoadStage } from "./loader";

/**
 * Main-thread client for the Pyodide worker (pyWorker.ts). Owns one shared
 * worker, correlates request/response by id, and surfaces the loader's stage
 * progress. If the worker can't even be constructed (exotic embedders), the
 * caller falls back to the legacy main-thread Pyodide path.
 */

type Pending = {
  resolve: (v: { bytes?: Uint8Array; json?: string }) => void;
  reject: (e: Error) => void;
  onStage?: (stage: LoadStage) => void;
};

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function wheelUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}${PYEMBROIDERY_WHEEL}`, window.location.href).href;
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./pyWorker.ts", import.meta.url), { type: "module" });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (
    e: MessageEvent<{ id: number; stage?: string; ok?: boolean; bytes?: Uint8Array; json?: string; error?: string }>,
  ) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.stage !== undefined) {
      p.onStage?.(m.stage as LoadStage);
      return;
    }
    pending.delete(m.id);
    if (m.ok) p.resolve({ bytes: m.bytes, json: m.json });
    else p.reject(new Error(m.error ?? "Export engine failed in the worker."));
  };
  worker.onerror = () => {
    // A top-level worker failure (script load, OOM): fail everything in flight
    // and let future calls take the main-thread fallback.
    workerBroken = true;
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(new Error("The export engine's background worker failed to start."));
    }
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** True when a worker could be created (or hasn't provably failed yet). */
export function workerAvailable(): boolean {
  return typeof Worker !== "undefined" && !workerBroken && getWorker() !== null;
}

export function exportViaWorker(
  planJson: string,
  format: string,
  pesVersion: number,
  onStage?: (stage: LoadStage) => void,
): Promise<Uint8Array> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("worker-unavailable"));
  const id = nextId++;
  return new Promise<Uint8Array>((resolve, reject) => {
    pending.set(id, {
      onStage,
      resolve: (v) => (v.bytes ? resolve(v.bytes) : reject(new Error("Worker returned no bytes."))),
      reject,
    });
    w.postMessage({ id, kind: "export", planJson, format, pesVersion, wheelUrl: wheelUrl() });
  });
}

export function importViaWorker(
  bytes: Uint8Array,
  format: string,
  onStage?: (stage: LoadStage) => void,
): Promise<string> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("worker-unavailable"));
  const id = nextId++;
  // Copy so the caller's buffer isn't detached by the transfer.
  const payload = new Uint8Array(bytes);
  return new Promise<string>((resolve, reject) => {
    pending.set(id, {
      onStage,
      resolve: (v) => (v.json !== undefined ? resolve(v.json) : reject(new Error("Worker returned no data."))),
      reject,
    });
    w.postMessage({ id, kind: "import", bytes: payload, format, wheelUrl: wheelUrl() }, [payload.buffer]);
  });
}
