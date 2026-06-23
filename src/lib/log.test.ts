import { describe, it, expect, beforeEach } from "vitest";
import {
  log,
  logError,
  getLogEntries,
  clearLog,
  describeError,
  buildErrorReport,
} from "./log";

describe("log", () => {
  beforeEach(() => clearLog());

  it("records entries in order with level and message", () => {
    log("info", "first");
    logError("second", "stack here");
    const entries = getLogEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ level: "info", message: "first" });
    expect(entries[1]).toMatchObject({ level: "error", message: "second", detail: "stack here" });
    expect(typeof entries[0].time).toBe("number");
  });

  it("caps the buffer at 50 entries, evicting the oldest", () => {
    for (let i = 0; i < 60; i++) logError(`e${i}`);
    const entries = getLogEntries();
    expect(entries).toHaveLength(50);
    // The first ten (e0..e9) should have been evicted.
    expect(entries[0].message).toBe("e10");
    expect(entries[entries.length - 1].message).toBe("e59");
  });

  it("getLogEntries returns a copy (callers can't mutate the buffer)", () => {
    logError("x");
    const snapshot = getLogEntries();
    snapshot.push({ time: 0, level: "info", message: "injected" });
    expect(getLogEntries()).toHaveLength(1);
  });

  describe("describeError", () => {
    it("extracts message and stack from an Error", () => {
      const err = new Error("boom");
      const { message, detail } = describeError(err);
      expect(message).toBe("boom");
      expect(detail).toContain("boom");
    });

    it("handles strings and arbitrary objects", () => {
      expect(describeError("plain").message).toBe("plain");
      expect(describeError({ code: 42 }).message).toBe('{"code":42}');
    });
  });

  describe("buildErrorReport", () => {
    it("includes a header and every entry, and promises no design data", () => {
      logError("kaboom", "at line 1");
      const report = buildErrorReport();
      expect(report).toContain("Buttery Stitches — error report");
      expect(report).toContain("diagnostics only");
      expect(report).toContain("kaboom");
      expect(report).toContain("at line 1");
    });
  });
});
