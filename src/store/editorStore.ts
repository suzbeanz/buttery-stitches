import { create } from "zustand";
import type { EmbObject, Point, StitchType } from "../types/project";
import type { ShapeKind } from "../lib/shapes";

/** Whether the welcome panel has been dismissed before (persisted so it stays
 *  gone across reloads). Guarded for SSR / privacy-mode where storage may throw. */
const WELCOME_KEY = "bs:welcomeDismissed";
function readWelcomeDismissed(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    return false;
  }
}
function writeWelcomeDismissed(): void {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {
    /* ignore (private mode) */
  }
}

/**
 * Transient editor UI state — current tool, in-progress drawing, ruler units,
 * and the color new objects are drawn with. Deliberately separate from the
 * project store so that picking a tool or moving the cursor never lands in the
 * undo history.
 */

export type Tool =
  | "select"
  | "node"
  | "running"
  | "fill"
  | "satin"
  | "pan" // hand tool — drag to move the canvas
  | "pencil" // freehand running stitch
  | "brush" // freehand filled blob
  | "cut" // click a running line to split it into two objects
  | "measure" // drag to read off a distance + angle (no object created)
  | "satin2" // two-rail satin: draw edge A, then edge B (variable width)
  | "applique" // draw a closed shape stitched as an appliqué (placement/cover)
  | "shape"; // drag to place a premade shape (rectangle, ellipse, heart, …)

/** Tools that place points to draw a new object — these map 1:1 to StitchType. */
export const DRAW_TOOLS: StitchType[] = ["running", "satin", "fill"];

/** Narrowing guard: a draw tool *is* a StitchType. */
export function isDrawTool(tool: Tool): tool is StitchType {
  return (DRAW_TOOLS as Tool[]).includes(tool);
}

/** Tools that place points click-by-click (the 1:1 draw tools plus two-rail
 *  satin, which captures two click-drawn rails). Used to gate the draft flow. */
export function isPointTool(tool: Tool): boolean {
  return isDrawTool(tool) || tool === "satin2" || tool === "applique";
}

export type RulerUnit = "mm" | "inch";

/** Edit the vector objects, or watch the stitches redraw. */
export type ViewMode = "edit" | "stitch";

interface EditorState {
  tool: Tool;
  /** which premade shape the `shape` tool stamps (rectangle, ellipse, …). */
  shapeKind: ShapeKind;
  /** points placed so far for the in-progress drawing (mm coordinates). */
  draft: Point[];
  /** live cursor position in mm while drawing (for the rubber-band preview). */
  cursorMm: Point | null;
  /** first rail captured by the two-rail satin tool, while the second is drawn. */
  satinRailA: Point[] | null;
  /** color id assigned to newly drawn objects. */
  activeColorId: string | null;
  rulerUnit: RulerUnit;
  /**
   * When on, the draw tools (running / satin / fill) treat placed points as
   * control points of a smooth curve: the live preview and the committed object
   * use a densified spline polyline instead of straight segments.
   */
  smooth: boolean;
  /** snap moving/resizing objects to the hoop and other objects (default on). */
  snapEnabled: boolean;
  /** draw alignment guide lines while dragging (default on). */
  guidesEnabled: boolean;
  /** realistic (TrueView) thread shading in stitch view. */
  realistic: boolean;
  /** deep copies of objects held for paste (transient; not undone). */
  clipboard: EmbObject[];
  /** whether the left (layers) and right (properties) panels are open. */
  layersOpen: boolean;
  propertiesOpen: boolean;
  /** id of the text object being re-edited (double-click), or null. */
  editingTextId: string | null;
  /** a quick-start action requested from the empty-state guide. */
  pendingStart: "image" | "text" | null;
  /** the user dismissed the quick-start guide (clicked outside it). */
  startDismissed: boolean;
  /** fabric background color for the hoop mockup. */
  fabricColor: string;
  /** currently focused node for deletion: object id + ring + point index. */
  selectedNode: { objectId: string; ring: number; point: number } | null;

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
  setShapeKind: (kind: ShapeKind) => void;
  addDraftPoint: (p: Point) => void;
  setCursor: (p: Point | null) => void;
  clearDraft: () => void;
  setSatinRailA: (rail: Point[] | null) => void;
  setActiveColorId: (id: string | null) => void;
  setRulerUnit: (unit: RulerUnit) => void;
  setSmooth: (smooth: boolean) => void;
  toggleSmooth: () => void;
  toggleSnap: () => void;
  toggleGuides: () => void;
  toggleRealistic: () => void;
  setClipboard: (objects: EmbObject[]) => void;
  setLayersOpen: (open: boolean) => void;
  setPropertiesOpen: (open: boolean) => void;
  toggleLayers: () => void;
  toggleProperties: () => void;
  setEditingTextId: (id: string | null) => void;
  setPendingStart: (v: "image" | "text" | null) => void;
  setStartDismissed: (v: boolean) => void;
  setFabricColor: (v: string) => void;
  setSelectedNode: (
    v: { objectId: string; ring: number; point: number } | null,
  ) => void;

  setViewMode: (mode: ViewMode) => void;
  setSimTotal: (total: number) => void;
  setSimIndex: (index: number) => void;
  setSimPlaying: (playing: boolean) => void;
  setSimSpeed: (speed: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: "select",
  shapeKind: "rectangle",
  draft: [],
  satinRailA: null,
  cursorMm: null,
  activeColorId: null,
  rulerUnit: "inch",
  smooth: false,
  snapEnabled: true,
  guidesEnabled: true,
  realistic: true,
  clipboard: [],
  layersOpen: true,
  propertiesOpen: true,
  editingTextId: null,
  pendingStart: null,
  // The welcome ("Let's make something") is shown until dismissed, then stays
  // gone — persisted so it doesn't reappear on reload or after the canvas empties.
  startDismissed: readWelcomeDismissed(),
  fabricColor: "#ECE8DE",
  selectedNode: null,

  viewMode: "edit",
  simTotal: 0,
  simIndex: 0,
  simPlaying: false,
  simSpeed: 400,

  setTool: (tool) => set({ tool, draft: [], cursorMm: null, satinRailA: null }),
  setShapeKind: (shapeKind) => set({ shapeKind }),
  addDraftPoint: (p) => set((s) => ({ draft: [...s.draft, p] })),
  setCursor: (p) => set({ cursorMm: p }),
  clearDraft: () => set({ draft: [], cursorMm: null }),
  setSatinRailA: (satinRailA) => set({ satinRailA }),
  setActiveColorId: (id) => set({ activeColorId: id }),
  setRulerUnit: (unit) => set({ rulerUnit: unit }),
  setSmooth: (smooth) => set({ smooth }),
  toggleSmooth: () => set((s) => ({ smooth: !s.smooth })),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  toggleGuides: () => set((s) => ({ guidesEnabled: !s.guidesEnabled })),
  toggleRealistic: () => set((s) => ({ realistic: !s.realistic })),
  setClipboard: (clipboard) => set({ clipboard }),
  setLayersOpen: (layersOpen) => set({ layersOpen }),
  setPropertiesOpen: (propertiesOpen) => set({ propertiesOpen }),
  toggleLayers: () => set((s) => ({ layersOpen: !s.layersOpen })),
  toggleProperties: () => set((s) => ({ propertiesOpen: !s.propertiesOpen })),
  setEditingTextId: (editingTextId) => set({ editingTextId }),
  setPendingStart: (pendingStart) => set({ pendingStart }),
  setStartDismissed: (startDismissed) => {
    if (startDismissed) writeWelcomeDismissed();
    set({ startDismissed });
  },
  setFabricColor: (fabricColor) => set({ fabricColor }),
  setSelectedNode: (selectedNode) => set({ selectedNode }),

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
