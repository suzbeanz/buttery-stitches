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
  objectCounter = 0; // a brand-new document numbers its objects from 1
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
  // Normalize each object so a slightly-malformed file (a hand edit, a truncated
  // download, an older export) can't sail past the loader and then CRASH the
  // pure engine on the next render. We recover optional fields (params, paths,
  // visible) and fail loud only on structurally-broken ones (unknown type, no
  // color). Valid files are unchanged, so the round trip stays lossless.
  const project: Project = {
    ...(value as Project),
    widthMm: Math.max(1, p.widthMm as number),
    heightMm: Math.max(1, p.heightMm as number),
    hoop: normalizeHoop(p.hoop),
    colors: (p.colors as unknown[]).map(normalizeColor),
    objects: (p.objects as unknown[]).map(normalizeObject),
  };
  // Continue numbering new objects from where the opened document left off.
  syncObjectCounter(project.objects);
  return project;
}

/** A safe hoop (positive dimensions) so the canvas fit math can't divide by zero. */
function normalizeHoop(raw: unknown): Project["hoop"] {
  const h = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const wMm = Number(h.wMm);
  const hMm = Number(h.hMm);
  if (!Number.isFinite(wMm) || wMm <= 0 || !Number.isFinite(hMm) || hMm <= 0) {
    return { ...DEFAULT_HOOP };
  }
  return { name: typeof h.name === "string" ? h.name : "Custom", wMm, hMm };
}

const VALID_TYPES = new Set(["running", "satin", "fill"]);

/** Coerce one stored object into a safe EmbObject (or throw if unrecoverable). */
function normalizeObject(raw: unknown, i: number): EmbObject {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Project object #${i + 1} is not valid.`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.type !== "string" || !VALID_TYPES.has(o.type)) {
    throw new Error(`Project object #${i + 1} has an unknown stitch type.`);
  }
  if (typeof o.colorId !== "string") {
    throw new Error(`Project object #${i + 1} has no color.`);
  }
  const paths = Array.isArray(o.paths)
    ? o.paths
        .filter(Array.isArray)
        .map((ring) =>
          (ring as unknown[])
            .filter(
              (pt): pt is { x: number; y: number } =>
                typeof pt === "object" &&
                pt !== null &&
                Number.isFinite((pt as { x: unknown }).x) &&
                Number.isFinite((pt as { y: unknown }).y),
            )
            .map((pt) => ({ x: pt.x, y: pt.y })),
        )
    : [];
  return {
    ...(raw as EmbObject),
    id: typeof o.id === "string" ? o.id : newId("obj"),
    name: typeof o.name === "string" ? o.name : defaultObjectName(o.type as EmbObject["type"]),
    type: o.type as EmbObject["type"],
    paths,
    params: typeof o.params === "object" && o.params !== null ? (o.params as EmbObject["params"]) : {},
    visible: o.visible !== false,
  };
}

/** Coerce one stored color into a safe ThreadColor. */
function normalizeColor(raw: unknown, i: number): ThreadColor {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Project color #${i + 1} is not valid.`);
  }
  const c = raw as Record<string, unknown>;
  const rgb = Array.isArray(c.rgb) ? c.rgb : [];
  const ch = (v: unknown) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
  return {
    ...(raw as ThreadColor),
    id: typeof c.id === "string" ? c.id : newId("color"),
    rgb: [ch(rgb[0]), ch(rgb[1]), ch(rgb[2])],
  };
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

/**
 * Re-seed the default-name counter from a project's existing names, so a freshly
 * opened or newly created document numbers from where it actually left off (not
 * from a stale module-global that only ever climbs across sessions).
 */
export function syncObjectCounter(objects: EmbObject[]): void {
  // Only count names still in the default "Fill 3" / "Satin 12" form, so a user
  // who renames a shape "Leaf 2024" doesn't push the next default to "Fill 2025".
  const DEFAULT_NAME = /^(?:Fill|Satin|Running) (\d+)$/;
  let max = 0;
  for (const o of objects) {
    const m = DEFAULT_NAME.exec(o.name ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  objectCounter = max;
}
