/**
 * Synthetic user-journey tests — the closest thing to watching a real person
 * use Buttery Stitches without a browser. Each `describe` walks one complete
 * journey end to end (add → edit → undo → export) through the REAL project
 * store and the REAL pure libraries, then asserts the quality and
 * foolproofness invariants a 60+ first-timer depends on:
 *
 *   - nothing they do produces absurd, machine-jamming long stitches;
 *   - every finished design exports to a valid color-blocked plan;
 *   - undo always takes them back; delete never strands selection;
 *   - re-editing text keeps the same color and position (no surprises);
 *   - all eight bundled fonts stitch cleanly (lettering is priority #1).
 *
 * These are logic-level journeys (no DOM). Things that genuinely need a browser
 * — on-canvas dragging, the hoop mockup render, tooltips — are called out in
 * docs/polish-todo.md and verified with `npm run dev` / the live site.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Font } from "opentype.js";

import { useProjectStore } from "../store/projectStore";
import { parseFont, FONTS } from "../lib/text/fonts";
import { layoutText } from "../lib/text/layout";
import { makeShapeObject, type ShapeKind } from "../lib/shapes";
import { makeObjectFromPaths } from "../lib/objects";
import { buildOutline, DEFAULT_OUTLINE_WIDTH } from "../lib/outline";
import { fixStitches } from "../lib/fix";
import { generateDesign, type EngineStitch } from "../lib/engine";
import { splitFillRegions } from "../lib/engine/fill";
import { medialSatin, satinCoverage } from "../lib/engine/medial";
import { planFromProject, planStitchCount } from "../lib/export";
import { translatePaths, pathsBounds } from "../lib/geometry";
import { createEmptyProject } from "../lib/project";
import type { EmbObject, Project, ThreadColor } from "../types/project";

// --- font loading (read the bundled .ttf straight from disk, no network) -----
const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "text", "fonts");
const FONT_FILE: Record<string, string> = {
  poppins: "Poppins-SemiBold.ttf",
  montserrat: "Montserrat-SemiBold.ttf",
  playfair: "PlayfairDisplay-Bold.ttf",
  "bebas-neue": "BebasNeue-Regular.ttf",
  pacifico: "Pacifico-Regular.ttf",
  lobster: "Lobster-Regular.ttf",
  "dancing-script": "DancingScript-Bold.ttf",
  caveat: "Caveat-Bold.ttf",
};
function loadTtf(file: string): Font {
  const buf = readFileSync(join(fontsDir, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parseFont(ab as ArrayBuffer);
}

// --- quality invariants any sewable design must satisfy ----------------------

/**
 * The longest single penetration-to-penetration stitch in the design (mm),
 * counting only consecutive REAL stitches within the same object (jumps and
 * object boundaries don't count — those are travels, not stitches). This is the
 * number that decides whether the machine thread snaps or the design jams.
 */
function longestStitchMm(design: EngineStitch[]): number {
  let max = 0;
  for (let i = 1; i < design.length; i++) {
    const a = design[i - 1];
    const b = design[i];
    if (a.jump || b.jump) continue;
    if (a.objectId !== b.objectId) continue;
    max = Math.max(max, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return max;
}

/** Distinct thread colors actually used in the assembled design. */
function colorsUsed(design: EngineStitch[]): Set<string> {
  return new Set(design.filter((s) => !s.jump || true).map((s) => s.colorId));
}

/** A design is "sewable" if it has real stitches and no monster stitches. */
function expectSewable(project: Project, maxStitchMm = 9): EngineStitch[] {
  const design = generateDesign(project);
  const penetrations = design.filter((s) => !s.jump).length;
  expect(penetrations).toBeGreaterThan(0);
  expect(longestStitchMm(design)).toBeLessThanOrEqual(maxStitchMm);

  // And it must turn into a valid, non-empty color-blocked export plan.
  const plan = planFromProject(project);
  expect(plan.blocks.length).toBeGreaterThan(0);
  expect(planStitchCount(plan)).toBeGreaterThan(0);
  return design;
}

function freshStore(): void {
  useProjectStore.setState({ project: createEmptyProject(), selectedIds: [] });
  // Clear undo history between journeys so each starts clean.
  useProjectStore.temporal.getState().clear();
}

function colorId(): string {
  return useProjectStore.getState().project.colors[0].id;
}

/** Build a centered, placed text fill object the way the Add-words dialog does. */
function placeText(font: Font, text: string, heightMm: number, cId: string): EmbObject {
  const { object } = layoutText({ text, font, heightMm, colorId: cId, name: text });
  const { hoop } = useProjectStore.getState().project;
  const placed = pathsBounds(object.paths)
    ? translatePaths(object.paths, hoop.wMm / 2, hoop.hMm / 2)
    : object.paths;
  return { ...object, paths: placed, text: { content: text, fontId: "poppins", heightMm, letterSpacingMm: 0 } };
}

// ---------------------------------------------------------------------------

describe("journey: add words → move → re-edit → undo (lettering, priority #1)", () => {
  let font: Font;
  beforeAll(() => {
    font = loadTtf(FONT_FILE.poppins);
  });
  beforeEach(freshStore);

  it("a first-timer types a name and it stitches cleanly", () => {
    const store = useProjectStore.getState();
    store.addObject(placeText(font, "Butters", 18, colorId()));

    const project = useProjectStore.getState().project;
    expect(project.objects).toHaveLength(1);
    expect(project.objects[0].type).toBe("fill");
    expectSewable(project);
  });

  it("re-editing the text keeps the same id, color, and center position", () => {
    const store = useProjectStore.getState();
    const cId = colorId();
    store.addObject(placeText(font, "Cat", 18, cId));
    const before = useProjectStore.getState().project.objects[0];
    const beforeBounds = pathsBounds(before.paths)!;
    const beforeCenter = {
      x: (beforeBounds.minX + beforeBounds.maxX) / 2,
      y: (beforeBounds.minY + beforeBounds.maxY) / 2,
    };

    // The user double-clicks and changes the word — same object, regenerated.
    const relaid = layoutText({ text: "Kitten", font, heightMm: 18, colorId: cId, name: "Kitten" });
    const placed = translatePaths(relaid.object.paths, beforeCenter.x, beforeCenter.y);
    store.updateObject(before.id, {
      paths: placed,
      text: { content: "Kitten", fontId: "poppins", heightMm: 18, letterSpacingMm: 0 },
    });

    const after = useProjectStore.getState().project.objects[0];
    expect(after.id).toBe(before.id);
    expect(after.colorId).toBe(cId);
    const afterBounds = pathsBounds(after.paths)!;
    expect((afterBounds.minX + afterBounds.maxX) / 2).toBeCloseTo(beforeCenter.x, 1);
    expect((afterBounds.minY + afterBounds.maxY) / 2).toBeCloseTo(beforeCenter.y, 1);
    expect(after.text?.content).toBe("Kitten");
    expectSewable(useProjectStore.getState().project);
  });

  it("moving the words and then pressing undo restores the exact position", () => {
    const store = useProjectStore.getState();
    store.addObject(placeText(font, "Hi", 16, colorId()));
    const id = useProjectStore.getState().project.objects[0].id;
    const start = pathsBounds(useProjectStore.getState().project.objects[0].paths)!;

    store.moveObjects([id], 12, -7);
    const moved = pathsBounds(useProjectStore.getState().project.objects[0].paths)!;
    expect(moved.minX).toBeCloseTo(start.minX + 12, 5);
    expect(moved.minY).toBeCloseTo(start.minY - 7, 5);

    useProjectStore.temporal.getState().undo();
    const restored = pathsBounds(useProjectStore.getState().project.objects[0].paths)!;
    expect(restored.minX).toBeCloseTo(start.minX, 5);
    expect(restored.minY).toBeCloseTo(start.minY, 5);
  });

  it("typing only spaces never crashes and adds no stitches", () => {
    const { object } = layoutText({ text: "   ", font, heightMm: 16, colorId: colorId() });
    expect(object.paths).toHaveLength(0);
    useProjectStore.getState().addObject(object);
    // No geometry means no penetrations — but the app must not throw.
    const design = generateDesign(useProjectStore.getState().project);
    expect(design.filter((s) => !s.jump)).toHaveLength(0);
  });
});

describe("journey: every bundled font must stitch cleanly", () => {
  beforeEach(freshStore);

  // Lettering is the #1 promise; a font that produces monster stitches or no
  // geometry would quietly ruin a user's project, so we gate all eight.
  for (const entry of FONTS) {
    it(`${entry.name} produces sewable lettering`, () => {
      const font = loadTtf(FONT_FILE[entry.id]);
      const cId = colorId();
      const obj = placeText(font, "Buttery", 16, cId);
      expect(obj.paths.length).toBeGreaterThan(0);
      // Lettering must default to satin (follows the stroke).
      expect(obj.params?.fillStyle).toBe("satin");
      useProjectStore.getState().addObject(obj);
      expectSewable(useProjectStore.getState().project);
    });
  }

  it("rounded glyphs stitch as satin strokes that cover the letter", () => {
    const font = loadTtf(FONT_FILE.poppins);
    const { object } = layoutText({ text: "o", font, heightMm: 16, colorId: "c1" });
    const region = splitFillRegions(object.paths)[0];
    const runs = medialSatin(region, { density: 0.4 });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(satinCoverage(region, runs)).toBeGreaterThan(0.85);
  });
});

describe("journey: drop a shape → add a satin outline → export", () => {
  beforeEach(freshStore);

  const kinds: ShapeKind[] = ["rectangle", "roundedRect", "ellipse", "triangle", "star", "heart"];
  for (const kind of kinds) {
    it(`a ${kind} fills and exports without monster stitches`, () => {
      const obj = makeShapeObject(kind, { width: 40, height: 40 }, colorId());
      useProjectStore.getState().addObject(obj);
      expectSewable(useProjectStore.getState().project);
    });
  }

  it("a contour (echo) fill on an organic shape sews cleanly", () => {
    const store = useProjectStore.getState();
    const heart = makeShapeObject("heart", { width: 50, height: 50 }, colorId());
    heart.params = { ...heart.params, fillStyle: "contour" };
    store.addObject(heart);
    expectSewable(useProjectStore.getState().project);
  });

  it("adding a satin outline in a second color yields two color blocks", () => {
    const store = useProjectStore.getState();
    const cId = colorId();
    const fill = makeShapeObject("ellipse", { width: 40, height: 40 }, cId);
    store.addObject(fill);

    const outlineColor: ThreadColor = { id: "outline-c", rgb: [200, 30, 30], name: "Red" };
    store.addColor(outlineColor);
    const [outline] = buildOutline(
      useProjectStore.getState().project.objects[0].paths,
      DEFAULT_OUTLINE_WIDTH,
      outlineColor.id,
    );
    store.addObject(outline);

    const project = useProjectStore.getState().project;
    expect(project.objects).toHaveLength(2);
    const design = expectSewable(project);
    expect(colorsUsed(design).size).toBe(2);
  });
});

describe("journey: clean-up button normalizes a risky design without breaking it", () => {
  beforeEach(freshStore);

  it("fixStitches clamps reckless params but keeps every object stitchable", () => {
    const store = useProjectStore.getState();
    // A user dragged density and stitch length to nonsense values.
    const reckless = makeObjectFromPaths(
      "fill",
      [
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
        ],
      ],
      colorId(),
    );
    reckless.params = { density: 0.05, stitchLength: 99, underlay: false };
    store.addObject(reckless);

    const fixed = fixStitches(useProjectStore.getState().project);
    store.setProject(fixed);

    // Same number of objects, same geometry, but now safely sewable.
    expect(fixed.objects).toHaveLength(1);
    expect(fixed.objects[0].paths).toEqual(reckless.paths);
    expectSewable(fixed);
  });
});

describe("journey: build a two-color design, delete, undo/redo", () => {
  beforeEach(freshStore);

  it("delete clears selection and undo brings the object back", () => {
    const store = useProjectStore.getState();
    const a = makeShapeObject("rectangle", { width: 30, height: 30 }, colorId());
    store.addObject(a);
    expect(useProjectStore.getState().selectedIds).toEqual([a.id]);

    store.removeObjects([a.id]);
    expect(useProjectStore.getState().project.objects).toHaveLength(0);
    // Foolproof: deleting must never leave a dangling selection.
    expect(useProjectStore.getState().selectedIds).toEqual([]);

    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().project.objects).toHaveLength(1);
    useProjectStore.temporal.getState().redo();
    expect(useProjectStore.getState().project.objects).toHaveLength(0);
  });

  it("multi-select move is a single undo step", () => {
    const store = useProjectStore.getState();
    const a = makeShapeObject("rectangle", { width: 20, height: 20 }, colorId());
    const b = makeShapeObject("ellipse", { width: 20, height: 20 }, colorId());
    store.addObjects([a, b]);
    const startA = pathsBounds(useProjectStore.getState().project.objects[0].paths)!;

    store.moveObjects([a.id, b.id], 10, 10);
    useProjectStore.temporal.getState().undo();

    const restoredA = pathsBounds(useProjectStore.getState().project.objects[0].paths)!;
    expect(restoredA.minX).toBeCloseTo(startA.minX, 5);
    // both objects still present after one undo (move was one step)
    expect(useProjectStore.getState().project.objects).toHaveLength(2);
  });
});

describe("journey: choosing a fabric retunes the sew without breaking it", () => {
  beforeEach(freshStore);

  // The same artwork must stitch cleanly on a stable woven or a stretchy knit;
  // the fabric only bends density / pull / underlay (docs/stitch-logic.md §8).
  const fabrics: Array<Project["fabric"]> = ["woven", "knit", "pile", "sheer"];
  for (const fabric of fabrics) {
    it(`a broad fill sews cleanly on ${fabric}`, () => {
      const store = useProjectStore.getState();
      store.addObject(makeShapeObject("ellipse", { width: 50, height: 40 }, colorId()));
      store.updateProject({ fabric });
      expect(useProjectStore.getState().project.fabric).toBe(fabric);
      expectSewable(useProjectStore.getState().project);
    });
  }

  it("knit lowers density and adds heavier underlay, changing the stitch count", () => {
    const store = useProjectStore.getState();
    store.addObject(makeShapeObject("ellipse", { width: 50, height: 40 }, colorId()));

    store.updateProject({ fabric: "woven" });
    const woven = generateDesign(useProjectStore.getState().project).filter((s) => !s.jump).length;

    store.updateProject({ fabric: "knit" });
    const knit = generateDesign(useProjectStore.getState().project).filter((s) => !s.jump).length;

    expect(woven).toBeGreaterThan(0);
    expect(knit).toBeGreaterThan(0);
    expect(knit).not.toBe(woven);
  });
});

describe("journey: save and reopen the .embproj source of truth", () => {
  beforeEach(freshStore);

  it("serializing then parsing reproduces an identical, sewable design", async () => {
    const { serializeProject, parseProject } = await import("../lib/project");
    const store = useProjectStore.getState();
    store.addObject(makeShapeObject("star", { width: 36, height: 36 }, colorId()));
    const original = useProjectStore.getState().project;

    const roundTripped = parseProject(JSON.parse(serializeProject(original)));
    expect(roundTripped.objects).toHaveLength(original.objects.length);
    // The exported stitch plan must be byte-for-byte identical after a round trip.
    expect(planFromProject(roundTripped)).toEqual(planFromProject(original));
    expectSewable(roundTripped);
  });
});
