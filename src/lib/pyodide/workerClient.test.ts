// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Protocol tests for the Pyodide worker client with a mock Worker: id
 * correlation, stage forwarding, error propagation, and the transfer of the
 * result bytes. The real worker boots Pyodide from a CDN, which unit tests
 * never touch.
 */

type Msg = Record<string, unknown>;

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: Msg[] = [];
  constructor() {
    MockWorker.instances.push(this);
  }
  postMessage(m: Msg) {
    this.posted.push(m);
  }
  terminate() {}
  /** Simulate a message FROM the worker. */
  emit(m: Msg) {
    this.onmessage?.({ data: m } as MessageEvent);
  }
}

beforeEach(() => {
  MockWorker.instances = [];
  vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function client() {
  return import("./workerClient");
}

describe("workerClient protocol", () => {
  it("correlates responses by id and resolves with the transferred bytes", async () => {
    const { exportViaWorker } = await client();
    const p1 = exportViaWorker("{}", "jef", 1);
    const p2 = exportViaWorker("{}", "vp3", 1);
    const w = MockWorker.instances[0];
    expect(w.posted).toHaveLength(2);
    const [id1, id2] = w.posted.map((m) => m.id as number);
    expect(id1).not.toBe(id2);
    // Answer OUT OF ORDER — each promise must get its own bytes.
    w.emit({ id: id2, ok: true, bytes: new Uint8Array([2, 2]) });
    w.emit({ id: id1, ok: true, bytes: new Uint8Array([1]) });
    expect(await p2).toEqual(new Uint8Array([2, 2]));
    expect(await p1).toEqual(new Uint8Array([1]));
  });

  it("forwards stage progress without settling the promise", async () => {
    const { exportViaWorker } = await client();
    const stages: string[] = [];
    const p = exportViaWorker("{}", "jef", 1, (s) => stages.push(s));
    const w = MockWorker.instances[0];
    const id = w.posted[0].id as number;
    w.emit({ id, stage: "loading-runtime" });
    w.emit({ id, stage: "ready" });
    expect(stages).toEqual(["loading-runtime", "ready"]);
    w.emit({ id, ok: true, bytes: new Uint8Array([9]) });
    expect(await p).toEqual(new Uint8Array([9]));
  });

  it("rejects with the worker's error message", async () => {
    const { exportViaWorker } = await client();
    const p = exportViaWorker("{}", "jef", 1);
    const w = MockWorker.instances[0];
    w.emit({ id: w.posted[0].id, ok: false, error: "Failed to fetch" });
    await expect(p).rejects.toThrow(/failed to fetch/i);
  });

  it("import resolves with the JSON payload", async () => {
    const { importViaWorker } = await client();
    const p = importViaWorker(new Uint8Array([1, 2, 3]), "pes");
    const w = MockWorker.instances[0];
    expect(w.posted[0].kind).toBe("import");
    w.emit({ id: w.posted[0].id, ok: true, json: '{"blocks":[]}' });
    expect(await p).toBe('{"blocks":[]}');
  });

  it("a top-level worker failure rejects all in-flight calls and marks the worker broken", async () => {
    const mod = await client();
    const p = mod.exportViaWorker("{}", "jef", 1);
    const w = MockWorker.instances[0];
    w.onerror?.(new Event("error"));
    await expect(p).rejects.toThrow(/worker failed to start/i);
    expect(mod.workerAvailable()).toBe(false); // future calls take the fallback
  });
});
