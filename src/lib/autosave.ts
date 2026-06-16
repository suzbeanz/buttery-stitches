import type { Project } from "../types/project";
import { parseProject, serializeProject } from "./project";

/**
 * Session autosave to localStorage — so a reload, a crash, or a new deploy never
 * loses work. It's privacy-safe: the design stays on the device, never uploaded
 * (the whole app is client-side). Best-effort: any storage error (private mode,
 * quota) is swallowed rather than interrupting the user.
 */
const AUTOSAVE_KEY = "bs:autosave:v1";

/** Persist the project (best-effort). Empty documents are cleared, not stored. */
export function saveAutosave(project: Project): void {
  try {
    if (project.objects.length === 0) {
      localStorage.removeItem(AUTOSAVE_KEY);
      return;
    }
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(project));
  } catch {
    /* private mode / quota — nothing we can or should do */
  }
}

/** Load the autosaved project, or null if there isn't a usable one. */
export function loadAutosave(): Project | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const project = parseProject(JSON.parse(raw));
    return project.objects.length > 0 ? project : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}
