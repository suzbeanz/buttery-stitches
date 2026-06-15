import type { EmbObject, Project, ThreadColor } from "../types/project";
import { DEFAULT_HOOP } from "./hoops";
import { newId } from "./id";

/** A fresh, empty project sized to the default hoop. */
export function createEmptyProject(): Project {
  const black: ThreadColor = {
    id: newId("color"),
    rgb: [20, 20, 20],
    name: "Black",
  };
  return {
    version: 1,
    widthMm: DEFAULT_HOOP.wMm,
    heightMm: DEFAULT_HOOP.hMm,
    hoop: { ...DEFAULT_HOOP },
    fabric: "woven",
    colors: [black],
    objects: [],
  };
}

/**
 * Validate and normalize an unknown value into a Project. Throws on anything
 * that clearly isn't a v1 project file. This is intentionally strict — a
 * `.embproj` is meant to be the lossless source of truth, so we surface
 * corruption rather than silently guessing.
 */
export function parseProject(value: unknown): Project {
  if (typeof value !== "object" || value === null) {
    throw new Error("Project file is not an object.");
  }
  const p = value as Record<string, unknown>;
  if (p.version !== 1) {
    throw new Error(`Unsupported project version: ${String(p.version)}`);
  }
  if (!Array.isArray(p.colors) || !Array.isArray(p.objects)) {
    throw new Error("Project file is missing colors/objects.");
  }
  if (typeof p.widthMm !== "number" || typeof p.heightMm !== "number") {
    throw new Error("Project file is missing dimensions.");
  }
  // We trust the shape beyond this point; deeper per-field validation can be
  // layered in later without changing the file format.
  return value as Project;
}

/** The Project shape is plain JSON, so serializing is trivial. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

let objectCounter = 0;
/** Generate a friendly default name like "Fill 3". */
export function defaultObjectName(type: EmbObject["type"]): string {
  objectCounter += 1;
  const label = type[0].toUpperCase() + type.slice(1);
  return `${label} ${objectCounter}`;
}
