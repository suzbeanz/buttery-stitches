import { create } from "zustand";
import { temporal } from "zundo";
import type { TemporalState } from "zundo";
import { useStore } from "zustand";
import type {
  EmbObject,
  EmbObjectParams,
  Point,
  Project,
  ThreadColor,
} from "../types/project";
import { createEmptyProject } from "../lib/project";
import { translatePaths } from "../lib/geometry";
import { expandGroups, pathsFromNodes, isClosedType } from "../lib/objects";
import { densifyRing } from "../lib/nodes";
import { smoothPath, smoothRingKeepingCorners } from "../lib/smooth";
import { mergeRegionPaths, splitRegionComponents } from "../lib/regions";
import { newId } from "../lib/id";

/**
 * Round an object's corners into flowing curves. Node-backed objects flip every
 * control node to smooth and re-densify (so the node tool stays in sync); plain
 * running lines and fill outlines get a corner-preserving spline. Satin columns
 * are left alone — smoothing rails independently would misalign the column.
 */
function smoothOne(o: EmbObject): EmbObject {
  if (o.nodes && o.nodes.length > 0) {
    const closed = isClosedType(o.type);
    const nodes = o.nodes.map((ring) => ring.map((n) => ({ ...n, smooth: true })));
    return { ...o, nodes, paths: nodes.map((ring) => densifyRing(ring, closed)) };
  }
  if (o.type === "running") {
    return { ...o, paths: o.paths.map((p) => smoothPath(p)) };
  }
  if (o.type === "fill") {
    return { ...o, paths: o.paths.map((r) => smoothRingKeepingCorners(r)) };
  }
  return o; // satin (rail pair) — leave untouched
}

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
  /** Insert objects immediately after `afterId` in ONE step (atomic undo). */
  insertObjectsAfter: (afterId: string, objects: EmbObject[]) => void;
  /** Split an open (running) node-line into two objects at `point`, inserted on
   *  segment `segIndex` of its node ring. No-op for closed/non-node objects. */
  splitObject: (id: string, segIndex: number, point: Point) => void;
  removeObjects: (ids: string[]) => void;
  updateObject: (id: string, patch: Partial<EmbObject>) => void;
  updateObjectParams: (id: string, patch: Partial<EmbObjectParams>) => void;
  /** Translate several objects together (one undo step). */
  moveObjects: (ids: string[], dxMm: number, dyMm: number) => void;
  /** Smooth the selected lines/curves: round their corners into flowing curves. */
  smoothObjects: (ids: string[]) => void;
  reorderObjects: (fromIndex: number, toIndex: number) => void;
  /** Move the selected objects in stitch order: one step or all the way. */
  moveOrder: (ids: string[], dir: "earlier" | "later" | "first" | "last") => void;
  /** Tie objects into one group (select/move/align together). */
  groupObjects: (ids: string[]) => void;
  /** Remove the group tag from any of these objects' groups. */
  ungroupObjects: (ids: string[]) => void;
  /** Union 2+ same-color fills into one region. No-op unless all are fills of
   *  the same color. */
  mergeObjects: (ids: string[]) => void;
  /** Separate a fill's disconnected pieces into one object each. No-op unless the
   *  object is a fill with 2+ components. */
  splitRegion: (id: string) => void;

  addColor: (color: ThreadColor) => void;
  updateColor: (id: string, patch: Partial<ThreadColor>) => void;
  removeColor: (id: string) => void;

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

      insertObjectsAfter: (afterId, objects) =>
        set((s) => {
          if (objects.length === 0) return s;
          const idx = s.project.objects.findIndex((o) => o.id === afterId);
          const next = [...s.project.objects];
          // After the anchor (or at the end if it's gone), in one mutation.
          next.splice(idx < 0 ? next.length : idx + 1, 0, ...objects);
          return {
            project: { ...s.project, objects: next },
            selectedIds: objects.map((o) => o.id),
          };
        }),

      splitObject: (id, segIndex, point) =>
        set((s) => {
          const idx = s.project.objects.findIndex((o) => o.id === id);
          if (idx < 0) return s;
          const o = s.project.objects[idx];
          const ring = o.nodes?.[0];
          // Only open node-backed lines (running) split cleanly here.
          if (!ring || isClosedType(o.type) || segIndex < 0 || segIndex >= ring.length - 1) return s;
          const cut = { x: point.x, y: point.y, smooth: false };
          const aNodes = [...ring.slice(0, segIndex + 1), cut];
          const bNodes = [cut, ...ring.slice(segIndex + 1)];
          if (aNodes.length < 2 || bNodes.length < 2) return s;
          const mk = (nodes: typeof ring): EmbObject => ({
            ...o,
            id: newId("obj"),
            nodes: [nodes],
            paths: pathsFromNodes([nodes], false),
          });
          const a = mk(aNodes);
          const b = mk(bNodes);
          const objects = [...s.project.objects];
          objects.splice(idx, 1, a, b);
          return { project: { ...s.project, objects }, selectedIds: [a.id, b.id] };
        }),

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
          // Hiding an object drops it from the selection — a hidden object can't
          // be on the canvas, so it shouldn't stay the active, editable target.
          selectedIds:
            patch.visible === false
              ? s.selectedIds.filter((sid) => sid !== id)
              : s.selectedIds,
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
                  ? {
                      ...o,
                      paths: translatePaths(o.paths, dxMm, dyMm),
                      satinCenterlines: o.satinCenterlines
                        ? translatePaths(o.satinCenterlines, dxMm, dyMm)
                        : undefined,
                    }
                  : o,
              ),
            },
          };
        }),

      smoothObjects: (ids) =>
        set((s) => {
          const sel = new Set(ids);
          return {
            project: {
              ...s.project,
              objects: s.project.objects.map((o) => (sel.has(o.id) ? smoothOne(o) : o)),
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

      moveOrder: (ids, dir) =>
        set((s) => {
          const sel = new Set(ids);
          if (sel.size === 0) return s;
          let objects = [...s.project.objects];
          if (dir === "first" || dir === "last") {
            const picked = objects.filter((o) => sel.has(o.id));
            const rest = objects.filter((o) => !sel.has(o.id));
            objects = dir === "first" ? [...picked, ...rest] : [...rest, ...picked];
          } else if (dir === "earlier") {
            // Shift the selected block one step toward index 0 (stitched earlier).
            for (let i = 1; i < objects.length; i++) {
              if (sel.has(objects[i].id) && !sel.has(objects[i - 1].id)) {
                [objects[i - 1], objects[i]] = [objects[i], objects[i - 1]];
              }
            }
          } else {
            // "later" — one step toward the end (stitched later, sits on top).
            for (let i = objects.length - 2; i >= 0; i--) {
              if (sel.has(objects[i].id) && !sel.has(objects[i + 1].id)) {
                [objects[i], objects[i + 1]] = [objects[i + 1], objects[i]];
              }
            }
          }
          return { project: { ...s.project, objects } };
        }),

      groupObjects: (ids) =>
        set((s) => {
          if (ids.length < 2) return s;
          const sel = new Set(ids);
          const gid = newId("grp");
          return {
            project: {
              ...s.project,
              objects: s.project.objects.map((o) =>
                sel.has(o.id) ? { ...o, groupId: gid } : o,
              ),
            },
          };
        }),

      ungroupObjects: (ids) =>
        set((s) => {
          const sel = new Set(ids);
          // Every group touched by the selection is dissolved.
          const groups = new Set(
            s.project.objects.filter((o) => sel.has(o.id) && o.groupId).map((o) => o.groupId),
          );
          if (groups.size === 0) return s;
          return {
            project: {
              ...s.project,
              objects: s.project.objects.map((o) =>
                o.groupId && groups.has(o.groupId) ? { ...o, groupId: undefined } : o,
              ),
            },
          };
        }),

      mergeObjects: (ids) =>
        set((s) => {
          const sel = new Set(ids);
          // Selected objects in document (stitch) order.
          const picked = s.project.objects.filter((o) => sel.has(o.id));
          if (picked.length < 2) return s;
          // Only same-color fills union sensibly.
          const first = picked[0];
          if (
            picked.some((o) => o.type !== "fill" || o.colorId !== first.colorId)
          )
            return s;
          const merged = mergeRegionPaths(picked.map((o) => o.paths));
          if (merged.length === 0) return s;
          const region: EmbObject = {
            ...first,
            id: newId("obj"),
            paths: merged,
            nodes: undefined,
            satinCenterlines: undefined,
            groupId: undefined,
          };
          // Replace the earliest selected with the merged region; drop the rest.
          const objects = s.project.objects
            .map((o) => (o.id === first.id ? region : o))
            .filter((o) => o.id === region.id || !sel.has(o.id));
          return { project: { ...s.project, objects }, selectedIds: [region.id] };
        }),

      splitRegion: (id) =>
        set((s) => {
          const idx = s.project.objects.findIndex((o) => o.id === id);
          if (idx < 0) return s;
          const o = s.project.objects[idx];
          if (o.type !== "fill") return s;
          const comps = splitRegionComponents(o.paths);
          if (comps.length < 2) return s;
          const parts: EmbObject[] = comps.map((paths, i) => ({
            ...o,
            id: newId("obj"),
            name: `${o.name} ${i + 1}`,
            paths,
            nodes: undefined,
            satinCenterlines: undefined,
            groupId: undefined,
          }));
          const objects = [...s.project.objects];
          objects.splice(idx, 1, ...parts);
          return {
            project: { ...s.project, objects },
            selectedIds: parts.map((p) => p.id),
          };
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

      // Remove a thread (never the last one). Defensively reassign anything still
      // pointing at it — an object's colorId or a fill's blend target — to the
      // first remaining thread, so a delete can never orphan a reference.
      removeColor: (id) =>
        set((s) => {
          if (s.project.colors.length <= 1) return s;
          const colors = s.project.colors.filter((c) => c.id !== id);
          const fallback = colors[0].id;
          const objects = s.project.objects.map((o) => {
            const colorId = o.colorId === id ? fallback : o.colorId;
            const blend = o.params?.blendColorId;
            const params = blend === id ? { ...o.params, blendColorId: fallback } : o.params;
            return colorId === o.colorId && params === o.params ? o : { ...o, colorId, params };
          });
          return { project: { ...s.project, colors, objects } };
        }),

      setSelection: (ids) =>
        set((s) => ({ selectedIds: expandGroups(s.project.objects, ids) })),
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
