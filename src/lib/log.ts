// Client-side, privacy-preserving error log. The app makes a hard promise that
// nothing leaves the user's machine, so this NEVER sends anything over the
// network — it keeps a small in-memory ring buffer of recent errors that the
// user can optionally download as a redacted report to attach to a bug report.
//
// It records only diagnostic metadata (message, stack, timestamp, build id,
// route, user agent) — never project/design content.
import { BUILD_ID } from "./version";

export type LogLevel = "error" | "warn" | "info";

export interface LogEntry {
  time: number;
  level: LogLevel;
  message: string;
  /** Optional stack / component trace — already diagnostic, no user content. */
  detail?: string;
}

/** Keep the buffer small so a long session can't grow memory without bound. */
const MAX_ENTRIES = 50;
const entries: LogEntry[] = [];

/** Append an entry, evicting the oldest once the buffer is full. */
export function log(level: LogLevel, message: string, detail?: string): void {
  entries.push({ time: Date.now(), level, message, detail });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export const logError = (message: string, detail?: string) => log("error", message, detail);

/** A copy of the current buffer (most recent last). */
export function getLogEntries(): LogEntry[] {
  return entries.slice();
}

/** Clear the buffer (used by tests and a manual "clear" affordance). */
export function clearLog(): void {
  entries.length = 0;
}

/** Coerce an unknown thrown value into a readable message + stack. */
export function describeError(err: unknown): { message: string; detail?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name || "Error", detail: err.stack };
  }
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

/** Build a human-readable, content-free report of the recent log. */
export function buildErrorReport(): string {
  const head = [
    "Buttery Stitches — error report",
    `Generated: ${new Date().toISOString()}`,
    `Build: ${BUILD_ID}`,
    `URL: ${typeof location !== "undefined" ? location.pathname + location.search : "n/a"}`,
    `User agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "n/a"}`,
    `Entries: ${entries.length}`,
    "",
    "(No design or image data is included — diagnostics only.)",
    "",
  ].join("\n");
  const body = entries
    .map((e) => {
      const when = new Date(e.time).toISOString();
      const line = `[${when}] ${e.level.toUpperCase()}: ${e.message}`;
      return e.detail ? `${line}\n${e.detail}` : line;
    })
    .join("\n\n");
  return `${head}${body}\n`;
}

/** Download the report as a text file (no network — a local Blob download). */
export function downloadErrorReport(): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([buildErrorReport()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `buttery-stitches-error-${Date.now()}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let installed = false;

/**
 * Install global handlers so uncaught errors and unhandled promise rejections are
 * captured into the log instead of vanishing into the console. Idempotent.
 * `onCapture` lets the caller surface a gentle, throttled notice (e.g. a toast).
 */
export function installGlobalErrorHandlers(onCapture?: (entry: LogEntry) => void): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const capture = (message: string, detail?: string) => {
    log("error", message, detail);
    onCapture?.(entries[entries.length - 1]);
  };

  window.addEventListener("error", (e: ErrorEvent) => {
    const { message, detail } = describeError(e.error ?? e.message);
    capture(message, detail);
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const { message, detail } = describeError(e.reason);
    capture(`Unhandled promise rejection: ${message}`, detail);
  });
}
