import { create } from "zustand";
import type { EmbObject, Point, StitchType } from "../types/project";

/**
 * Transient editor UI state — current tool, in-progress drawing, ruler units,
 * and the color new objects are drawn with. Deliberately separate from the
 * project store so that picking a tool or moving the cursor never lands in the
 * undo history.
 */

export type Tool = "select" | "node" | "running" | "fill" | "satin";

/** Tools that place points to draw a new object — these map 1:1 to StitchType. */
export const DRAW_TOOLS: StitchType[] = ["running", "satin", "fill"];

/** Narrowing guard: a draw tool *is* a StitchType. */
export function isDrawTool(tool: Tool): tool is StitchType {
  return (DRAW_TOOLS as Tool[]).includes(tool);
}

export type RulerUnit = "mm" | "inch";

/** Edit the vector objects, or watch the stitches redraw. */
export type ViewMode = "edit" | "stitch";

interface EditorState {
  tool: Tool;
  /** points placed so far for the in-progress drawing (mm coordinates). */
  draft: Point[];
  /** live cursor position in mm while drawing (for the rubber-band preview). */
  cursorMm: Point | null;
  /** color id assigned to newly drawn objects. */
  activeColorId: string | null;
  rulerUnit: RulerUnit;
  /**
   * When on, the draw tools (running / satin / fill) treat placed points as
   * control points of a smooth curve: the live preview and the committed object
   * use a densified spline polyline instead of straight segments.
   */
  smooth: boolean;
  /** deep copies of objects held for paste (transient; not undone). */
  clipboard: EmbObject[];
  /** whether the left (layers) and right (properties) panels are open. */
  layersOpen: boolean;
  propertiesOpen: boolean;
  /** id of the text object being re-edited (double-click), or null. */
  editingTextId: string | null;

  // ---- preview / stitch simulator ----
  viewMode: ViewMode;
  /** total penetrations + jumps in the current design (set by the canvas). */
  simTotal: number;
  /** how many events of the design are drawn so far (the scrub position). */
  simIndex: number;
  simPlaying: boolean;
  /** playback speed in events per second. */
  simSpeed: number;

  setTool: (tool: Tool) => void;
  addDraftPoint: (p: Point) => void;
  setCursor: (p: Point | null) => void;
  clearDraft: () => void;
  setActiveColorId: (id: string | null) => void;
  setRulerUnit: (unit: RulerUnit) => void;
  setSmooth: (smooth: boolean) => void;
  toggleSmooth: () => void;
  setClipboard: (objects: EmbObject[]) => void;
  setLayersOpen: (open: boolean) => void;
  setPropertiesOpen: (open: boolean) => void;
  toggleLayers: () => void;
  toggleProperties: () => void;
  setEditingTextId: (id: string | null) => void;

  setViewMode: (mode: ViewMode) => void;
  setSimTotal: (total: number) => void;
  setSimIndex: (index: number) => void;
  setSimPlaying: (playing: boolean) => void;
  setSimSpeed: (speed: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: "select",
  draft: [],
  cursorMm: null,
  activeColorId: null,
  rulerUnit: "inch",
  smooth: false,
  clipboard: [],
  layersOpen: true,
  propertiesOpen: true,
  editingTextId: null,

  viewMode: "edit",
  simTotal: 0,
  simIndex: 0,
  simPlaying: false,
  simSpeed: 400,

  setTool: (tool) => set({ tool, draft: [], cursorMm: null }),
  addDraftPoint: (p) => set((s) => ({ draft: [...s.draft, p] })),
  setCursor: (p) => set({ cursorMm: p }),
  clearDraft: () => set({ draft: [], cursorMm: null }),
  setActiveColorId: (id) => set({ activeColorId: id }),
  setRulerUnit: (unit) => set({ rulerUnit: unit }),
  setSmooth: (smooth) => set({ smooth }),
  toggleSmooth: () => set((s) => ({ smooth: !s.smooth })),
  setClipboard: (clipboard) => set({ clipboard }),
  setLayersOpen: (layersOpen) => set({ layersOpen }),
  setPropertiesOpen: (propertiesOpen) => set({ propertiesOpen }),
  toggleLayers: () => set((s) => ({ layersOpen: !s.layersOpen })),
  toggleProperties: () => set((s) => ({ propertiesOpen: !s.propertiesOpen })),
  setEditingTextId: (editingTextId) => set({ editingTextId }),

  setViewMode: (viewMode) =>
    set((s) => ({
      viewMode,
      // Entering stitch view starts from the top; leaving stops playback.
      simPlaying: false,
      simIndex: viewMode === "stitch" ? s.simTotal : s.simIndex,
    })),
  setSimTotal: (simTotal) =>
    set((s) => ({ simTotal, simIndex: Math.min(s.simIndex, simTotal) })),
  setSimIndex: (simIndex) => set({ simIndex }),
  setSimPlaying: (simPlaying) => set({ simPlaying }),
  setSimSpeed: (simSpeed) => set({ simSpeed }),
}));
