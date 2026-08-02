import type { Project } from "../types/project";
import { parseProject, serializeProject } from "./project";

/**
 * `.embproj` file I/O. The format is just the Project JSON (Section 4 of the
 * spec). PES exports are lossy and must never be treated as the source of
 * truth — this file is.
 *
 * Save/load run entirely in the browser via Blob + FileReader; nothing is
 * uploaded anywhere.
 */

const EXTENSION = ".embproj";

/** A design name reduced to a safe download-filename base: path-hostile
 *  characters dropped, whitespace collapsed to dashes, length capped.
 *  Returns undefined when nothing usable remains (caller picks its default). */
export function safeFileBase(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base.length > 0 ? base : undefined;
}

/** Trigger a browser download of the project as a `.embproj` file. */
export function downloadProject(project: Project, filename = "design"): void {
  const json = serializeProject(project);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(EXTENSION) ? filename : filename + EXTENSION;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Read a user-selected File and parse it into a Project. */
export async function loadProjectFromFile(file: File): Promise<Project> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${file.name} is not valid JSON.`);
  }
  return parseProject(parsed);
}
