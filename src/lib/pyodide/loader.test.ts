import { describe, it, expect } from "vitest";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PYEMBROIDERY_WHEEL } from "./loader";

/**
 * The Python export/import path installs pyembroidery from a SELF-HOSTED wheel
 * (public/wheels/…) — not from PyPI, whose origins the deployed CSP deliberately
 * excludes. If the wheel file disappears or the pinned filename drifts from the
 * loader constant, production imports break while dev keeps working. Pin both.
 */
describe("self-hosted pyembroidery wheel", () => {
  it("exists in public/ under the exact filename the loader installs", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const wheel = join(repoRoot, "public", PYEMBROIDERY_WHEEL);
    const stat = statSync(wheel); // throws if missing
    expect(stat.size).toBeGreaterThan(50_000); // a real wheel, not a placeholder
    expect(PYEMBROIDERY_WHEEL).toMatch(/pyembroidery-1\.5\.1-.*\.whl$/);
  });
});
