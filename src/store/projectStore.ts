import { create } from "zustand";
import { temporal } from "zundo";
import type { TemporalState } from "zundo";
import { useStore } from "zustand";
import type {
  EmbObject,
  EmbObjectParams,
  Project,
  ThreadColor,
} from "../types/project";
import { createEmptyProject } from "../lib/project";
import { translatePaths } from "../lib/geometry";

/**
 * Single project store. The `project` object is the entire editable document;
 * `zundo`'s temporal middleware snapshots it for undo/redo. Selection and
 * other transient UI state lives outside the tracked slice so that selecting
 * an object doesn't create an undo entry.
 */

export interface ProjectState {
  project: Project;
  /** ids of currently selected objects (transient UI state, not undone). */
  selectedIds: string[];

  // ---- document mutations (tracked by undo/redo) ----
  setProject: (project: Project) => void;
  newProject: () => void;
  updateProject: (patch: Partial<Project>) => void;

  addObject: (object: EmbObject) => void;
  addObjects: (objects: EmbObject[]) => void;
  removeObjects: (ids: string[]) => void;
  updateObject: (id: string, patch: Partial<EmbObject>) => void;
  updateObjectParams: (id: string, patch: Partial<EmbObjectParams>) => void;
  /** Translate several objects together (one undo step). */
  moveObjects: (ids: string[], dxMm: number, dyMm: number) => void;
  reorderObjects: (fromIndex: number, toIndex: number) => void;

  addColor: (color: ThreadColor) => void;
  updateColor: (id: string, patch: Partial<ThreadColor>) => void;

  // ---- transient UI state (NOT tracked) ----
  setSelection: (ids: string[]) => void;
}

/**
 * Fields that should NOT participate in undo/redo. zundo's `partialize`
 * strips these from the tracked snapshot.
 */
type TrackedState = Omit<ProjectState, "selectedIds">;

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set) => ({
      project: createEmptyProject(),
      selectedIds: [],

      setProject: (project) => set({ project, selectedIds: [] }),
      newProject: () => set({ project: createEmptyProject(), selectedIds: [] }),
      updateProject: (patch) =>
        set((s) => ({ project: { ...s.project, ...patch } })),

      addObject: (object) =>
        set((s) => ({
          project: {
            ...s.project,
            objects: [...s.project.objects, object],
          },
          selectedIds: [object.id],
        })),

      addObjects: (objects) =>
        set((s) => ({
          project: {
            ...s.project,
            objects: [...s.project.objects, ...objects],
          },
          selectedIds: objects.map((o) => o.id),
        })),

      removeObjects: (ids) =>
        set((s) => {
          const remove = new Set(ids);
          return {
            project: {
              ...s.project,
              objects: s.project.objects.filter((o) => !remove.has(o.id)),
            },
            selectedIds: s.selectedIds.filter((id) => !remove.has(id)),
          };
        }),

      updateObject: (id, patch) =>
        set((s) => ({
          project: {
            ...s.project,
            objects: s.project.objects.map((o) =>
              o.id === id ? { ...o, ...patch } : o,
            ),
          },
        })),

      updateObjectParams: (id, patch) =>
        set((s) => ({
          project: {
            ...s.project,
            objects: s.project.objects.map((o) =>
              o.id === id ? { ...o, params: { ...o.params, ...patch } } : o,
            ),
          },
        })),

      moveObjects: (ids, dxMm, dyMm) =>
        set((s) => {
          const move = new Set(ids);
          return {
            project: {
              ...s.project,
              objects: s.project.objects.map((o) =>
                move.has(o.id)
                  ? { ...o, paths: translatePaths(o.paths, dxMm, dyMm) }
                  : o,
              ),
            },
          };
        }),

      reorderObjects: (fromIndex, toIndex) =>
        set((s) => {
          const objects = [...s.project.objects];
          if (
            fromIndex < 0 ||
            fromIndex >= objects.length ||
            toIndex < 0 ||
            toIndex >= objects.length
          ) {
            return s;
          }
          const [moved] = objects.splice(fromIndex, 1);
          objects.splice(toIndex, 0, moved);
          return { project: { ...s.project, objects } };
        }),

      addColor: (color) =>
        set((s) => ({
          project: { ...s.project, colors: [...s.project.colors, color] },
        })),

      updateColor: (id, patch) =>
        set((s) => ({
          project: {
            ...s.project,
            colors: s.project.colors.map((c) =>
              c.id === id ? { ...c, ...patch } : c,
            ),
          },
        })),

      setSelection: (ids) => set({ selectedIds: ids }),
    }),
    {
      // Keep selection out of the undo history.
      partialize: (state): Partial<TrackedState> => ({
        project: state.project,
      }),
      limit: 100,
      equality: (a, b) => a.project === b.project,
    },
  ),
);

// Keep selection consistent with the document. `selectedIds` is transient (not
// part of the undo snapshot), so an undo/redo that restores a different set of
// objects can leave selected ids pointing at objects that no longer exist —
// which would make the Transformer and Properties panel target a ghost. Whenever
// the object set changes, drop any selected id that isn't present anymore.
useProjectStore.subscribe((state, prev) => {
  if (state.project.objects === prev.project.objects) return;
  const present = new Set(state.project.objects.map((o) => o.id));
  const kept = state.selectedIds.filter((id) => present.has(id));
  if (kept.length !== state.selectedIds.length) {
    useProjectStore.setState({ selectedIds: kept });
  }
});

/** Hook into zundo's temporal store for undo/redo controls. */
export function useTemporalStore<T>(
  selector: (state: TemporalState<Partial<TrackedState>>) => T,
): T {
  return useStore(useProjectStore.temporal, selector);
}
