import { describe, it, expect } from "vitest";
import { validateDesign } from "./validate";
import { generateDesign } from "./index";
import { fixStitches } from "../fix";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Path } from "../../types/project";

const sq = (x: number, y: number, s: number): Path => [
  { x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s },
];

describe("validateDesign: buried details", () => {
  it("warns when lettering sews before the field that covers it — and Clean up clears it", () => {
    // The heartbreak case from a real user file: white letters stored before the
    // red field they sit on. Thread has no z-order — the field stitches straight
    // over them and they vanish from the sew-out while the canvas looks fine.
    const p = createEmptyProject();
    const letters = [sq(15, 20, 4), sq(21, 20, 4), sq(27, 20, 4)].map((r) =>
      makeObjectFromPaths("fill", [r], "white"),
    );
    const field = makeObjectFromPaths("fill", [sq(10, 10, 30)], "red");
    p.objects = [...letters, field];

    const warnings = validateDesign(generateDesign(p), p);
    const burial = warnings.filter((w) => /buried/i.test(w.message));
    expect(burial.length).toBe(1); // aggregated: one warning per covering fill, not per letter
    expect(burial[0].message).toContain("3 details");

    // Clean up reorders (field first, letters on top) — the warning must clear.
    const cleaned = fixStitches(p);
    const after = validateDesign(generateDesign(cleaned), cleaned);
    expect(after.some((w) => /buried/i.test(w.message))).toBe(false);
  });

  it("does not warn for a detail already sewn on top, or one in a fill's window", () => {
    const p = createEmptyProject();
    const field = makeObjectFromPaths("fill", [sq(10, 10, 30)], "red");
    const onTop = makeObjectFromPaths("fill", [sq(15, 20, 4)], "white");
    const annulus = makeObjectFromPaths("fill", [sq(50, 50, 40), sq(60, 60, 20)], "navy");
    const inWindow = makeObjectFromPaths("fill", [sq(68, 68, 4)], "white");
    p.objects = [field, onTop, inWindow, annulus]; // window detail drawn before the ring
    const warnings = validateDesign(generateDesign(p), p);
    expect(warnings.some((w) => /buried/i.test(w.message))).toBe(false);
  });

  it("does not flag correct UNDERLAP: a field tucked under a border ring, a stripe under its knockout", () => {
    // The crest architecture: the red field's edge tucks 0.5mm under the navy
    // border band; a stripe's rim extends 0.4mm beyond its knockout hole in the
    // field above. In both, nearly ALL of the earlier object's OUTLINE sits
    // inside the later fill while its INK is barely covered — coverage must be
    // measured on the body, or the correct seam architecture reads as burial.
    const p = createEmptyProject();
    // Field 20..80; border band ring 18..82 outer with hole 20.5..79.5 — the
    // field's outline (at 20/80) is inside the band; its body is not.
    const field = makeObjectFromPaths("fill", [sq(20, 20, 60)], "red");
    const band = makeObjectFromPaths(
      "fill",
      [sq(18, 18, 64), [{ x: 20.5, y: 20.5 }, { x: 79.5, y: 20.5 }, { x: 79.5, y: 79.5 }, { x: 20.5, y: 79.5 }]],
      "navy",
    );
    // Stripe 40..60 sewn first; the covering field carves a knockout hole only
    // 0.4mm smaller than the stripe — the rim underlaps, the body shows.
    const stripe = makeObjectFromPaths("fill", [sq(40, 30, 20)], "white");
    const over = makeObjectFromPaths(
      "fill",
      [sq(30, 25, 45), [{ x: 40.4, y: 30.4 }, { x: 59.6, y: 30.4 }, { x: 59.6, y: 49.6 }, { x: 40.4, y: 49.6 }]],
      "green",
    );
    p.objects = [field, stripe, over, band]; // stripe under ONLY the knockout fill
    const warnings = validateDesign(generateDesign(p), p);
    expect(warnings.some((w) => /buried/i.test(w.message))).toBe(false);
  });
});

describe("validateDesign: suspected page background", () => {
  it("warns once, with the object's id, for an undecided flagged ring", () => {
    // A tracer-flagged ring that reached the project without a dialog decision
    // (older save, programmatic import). It still sews — it may be a wanted rim
    // — but the user should rule on it before spending stitches on the page.
    const p = createEmptyProject();
    const ring = makeObjectFromPaths("fill", [sq(5, 5, 90), sq(9, 9, 82)], p.colors[0].id);
    ring.suspectedBackground = true;
    p.objects = [ring];
    const warnings = validateDesign(generateDesign(p), p).filter((w) => /page background/i.test(w.message));
    expect(warnings.length).toBe(1);
    expect(warnings[0].objectId).toBe(ring.id);
  });

  it("stays silent for the same ring once the flag is cleared (explicit keep)", () => {
    const p = createEmptyProject();
    const ring = makeObjectFromPaths("fill", [sq(5, 5, 90), sq(9, 9, 82)], p.colors[0].id);
    p.objects = [ring];
    const warnings = validateDesign(generateDesign(p), p);
    expect(warnings.some((w) => /page background/i.test(w.message))).toBe(false);
  });
});
