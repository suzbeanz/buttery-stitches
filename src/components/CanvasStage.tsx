import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  X,
  Image as ImageIcon,
  Type,
  Pencil,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Spline,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  Stage,
  Layer,
  Rect,
  Line,
  Text,
  Circle,
  Group,
  Shape,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore, isDrawTool, isPointTool } from "../store/editorStore";
import type { EmbObject, Path, Point, ThreadColor } from "../types/project";
import { makeObject, makeObjectFromPaths, makeNodeObject, makeSatinFromRails, minPointsFor, pathsFromNodes, isClosedType } from "../lib/objects";
import { densifyRing, insertNode, moveNode, deleteNode, toggleNodeSmooth, translateNodes, type NodePath } from "../lib/nodes";
import { shapeFromDrag, shapeRings, type ShapeKind } from "../lib/shapes";
import { bucketFill } from "../lib/paintbucket";
import {
  translatePaths,
  dedupePath,
  applyMatrix,
  pathsBounds,
  distance,
  type Matrix,
  type Bounds,
} from "../lib/geometry";
import { snap } from "../lib/snap";
import { douglasPeucker } from "../lib/trace/simplify";
import { toast } from "../store/toastStore";
import { rectFromPoints, rectSpanMm, marqueeSelect } from "../lib/marquee";
import { smoothPath } from "../lib/smooth";
import { computeTicksRange } from "../lib/ruler";
import { mmToInch } from "../lib/units";
import ContextMenu from "./ContextMenu";
import { buildTestSwatch } from "../lib/samples/swatch";
import { designFor, orientByDepth } from "../lib/engine";
import { designToSegments, needleAt } from "../lib/engine/render";
import { drawStitches } from "../lib/render-stitches";

/**
 * Center canvas: the hoop, butter-stick measurement rulers, all stitch objects,
 * and the manual-editing interactions.
 *
 *   Select tool — click to select, drag the body to move, transform handles to
 *                 scale/rotate. Transforms are baked back into millimeter paths.
 *   Node tool   — drag individual vertices.
 *   Draw tools  — click to place points; double-click / Enter to finish.
 *
 * Everything lives in one Konva stage so the rulers and the design share a
 * single millimeter→pixel transform. Move/transform/node edits each write to the
 * store exactly once (on gesture end) so undo steps map to whole gestures.
 */

const RULER = 22; // px thickness of the top/left rulers
const PADDING = 48; // px breathing room around the hoop (room for frame + bracket)
const MIN_ZOOM = 0.5; // furthest out (half the fit size)
const MAX_ZOOM = 10; // closest in (10× the fit size)
const ZOOM_STEP = 1.25; // per button press / wheel notch
const SNAP_MM = 3; // snap distance (mm) for alignment to hoop/object edges
const JOIN_SNAP_MM = 3; // snap the closing end of a fill polygon to its start
const HOOP_BAND = 14; // px thickness of the hoop frame in the mockup
const HOOP_MARGIN = 18; // px of fabric/plastic between the stitch field and the frame opening

const C = {
  cream: "#F6EFCB", // wrapper-cream paper, the canvas surround
  fabric: "#ECE8DE", // soft neutral "fabric" so light thread colors stay visible
  butter: "#F1DE8B", // churned-butter band for the in-canvas rulers
  butterDeep: "#E7CC63",
  navy: "#173A7A", // press blue ink
  navySoft: "#2E4F8C",
  salted: "#B23A2E", // stamp red accent
};

/** Closest point on segment a→b to p, and the distance to it. */
function projectOnSegment(p: Point, a: Point, b: Point): { point: Point; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, dist: Math.hypot(point.x - p.x, point.y - p.y) };
}

export default function CanvasStage() {
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const setSelection = useProjectStore((s) => s.setSelection);
  const updateObject = useProjectStore((s) => s.updateObject);
  const addObject = useProjectStore((s) => s.addObject);
  const splitObject = useProjectStore((s) => s.splitObject);

  const tool = useEditorStore((s) => s.tool);
  const shapeKind = useEditorStore((s) => s.shapeKind);
  const draft = useEditorStore((s) => s.draft);
  const cursorMm = useEditorStore((s) => s.cursorMm);
  const satinRailA = useEditorStore((s) => s.satinRailA);
  const rulerUnit = useEditorStore((s) => s.rulerUnit);
  const fabricColor = useEditorStore((s) => s.fabricColor);
  const startDismissed = useEditorStore((s) => s.startDismissed);
  const setStartDismissed = useEditorStore((s) => s.setStartDismissed);
  const activeColorId = useEditorStore((s) => s.activeColorId);
  const addDraftPoint = useEditorStore((s) => s.addDraftPoint);
  const setCursor = useEditorStore((s) => s.setCursor);
  const clearDraft = useEditorStore((s) => s.clearDraft);
  const smooth = useEditorStore((s) => s.smooth);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const guidesEnabled = useEditorStore((s) => s.guidesEnabled); // workspace gridlines

  // Viewport zoom (1 = fit-to-workspace) and pan (px), shared by edit + stitch.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Active two-finger gesture (pinch-zoom + pan) and single-touch tap tracking.
  const pinchRef = useRef<{
    startDist: number;
    mmAtMid: Point;
    startZoom: number;
  } | null>(null);
  const touchStartRef = useRef<{ mm: Point; moved: boolean } | null>(null);
  // Freehand pencil stroke in progress, and a single-finger pan anchor.
  const pencilingRef = useRef(false);
  const panTouchRef = useRef<{ x: number; y: number } | null>(null);
  // Long-press is the touch stand-in for right-click: a finger held still on an
  // object opens the context menu. `timer` fires after the hold; `fired` tells
  // touchend to suppress its tap (and the ghost click that would dismiss the menu).
  const longPressRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  function cancelLongPress() {
    if (longPressRef.current !== null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }

  const viewMode = useEditorStore((s) => s.viewMode);
  const simPlaying = useEditorStore((s) => s.simPlaying);
  const setSimTotal = useEditorStore((s) => s.setSimTotal);
  const setSimIndex = useEditorStore((s) => s.setSimIndex);
  // Note: `simIndex` is intentionally NOT subscribed here. It changes every
  // animation frame during playback; reading it inside StitchView keeps the
  // (hidden) edit layer from re-rendering on every frame.

  // The assembled design drives both this preview and the exporter.
  const design = useMemo(() => designFor(project), [project]);
  useEffect(() => setSimTotal(design.length), [design, setSimTotal]);

  // Whenever Stitch view is showing and we're not mid-playback, pin the cursor
  // to the FRESH stitch count so the finished design is always on screen. This
  // is what prevents the "empty hoop" frame: relying on a possibly-stale total
  // at the moment the view switches could otherwise leave the cursor at 0.
  useEffect(() => {
    if (viewMode === "stitch" && !simPlaying) {
      setSimTotal(design.length);
      setSimIndex(design.length);
    }
  }, [viewMode, simPlaying, design, setSimTotal, setSimIndex]);

  // Bounding box of every object (mm) — snap targets while dragging.
  const objectBounds = useMemo(
    () =>
      project.objects
        .map((o) => ({ id: o.id, b: pathsBounds(o.paths) }))
        .filter((x): x is { id: string; b: Bounds } => x.b !== null),
    [project.objects],
  );
  // Active alignment guide lines (mm) shown while dragging.
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  // Rubber-band marquee (drag-to-select) in mm, while dragging on empty canvas.
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(null);
  // In-progress shape drag (mm) for the shape tool — its bounding box sizes the
  // premade shape, committed on release.
  const [shapeDraft, setShapeDraft] = useState<{ start: Point; end: Point } | null>(null);
  // Measure tool: a transient ruler segment (mm). Stays on screen after release
  // until you measure again, switch tools, or press Escape — no object is made.
  const [measure, setMeasure] = useState<{ start: Point; end: Point } | null>(null);
  const measuringRef = useRef(false);
  // Direction tool: drag a line across a selected fill to paint its stitch grain.
  // On release the line's angle is written to each selected fill's directionDeg.
  // The freehand path captured by the Direction tool: a near-straight drag sets a
  // straight grain (directionDeg); a curved drag sets a flow curve (flowPath).
  const [dirDrag, setDirDrag] = useState<Point[] | null>(null);
  const dirDraggingRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { hoop } = project;
  // On a phone the fixed 48px breathing room is a big slice of a small canvas.
  // Edit view draws only a plain dashed hoop rect (no protruding frame/brackets),
  // so it's safe to tighten the padding there for more drawing room; stitch view
  // keeps the full padding its decorative hoop mockup needs.
  const narrow = size.width > 0 && size.width < 560;
  const pad = narrow && viewMode === "edit" ? 16 : PADDING;
  const availW = size.width - RULER - pad * 2;
  const availH = size.height - RULER - pad * 2;
  // Base "fit" scale (hoop fills the workspace), then the user's zoom on top.
  const fitScale =
    availW > 0 && availH > 0 ? Math.min(availW / hoop.wMm, availH / hoop.hMm) : 1;
  const scale = fitScale * zoom;
  const hoopW = hoop.wMm * scale;
  const hoopH = hoop.hMm * scale;
  // Hoop is centered at fit, then shifted by the user's pan (px).
  const baseOriginX = RULER + pad + (availW - hoopW) / 2;
  const baseOriginY = RULER + pad + (availH - hoopH) / 2;
  const originX = baseOriginX + pan.x;
  const originY = baseOriginY + pan.y;

  // Hoop-mockup geometry: the frame opening is larger than the stitchable field,
  // so there's visible fabric margin beyond the workable area (as on a real hoop).
  const openL = originX - HOOP_MARGIN;
  const openT = originY - HOOP_MARGIN;
  const openW = hoopW + HOOP_MARGIN * 2;
  const openH = hoopH + HOOP_MARGIN * 2;

  const px = (xMm: number) => originX + xMm * scale;
  const py = (yMm: number) => originY + yMm * scale;
  const toMm = (sx: number, sy: number): Point => ({
    x: (sx - originX) / scale,
    y: (sy - originY) / scale,
  });

  // Re-zoom so the mm point currently under (anchorX, anchorY) px stays put.
  function zoomToAnchor(nextZoom: number, anchorX: number, anchorY: number) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    const mx = (anchorX - originX) / scale;
    const my = (anchorY - originY) / scale;
    const newScale = fitScale * z;
    const nbX = RULER + pad + (availW - hoop.wMm * newScale) / 2;
    const nbY = RULER + pad + (availH - hoop.hMm * newScale) / 2;
    setZoom(z);
    setPan({ x: anchorX - mx * newScale - nbX, y: anchorY - my * newScale - nbY });
  }

  function onWheelZoom(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const ptr = stage?.getPointerPosition();
    if (!ptr) return;
    zoomToAnchor(zoom * (e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), ptr.x, ptr.y);
  }

  // Buttons zoom toward the center of the workspace.
  const centerX = RULER + (size.width - RULER) / 2;
  const centerY = RULER + (size.height - RULER) / 2;
  const zoomIn = () => zoomToAnchor(zoom * ZOOM_STEP, centerX, centerY);
  const zoomOut = () => zoomToAnchor(zoom / ZOOM_STEP, centerX, centerY);
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Keyboard zoom (⌘/Ctrl +/−/0) is dispatched from the global shortcut handler in
  // App as a window event, since the viewport transform lives here in the stage.
  useEffect(() => {
    const onZoom = (e: Event) => {
      const cmd = (e as CustomEvent<"in" | "out" | "fit">).detail;
      if (cmd === "in") zoomIn();
      else if (cmd === "out") zoomOut();
      else resetView();
    };
    window.addEventListener("bs:zoom", onZoom);
    return () => window.removeEventListener("bs:zoom", onZoom);
  });

  const colorById = useMemo(
    () => new Map<string, ThreadColor>(project.colors.map((c) => [c.id, c])),
    [project.colors],
  );

  // --- selection / transform plumbing ---
  const nodeRefs = useRef(new Map<string, Konva.Group>());
  const trRef = useRef<Konva.Transformer>(null);
  // Right-click context menu: screen position, or null when closed.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Map a right-clicked Konva node to its object id by walking up to the
  // per-object Group registered in nodeRefs.
  function objectIdAt(target: Konva.Node | null): string | null {
    for (let node: Konva.Node | null = target; node; node = node.getParent()) {
      for (const [id, n] of nodeRefs.current) if (n === node) return id;
    }
    return null;
  }
  function onStageContextMenu(e: Konva.KonvaEventObject<MouseEvent>) {
    e.evt.preventDefault(); // never show the browser's menu over the canvas
    if (viewMode === "stitch") return; // editing is disabled in stitch view
    const id = objectIdAt(e.target);
    if (!id) return setMenu(null); // empty space → just dismiss
    if (!useProjectStore.getState().selectedIds.includes(id)) setSelection([id]);
    setMenu({ x: e.evt.clientX, y: e.evt.clientY });
  }
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node =
      tool === "select" && selectedIds.length === 1
        ? nodeRefs.current.get(selectedIds[0])
        : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [tool, selectedIds, project.objects]);

  // --- commit / cancel the in-progress drawing ---
  function finishDraft() {
    // Two-rail satin: first finish captures edge A, the second builds the column.
    if (tool === "satin2") {
      const rail = dedupePath(draft);
      if (rail.length < 2) {
        clearDraft();
        return;
      }
      const finalRail = smooth ? smoothPath(rail) : rail;
      const railA = useEditorStore.getState().satinRailA;
      if (!railA) {
        useEditorStore.getState().setSatinRailA(finalRail);
        clearDraft();
        return;
      }
      const colorId =
        useEditorStore.getState().activeColorId ??
        useProjectStore.getState().project.colors[0]?.id;
      if (colorId) addObject(makeSatinFromRails(railA, finalRail, colorId));
      useEditorStore.getState().setSatinRailA(null);
      clearDraft();
      return;
    }
    // Appliqué: a closed outline stitched as placement → cover (params.applique).
    if (tool === "applique") {
      let ring = dedupePath(draft);
      if (ring.length >= 4 && distance(ring[0], ring[ring.length - 1]) < JOIN_SNAP_MM) {
        ring = ring.slice(0, -1);
      }
      if (ring.length < 3) {
        clearDraft();
        return;
      }
      const colorId =
        useEditorStore.getState().activeColorId ??
        useProjectStore.getState().project.colors[0]?.id;
      if (colorId) {
        const o = makeObjectFromPaths("fill", [smooth ? smoothPath(ring) : ring], colorId);
        o.params.applique = true;
        addObject(o);
      }
      clearDraft();
      return;
    }
    if (!isDrawTool(tool)) return;
    let cleaned = dedupePath(draft); // drop double-click / stationary dupes
    // Smart snap-join: when closing a fill polygon, if the last point lands near
    // the first, drop it so the closing edge meets cleanly instead of leaving a
    // tiny overlapping sliver.
    if (tool === "fill" && cleaned.length >= 4) {
      const first = cleaned[0];
      const last = cleaned[cleaned.length - 1];
      if (distance(first, last) < JOIN_SNAP_MM) cleaned = cleaned.slice(0, -1);
    }
    if (cleaned.length < minPointsFor(tool)) {
      clearDraft();
      return;
    }
    // Read the color list fresh (not via the render closure): a draft can be
    // finished after colors changed, and a stale empty list would silently
    // drop the shape.
    const colorId =
      useEditorStore.getState().activeColorId ??
      useProjectStore.getState().project.colors[0]?.id;
    if (!colorId) return;
    if (tool === "satin") {
      // Satin keeps the centerline→rails model (no node editing); the Curve
      // toggle densifies the centerline before the rails are derived.
      addObject(makeObject("satin", smooth ? smoothPath(cleaned) : cleaned, colorId));
    } else {
      // Running / fill keep their placed points as editable control NODES, each
      // seeded smooth (Curve on) or corner (Curve off); paths densify from them.
      addObject(makeNodeObject(tool, cleaned, colorId, smooth));
    }
    clearDraft();
  }

  // Commit a recorded freehand stroke: the pencil makes a smooth running line,
  // the brush a smooth filled blob (its outline auto-closes into a fill region).
  function finishPencil() {
    if (!pencilingRef.current) return;
    pencilingRef.current = false;
    const t = useEditorStore.getState().tool;
    const pts = dedupePath(useEditorStore.getState().draft);
    const colorId =
      useEditorStore.getState().activeColorId ??
      useProjectStore.getState().project.colors[0]?.id;
    if (colorId) {
      if (t === "brush" && pts.length >= 3) {
        addObject(makeObjectFromPaths("fill", [smoothPath(pts)], colorId));
      } else if (pts.length >= 2) {
        addObject(makeObject("running", smoothPath(pts), colorId));
      }
    }
    clearDraft();
  }
  // Always-fresh ref so the window pointer-up listener finishes the latest stroke.
  const finishPencilRef = useRef(finishPencil);
  finishPencilRef.current = finishPencil;
  useEffect(() => {
    const end = () => finishPencilRef.current();
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchend", end);
    };
  }, []);

  // Hold Shift to lock a resize to the object's aspect ratio (like Figma/Illustrator).
  // The Transformer's `shiftBehavior="none"` stops Konva from inverting on Shift, so we
  // drive keepRatio ourselves: Konva then handles the proportional anchor math.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Shift") trRef.current?.keepRatio(e.type === "keydown");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Paint-bucket flood for the Fill tool: if `at` sits in an area ENCLOSED by
  // existing outlines, fill just that area into a new fill object and return true.
  // Returns false when the click isn't enclosed (so the Fill tool falls back to
  // drawing an outline click-by-click instead).
  function tryFloodFill(at: Point): boolean {
    const colorId =
      useEditorStore.getState().activeColorId ??
      useProjectStore.getState().project.colors[0]?.id;
    if (!colorId) return false;
    const outlines = project.objects.filter((o) => o.visible).flatMap((o) => o.paths);
    if (outlines.length === 0) return false;
    const ob = pathsBounds(outlines);
    const area = {
      minX: Math.min(0, ob?.minX ?? 0) - 2,
      minY: Math.min(0, ob?.minY ?? 0) - 2,
      maxX: Math.max(hoop.wMm, ob?.maxX ?? hoop.wMm) + 2,
      maxY: Math.max(hoop.hMm, ob?.maxY ?? hoop.hMm) + 2,
    };
    const rings = bucketFill(outlines, at, area, 0.3, true); // requireEnclosed
    if (rings && rings.length) {
      addObject(makeObjectFromPaths("fill", rings, colorId));
      return true;
    }
    return false;
  }

  // Cut tool: split the running line nearest the click into two objects at that
  // point. Closed/satin objects aren't split (ambiguous), so they're skipped.
  function cutAt(at: Point) {
    const tolMm = 6 / scale; // ~6px hit tolerance in mm
    let best: { id: string; segIndex: number; point: Point; dist: number } | null = null;
    for (const o of project.objects) {
      if (!o.visible || isClosedType(o.type) || !o.nodes?.[0]) continue;
      const ring = o.nodes[0];
      for (let i = 0; i < ring.length - 1; i++) {
        const pr = projectOnSegment(at, ring[i], ring[i + 1]);
        if (!best || pr.dist < best.dist) best = { id: o.id, segIndex: i, point: pr.point, dist: pr.dist };
      }
    }
    if (best && best.dist <= Math.max(2, tolMm)) {
      splitObject(best.id, best.segIndex, best.point);
      toast("Line split in two", "success");
    } else {
      // Silent misses make the tool feel broken — say what to aim at.
      toast("Click directly on a running line to split it", "info");
    }
  }

  // Shape tool: commit the dragged bounding box as a premade shape object.
  function finishShape() {
    const d = shapeDraftRef.current;
    if (!d) return;
    setShapeDraft(null);
    const colorId =
      useEditorStore.getState().activeColorId ??
      useProjectStore.getState().project.colors[0]?.id;
    if (!colorId) return;
    const obj = shapeFromDrag(useEditorStore.getState().shapeKind, d.start, d.end, colorId);
    if (obj) addObject(obj);
  }
  const shapeDraftRef = useRef(shapeDraft);
  shapeDraftRef.current = shapeDraft;
  const finishShapeRef = useRef(finishShape);
  finishShapeRef.current = finishShape;
  useEffect(() => {
    const end = () => finishShapeRef.current();
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchend", end);
    };
  }, []);

  // Toggle the focused node between a smooth curve and a sharp corner. Shared by
  // the keyboard ('c') and the on-screen node bar (the touch path). Returns true
  // if it acted on a node-backed object.
  function toggleSelectedNodeSmooth(): boolean {
    const node = useEditorStore.getState().selectedNode;
    const obj = node && useProjectStore.getState().project.objects.find((o) => o.id === node.objectId);
    if (!obj || !obj.nodes?.[node!.ring]) return false;
    const nodes = obj.nodes.map((r, i) => (i === node!.ring ? toggleNodeSmooth(r, node!.point) : r));
    updateObject(obj.id, { nodes, paths: pathsFromNodes(nodes, obj.type === "fill") });
    return true;
  }

  // Delete the focused node (node-backed or legacy polyline), keeping the ring
  // above its minimum point count. Shared by the keyboard and the node bar.
  function deleteSelectedNode(): boolean {
    const node = useEditorStore.getState().selectedNode;
    if (!node) return false;
    const obj = useProjectStore.getState().project.objects.find((o) => o.id === node.objectId);
    if (obj) {
      const closed = obj.type === "fill";
      const min = closed ? 3 : 2;
      if (obj.nodes?.[node.ring]) {
        // Node-backed object: drop the control node, re-densify.
        if (obj.nodes[node.ring].length > min) {
          const nodes = obj.nodes.map((r, i) => (i === node.ring ? deleteNode(r, node.point) : r));
          updateObject(obj.id, { nodes, paths: pathsFromNodes(nodes, closed) });
        }
      } else {
        // Legacy polyline: drop the raw vertex.
        const ring = obj.paths[node.ring];
        if (ring && ring.length > min) {
          const paths = obj.paths.map((p, i) =>
            i === node.ring ? p.filter((_, j) => j !== node.point) : p,
          );
          updateObject(obj.id, { paths });
        }
      }
    }
    useEditorStore.getState().setSelectedNode(null);
    return true;
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "Enter") finishDraft();
      else if (e.key === "Escape") {
        clearDraft();
        setMeasure(null);
        measuringRef.current = false;
        setDirDrag(null);
        dirDraggingRef.current = false;
        useEditorStore.getState().setSatinRailA(null);
        useEditorStore.getState().setSelectedNode(null);
      } else if ((e.key === "c" || e.key === "C") && tool === "node") {
        if (toggleSelectedNodeSmooth()) e.preventDefault();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (tool === "node" && useEditorStore.getState().selectedNode) {
          e.preventDefault();
          deleteSelectedNode();
        } else if (tool === "select" && selectedIds.length) {
          e.preventDefault();
          useProjectStore.getState().removeObjects(selectedIds);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, draft, selectedIds, activeColorId, smooth]);

  // Drop the ruler segment when you leave the Measure tool.
  useEffect(() => {
    if (tool !== "measure") {
      setMeasure(null);
      measuringRef.current = false;
    }
    if (tool !== "direction") {
      setDirDrag(null);
      dirDraggingRef.current = false;
    }
  }, [tool]);

  // --- stage pointer handlers ---
  function stagePointMm(stage: Konva.Stage): Point | null {
    const pos = stage.getPointerPosition();
    return pos ? toMm(pos.x, pos.y) : null;
  }

  // Middle-mouse drag pans the workspace (in either view) without disturbing
  // tools or selection.
  function startPan(e: Konva.KonvaEventObject<MouseEvent>) {
    e.evt.preventDefault();
    const sx = e.evt.clientX;
    const sy = e.evt.clientY;
    const sp = { ...pan };
    const move = (ev: MouseEvent) =>
      setPan({ x: sp.x + (ev.clientX - sx), y: sp.y + (ev.clientY - sy) });
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function onStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.evt.button === 1) return startPan(e); // middle button → pan (any view)
    if (tool === "pan") return startPan(e); // hand tool → drag to pan (any view)
    if (viewMode === "stitch") return; // simulation view is read-only
    const stage = e.target.getStage();
    if (!stage) return;
    // Pencil / brush: begin recording a freehand stroke.
    if (tool === "pencil" || tool === "brush") {
      const p = stagePointMm(stage);
      if (p) {
        clearDraft();
        addDraftPoint(p);
        pencilingRef.current = true;
      }
      return;
    }
    // Shape: begin a drag whose bounding box sizes the shape.
    if (tool === "shape") {
      const p = stagePointMm(stage);
      if (p) setShapeDraft({ start: p, end: p });
      return;
    }
    // Cut: click a running line to split it into two objects.
    if (tool === "cut") {
      const p = stagePointMm(stage);
      if (p) cutAt(p);
      return;
    }
    // Measure: drag a ruler segment; updates live and reads out on release.
    if (tool === "measure") {
      const p = stagePointMm(stage);
      if (p) {
        setMeasure({ start: p, end: p });
        measuringRef.current = true;
      }
      return;
    }
    // Direction: drag across a selected fill to paint its stitch grain.
    if (tool === "direction") {
      const p = stagePointMm(stage);
      if (p) {
        setDirDrag([p]);
        dirDraggingRef.current = true;
      }
      return;
    }
    if (!isPointTool(tool)) {
      // Press on empty canvas with the select tool begins a rubber-band marquee;
      // the actual selection (or a plain clear) is resolved on release.
      if (e.target === stage && tool === "select") {
        const p = stagePointMm(stage);
        if (p) setMarquee({ start: p, end: p });
      } else if (e.target === stage) {
        setSelection([]); // click empty canvas clears
      }
      return;
    }
    const p = stagePointMm(stage);
    if (!p) return;
    // Fill's FIRST click floods a bounded area (the old paint-bucket); if the click
    // isn't enclosed it begins drawing an outline to fill click-by-click.
    if (tool === "fill" && useEditorStore.getState().draft.length === 0 && tryFloodFill(p)) return;
    addDraftPoint(p);
  }

  function onStageMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (viewMode === "stitch") return;
    const stage = e.target.getStage();
    if (!stage) return;
    // Pencil: append to the freehand stroke (thinned so we don't record a point
    // every pixel — ~0.8mm spacing keeps the path light and smooth).
    if (pencilingRef.current) {
      const p = stagePointMm(stage);
      if (p) {
        const d = useEditorStore.getState().draft;
        const last = d[d.length - 1];
        if (!last || distance(last, p) >= 0.8) addDraftPoint(p);
      }
      return;
    }
    if (shapeDraft) {
      const p = stagePointMm(stage);
      if (p) setShapeDraft((d) => (d ? { ...d, end: p } : d));
      return;
    }
    if (marquee) {
      const p = stagePointMm(stage);
      if (p) setMarquee((m) => (m ? { ...m, end: p } : m));
      return;
    }
    if (measuringRef.current) {
      const p = stagePointMm(stage);
      if (p) setMeasure((m) => (m ? { ...m, end: p } : m));
      return;
    }
    if (dirDraggingRef.current) {
      const p = stagePointMm(stage);
      if (p) setDirDrag((d) => (d && distance(d[d.length - 1], p) >= 0.8 ? [...d, p] : d));
      return;
    }
    if (!isPointTool(tool)) return;
    setCursor(stagePointMm(stage));
  }

  // --- touch: pinch-zoom + two-finger pan, and tap-to-draw/select ---
  function twoFinger(stage: Konva.Stage): { dist: number; mid: { x: number; y: number } } | null {
    const ps = stage.getPointersPositions();
    if (ps.length < 2) return null;
    const [a, b] = ps;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function onTouchStart(e: Konva.KonvaEventObject<TouchEvent>) {
    const stage = e.target.getStage();
    if (!stage) return;
    if (e.evt.touches.length >= 2) {
      // Begin a pinch — cancel any single-finger marquee/tap/long-press in progress.
      setMarquee(null);
      touchStartRef.current = null;
      cancelLongPress();
      const info = twoFinger(stage);
      if (info) {
        pinchRef.current = { startDist: info.dist, mmAtMid: toMm(info.mid.x, info.mid.y), startZoom: zoom };
      }
      return;
    }
    pinchRef.current = null;
    // Hand tool: one finger drags the canvas (any view).
    if (tool === "pan") {
      const t = e.evt.touches[0];
      if (t) panTouchRef.current = { x: t.clientX, y: t.clientY };
      return;
    }
    if (viewMode === "stitch") return;
    const p = stagePointMm(stage);
    // Pencil / brush: one finger draws a freehand stroke.
    if ((tool === "pencil" || tool === "brush") && p) {
      clearDraft();
      addDraftPoint(p);
      pencilingRef.current = true;
      return;
    }
    // Shape: one finger drags the shape's bounding box.
    if (tool === "shape" && p) {
      setShapeDraft({ start: p, end: p });
      return;
    }
    // Cut: tap a running line to split it.
    if (tool === "cut" && p) {
      cutAt(p);
      return;
    }
    // Measure: one finger drags the ruler segment.
    if (tool === "measure" && p) {
      setMeasure({ start: p, end: p });
      measuringRef.current = true;
      return;
    }
    // Direction: one finger drags to paint the selected fill's grain.
    if (tool === "direction" && p) {
      setDirDrag([p]);
      dirDraggingRef.current = true;
      return;
    }
    touchStartRef.current = p ? { mm: p, moved: false } : null;
    longPressFiredRef.current = false;
    cancelLongPress();
    // Select tool on empty canvas → rubber-band; drawing taps are placed on release.
    if (!isDrawTool(tool) && tool === "select" && e.target === stage && p) {
      setMarquee({ start: p, end: p });
    }
    // Long-press an object → open the context menu (the touch right-click). Only
    // where right-click itself works: an editing tool (select/node) over an object.
    if ((tool === "select" || tool === "node") && e.target !== stage) {
      const id = objectIdAt(e.target);
      const t = e.evt.touches[0];
      if (id && t) {
        const cx = t.clientX;
        const cy = t.clientY;
        longPressRef.current = window.setTimeout(() => {
          longPressRef.current = null;
          longPressFiredRef.current = true;
          if (!useProjectStore.getState().selectedIds.includes(id)) setSelection([id]);
          setMarquee(null);
          touchStartRef.current = null;
          setMenu({ x: cx, y: cy });
        }, 480);
      }
    }
  }

  function onTouchMove(e: Konva.KonvaEventObject<TouchEvent>) {
    const stage = e.target.getStage();
    if (!stage) return;
    if (pinchRef.current && e.evt.touches.length >= 2) {
      const info = twoFinger(stage);
      if (!info) return;
      const { startDist, mmAtMid, startZoom } = pinchRef.current;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (startZoom * info.dist) / startDist));
      const newScale = fitScale * z;
      const nbX = RULER + pad + (availW - hoop.wMm * newScale) / 2;
      const nbY = RULER + pad + (availH - hoop.hMm * newScale) / 2;
      // Zoom about the pinch midpoint AND pan with it (so two fingers also drag).
      setZoom(z);
      setPan({ x: info.mid.x - mmAtMid.x * newScale - nbX, y: info.mid.y - mmAtMid.y * newScale - nbY });
      return;
    }
    // Hand tool: pan by the one-finger delta.
    if (tool === "pan" && panTouchRef.current) {
      const t = e.evt.touches[0];
      if (t) {
        const prev = panTouchRef.current;
        setPan((pp) => ({ x: pp.x + (t.clientX - prev.x), y: pp.y + (t.clientY - prev.y) }));
        panTouchRef.current = { x: t.clientX, y: t.clientY };
      }
      return;
    }
    if (viewMode === "stitch") return;
    const p = stagePointMm(stage);
    // Pencil: append to the freehand stroke (thinned to ~0.8mm spacing).
    if (pencilingRef.current) {
      if (p) {
        const d = useEditorStore.getState().draft;
        const last = d[d.length - 1];
        if (!last || distance(last, p) >= 0.8) addDraftPoint(p);
      }
      return;
    }
    if (shapeDraft) {
      if (p) setShapeDraft((d) => (d ? { ...d, end: p } : d));
      return;
    }
    if (measuringRef.current) {
      if (p) setMeasure((m) => (m ? { ...m, end: p } : m));
      return;
    }
    if (dirDraggingRef.current) {
      if (p) setDirDrag((d) => (d && distance(d[d.length - 1], p) >= 0.8 ? [...d, p] : d));
      return;
    }
    const ts = touchStartRef.current;
    if (ts && p && Math.hypot(p.x - ts.mm.x, p.y - ts.mm.y) > 1.5) {
      ts.moved = true;
      cancelLongPress(); // a drag, not a hold — don't pop the menu
    }
    if (marquee) {
      if (p) setMarquee((m) => (m ? { ...m, end: p } : m));
      return;
    }
    if (isPointTool(tool)) setCursor(p);
  }

  function onTouchEnd(e: Konva.KonvaEventObject<TouchEvent>) {
    panTouchRef.current = null;
    cancelLongPress();
    // The long-press already opened the menu and consumed the gesture. Suppress
    // the compatibility click so it doesn't immediately dismiss the menu.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      e.evt.preventDefault();
      touchStartRef.current = null;
      setMarquee(null);
      return;
    }
    if (pencilingRef.current) {
      finishPencil();
      return;
    }
    if (pinchRef.current) {
      pinchRef.current = null;
      return;
    }
    if (viewMode !== "stitch") {
      const ts = touchStartRef.current;
      // A clean tap with a point-placing tool places a polygon/rail point — except
      // Fill's first tap floods a bounded area (the paint-bucket).
      if (ts && !ts.moved && isPointTool(tool)) {
        if (!(tool === "fill" && useEditorStore.getState().draft.length === 0 && tryFloodFill(ts.mm))) {
          addDraftPoint(ts.mm);
        }
      }
    }
    touchStartRef.current = null;
    finishMarquee();
  }

  function finishMarquee() {
    if (!marquee) return;
    const rect = rectFromPoints(marquee.start.x, marquee.start.y, marquee.end.x, marquee.end.y);
    // A tiny rectangle is really a click on empty space — clear the selection.
    // Anything bigger selects every object the box grazes.
    setSelection(rectSpanMm(rect) < 1 ? [] : marqueeSelect(rect, objectBounds));
    setMarquee(null);
  }
  // Paint direction: on release, decide whether the drag was essentially STRAIGHT
  // (set a fixed grain angle) or a CURVE (set a flow path the rows follow), and write
  // it to every selected fill. A too-short drag is ignored (a stray click shouldn't
  // wipe the grain). flowPath and directionDeg are mutually exclusive.
  function finishDirection() {
    if (!dirDraggingRef.current) return;
    dirDraggingRef.current = false;
    const path = dirDrag;
    if (!path || path.length < 2) return;
    let total = 0;
    for (let i = 1; i < path.length; i++) total += distance(path[i - 1], path[i]);
    if (total < 1.5) return; // a tap, not a drag

    const fills = useProjectStore
      .getState()
      .project.objects.filter((o) => selectedIds.includes(o.id) && o.type === "fill");
    if (fills.length === 0) {
      toast("Select a fill first, then drag to set its stitch direction", "info");
      return;
    }

    const simp = douglasPeucker(path, 0.8);
    const a = simp[0], b = simp[simp.length - 1];
    const chord = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let maxDev = 0; // farthest the curve strays from the start→end chord
    for (const q of simp) {
      const t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (chord * chord);
      const cxp = a.x + t * (b.x - a.x), cyp = a.y + t * (b.y - a.y);
      maxDev = Math.max(maxDev, Math.hypot(q.x - cxp, q.y - cyp));
    }
    const straight = simp.length <= 2 || maxDev < Math.max(2, chord * 0.08);

    if (straight) {
      let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      deg = ((deg % 180) + 180) % 180; // grain is an orientation, not a heading
      for (const o of fills) {
        updateObject(o.id, { params: { ...o.params, directionDeg: Math.round(deg), flowPath: null } });
      }
      toast(`Stitch direction set to ${Math.round(deg)}°`, "success");
    } else {
      // Store the curve normalized to each fill's own bbox so it rides move/scale.
      for (const o of fills) {
        const bb = pathsBounds(o.paths);
        if (!bb) continue;
        const w = (bb.maxX - bb.minX) || 1, h = (bb.maxY - bb.minY) || 1;
        const norm = simp.map((q) => [(q.x - bb.minX) / w, (q.y - bb.minY) / h] as [number, number]);
        updateObject(o.id, { params: { ...o.params, flowPath: norm, directionDeg: null } });
      }
      toast("Stitch flow set — rows follow your curve", "success");
    }
  }

  // Resolve the marquee on any mouse release — even outside the canvas — so the
  // rubber-band never gets stuck on screen. The ref always holds the latest
  // closure (fresh marquee + object bounds) without re-subscribing each frame.
  const finishMarqueeRef = useRef(finishMarquee);
  finishMarqueeRef.current = finishMarquee;
  const finishDirectionRef = useRef(finishDirection);
  finishDirectionRef.current = finishDirection;
  useEffect(() => {
    const onUp = () => {
      measuringRef.current = false; // stop tracking; keep the measurement shown
      finishDirectionRef.current();
      finishMarqueeRef.current();
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  const drawing = viewMode === "edit" && isPointTool(tool);
  const freehand = viewMode === "edit" && (tool === "pencil" || tool === "brush");
  // Rulers run the full length of the canvas, not just the hoop, so the user
  // can measure designs that spill past the hoop edge (0 stays on the origin,
  // values go negative to the left/above it). The shaded band on each ruler
  // marks the usable hoop area — the canvas-size limit — at a glance.
  const ticksX = useMemo(
    () =>
      computeTicksRange(
        (RULER - originX) / scale,
        (size.width - originX) / scale,
        rulerUnit,
      ),
    [originX, scale, size.width, rulerUnit],
  );
  const ticksY = useMemo(
    () =>
      computeTicksRange(
        (RULER - originY) / scale,
        (size.height - originY) / scale,
        rulerUnit,
      ),
    [originY, scale, size.height, rulerUnit],
  );

  // Workspace gridline positions (mm), every 10mm across the hoop.
  const gridLinesMm = useMemo(() => {
    const step = 10;
    const x: number[] = [];
    for (let m = 0; m <= hoop.wMm + 1e-6; m += step) x.push(m);
    const y: number[] = [];
    for (let m = 0; m <= hoop.hMm + 1e-6; m += step) y.push(m);
    return { x, y };
  }, [hoop.wMm, hoop.hMm]);

  return (
    <main
      ref={containerRef}
      aria-label="Embroidery canvas"
      className="relative min-w-0 flex-1 overflow-hidden"
      // touch-action none so the browser doesn't scroll/zoom the page while the
      // user draws, pans, or pinch-zooms on the canvas.
      style={{ background: C.cream, touchAction: "none" }}
    >
      {/* The Konva canvas is opaque to assistive tech, so describe its state in a
          polite live region: how many objects, how many selected, which view. */}
      <div className="sr-only" aria-live="polite">
        {viewMode === "stitch" ? "Stitch preview. " : "Editing canvas. "}
        {project.objects.length === 0
          ? "No objects yet — draw a shape, add words, or import an image to begin."
          : `${project.objects.length} object${project.objects.length === 1 ? "" : "s"} on the canvas` +
            (selectedIds.length
              ? `, ${selectedIds.length} selected.`
              : ", none selected.")}
      </div>
      {size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onContextMenu={onStageContextMenu}
          onDblClick={finishDraft}
          onDblTap={finishDraft}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onWheel={onWheelZoom}
          style={{
            cursor:
              tool === "pan"
                ? "grab"
                : drawing || freehand || tool === "shape" || tool === "fill" || tool === "cut" || tool === "measure" || tool === "direction"
                  ? "crosshair"
                  : "default",
          }}
        >
          <Layer>
            {viewMode === "stitch" ? (
              <Group listening={false}>
                {/* Plastic machine-embroidery hoop: a rounded-square frame whose
                    opening is larger than the stitchable field, a left mounting
                    bracket with two bolts, a bottom tension screw, fabric inside,
                    and a registration grid marking the embroiderable area. */}

                {/* Mounting bracket arm on the left (drawn behind the frame). */}
                <Rect
                  x={openL - HOOP_BAND - 30}
                  y={originY + hoopH * 0.2}
                  width={42}
                  height={hoopH * 0.6}
                  cornerRadius={4}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: 0, y: hoopH * 0.6 }}
                  fillLinearGradientColorStops={[0, "#ECE9E2", 1, "#C7C1B7"]}
                  stroke="#A9A39A"
                  strokeWidth={1}
                />
                {/* Two mounting bolts on the bracket. */}
                {[0.3, 0.7].map((t) => (
                  <Circle
                    key={`bolt-${t}`}
                    x={openL - HOOP_BAND - 18}
                    y={originY + hoopH * (0.2 + 0.6 * t)}
                    radius={4}
                    fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                    fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                    fillRadialGradientStartRadius={0}
                    fillRadialGradientEndRadius={4}
                    fillRadialGradientColorStops={[0, "#EDEDED", 1, "#9A9A9A"]}
                    stroke="#7d7d7d"
                    strokeWidth={0.75}
                  />
                ))}

                {/* Bottom tension bracket + silver screw (drawn behind the frame). */}
                <Rect
                  x={originX + hoopW / 2 - 6}
                  y={openT + openH + HOOP_BAND - 7}
                  width={34}
                  height={13}
                  cornerRadius={6}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: 0, y: 13 }}
                  fillLinearGradientColorStops={[0, "#ECE9E2", 1, "#C7C1B7"]}
                  stroke="#A9A39A"
                  strokeWidth={1}
                />
                <Rect
                  x={originX + hoopW / 2 + 26}
                  y={openT + openH + HOOP_BAND - 6}
                  width={18}
                  height={11}
                  cornerRadius={2}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: 0, y: 11 }}
                  fillLinearGradientColorStops={[0, "#EDEDED", 0.5, "#B5B5B5", 1, "#8C8C8C"]}
                  stroke="#7d7d7d"
                  strokeWidth={0.75}
                />

                {/* Outer plastic frame around the (larger) opening. */}
                <Rect
                  x={openL - HOOP_BAND}
                  y={openT - HOOP_BAND}
                  width={openW + HOOP_BAND * 2}
                  height={openH + HOOP_BAND * 2}
                  cornerRadius={HOOP_BAND + 22}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: 0, y: openH + HOOP_BAND * 2 }}
                  fillLinearGradientColorStops={[0, "#F4F2ED", 0.5, "#E6E2DB", 1, "#D5CFC5"]}
                  stroke="#B7B1A8"
                  strokeWidth={1}
                  shadowColor="#000000"
                  shadowOpacity={0.12}
                  shadowBlur={16}
                  shadowOffsetY={4}
                />
                {/* Seam between the outer frame and the inner ring. */}
                <Rect
                  x={openL - HOOP_BAND * 0.5}
                  y={openT - HOOP_BAND * 0.5}
                  width={openW + HOOP_BAND}
                  height={openH + HOOP_BAND}
                  cornerRadius={HOOP_BAND + 12}
                  stroke="#9b958c"
                  strokeWidth={1}
                  fillEnabled={false}
                />
                {/* Fabric stretched across the whole opening. */}
                <Rect
                  x={openL}
                  y={openT}
                  width={openW}
                  height={openH}
                  fill={fabricColor}
                  cornerRadius={8}
                />
                {/* Inner rim shadow where the ring grips the fabric. */}
                <Rect
                  x={openL}
                  y={openT}
                  width={openW}
                  height={openH}
                  cornerRadius={8}
                  stroke="#000000"
                  strokeWidth={2}
                  opacity={0.1}
                  fillEnabled={false}
                />

                {/* Registration template: the embroiderable field (dashed box)
                    sits inside the fabric with margin all around, plus centering
                    crosshairs — so it's clear where stitches can land. */}
                <Rect
                  x={originX}
                  y={originY}
                  width={hoopW}
                  height={hoopH}
                  stroke={C.navy}
                  strokeWidth={1}
                  opacity={0.35}
                  dash={[5, 4]}
                  fillEnabled={false}
                />
                <Line
                  points={[originX + hoopW / 2, openT + 4, originX + hoopW / 2, openT + openH - 4]}
                  stroke={C.navy}
                  strokeWidth={1}
                  opacity={0.28}
                  dash={[5, 4]}
                />
                <Line
                  points={[openL + 4, originY + hoopH / 2, openL + openW - 4, originY + hoopH / 2]}
                  stroke={C.navy}
                  strokeWidth={1}
                  opacity={0.28}
                  dash={[5, 4]}
                />
              </Group>
            ) : (
              <Rect
                x={originX}
                y={originY}
                width={hoopW}
                height={hoopH}
                fill="#ffffff"
                stroke={C.navySoft}
                strokeWidth={1.5}
                dash={[6, 4]}
                listening={false}
              />
            )}

            {viewMode === "edit" && (
              <>
                {/* Light workspace gridlines (toggled by the Guides helper) — a
                    10mm grid clipped to the hoop, drawn under the design. */}
                {guidesEnabled && (
                  <Group listening={false}>
                    {gridLinesMm.x.map((mm, i) => (
                      <Line
                        key={`grid-x-${i}`}
                        points={[px(mm), originY, px(mm), originY + hoopH]}
                        stroke={C.navy}
                        strokeWidth={1}
                        opacity={mm % 50 < 1e-6 ? 0.16 : 0.08}
                      />
                    ))}
                    {gridLinesMm.y.map((mm, i) => (
                      <Line
                        key={`grid-y-${i}`}
                        points={[originX, py(mm), originX + hoopW, py(mm)]}
                        stroke={C.navy}
                        strokeWidth={1}
                        opacity={mm % 50 < 1e-6 ? 0.16 : 0.08}
                      />
                    ))}
                  </Group>
                )}

                {project.objects
                  .filter((o) => o.visible)
                  .map((o) => (
                    <ObjectShape
                      key={o.id}
                      object={o}
                      tool={tool}
                      selected={selectedIds.includes(o.id)}
                      color={colorById.get(o.colorId)}
                      px={px}
                      py={py}
                      toMm={toMm}
                      registerNode={(n) => {
                        if (n) nodeRefs.current.set(o.id, n);
                        else nodeRefs.current.delete(o.id);
                      }}
                      onSelect={(additive) => {
                        if (!additive) return setSelection([o.id]);
                        const cur = useProjectStore.getState().selectedIds;
                        setSelection(
                          cur.includes(o.id)
                            ? cur.filter((id) => id !== o.id)
                            : [...cur, o.id],
                        );
                      }}
                      onCommitPaths={(paths, satinCenterlines) =>
                        updateObject(o.id, { paths, satinCenterlines })
                      }
                      onCommitNodes={(nodes) =>
                        updateObject(o.id, { nodes, paths: pathsFromNodes(nodes, o.type === "fill") })
                      }
                      selectedIds={selectedIds}
                      onMoveSelected={(dx, dy) =>
                        useProjectStore.getState().moveObjects(selectedIds, dx, dy)
                      }
                      onMultiDrag={(dxPx, dyPx) => {
                        // Move every OTHER selected object's node by the live drag
                        // offset (or back to 0 on release), so the group tracks
                        // the cursor together.
                        for (const id of selectedIds) {
                          if (id === o.id) continue;
                          nodeRefs.current.get(id)?.position({ x: dxPx, y: dyPx });
                        }
                      }}
                      hoopMm={{ wMm: hoop.wMm, hMm: hoop.hMm }}
                      targets={objectBounds.filter((x) => x.id !== o.id).map((x) => x.b)}
                      onGuides={setGuides}
                    />
                  ))}

                {(guides.x.length > 0 || guides.y.length > 0) && (
                  <Group listening={false}>
                    {guides.x.map((gx, i) => (
                      <Line
                        key={`gx-${i}`}
                        points={[px(gx), originY, px(gx), originY + hoopH]}
                        stroke={C.salted}
                        strokeWidth={1.25}
                        dash={[5, 3]}
                      />
                    ))}
                    {guides.y.map((gy, i) => (
                      <Line
                        key={`gy-${i}`}
                        points={[originX, py(gy), originX + hoopW, py(gy)]}
                        stroke={C.salted}
                        strokeWidth={1.25}
                        dash={[5, 3]}
                      />
                    ))}
                  </Group>
                )}

                {/* Rubber-band marquee while drag-selecting on empty canvas. */}
                {marquee && (
                  <Rect
                    x={px(Math.min(marquee.start.x, marquee.end.x))}
                    y={py(Math.min(marquee.start.y, marquee.end.y))}
                    width={Math.abs(marquee.end.x - marquee.start.x) * scale}
                    height={Math.abs(marquee.end.y - marquee.start.y) * scale}
                    fill={C.butter}
                    opacity={0.18}
                    stroke={C.navy}
                    strokeWidth={1}
                    dash={[4, 3]}
                    listening={false}
                  />
                )}

                {/* Measure tool: ruler segment + a distance·angle readout. */}
                {measure && (() => {
                  const { start, end } = measure;
                  const x1 = px(start.x), y1 = py(start.y);
                  const x2 = px(end.x), y2 = py(end.y);
                  const distMm = Math.hypot(end.x - start.x, end.y - start.y);
                  const len = rulerUnit === "inch"
                    ? `${mmToInch(distMm).toFixed(2)}"`
                    : `${distMm.toFixed(1)} mm`;
                  const ang = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
                  const text = `${len}  ·  ${ang.toFixed(1)}°`;
                  const w = text.length * 6.4 + 12;
                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2 - 22;
                  return (
                    <Group listening={false}>
                      <Line points={[x1, y1, x2, y2]} stroke={C.salted} strokeWidth={1.5} dash={[6, 3]} />
                      <Circle x={x1} y={y1} radius={3} fill={C.salted} />
                      <Circle x={x2} y={y2} radius={3} fill={C.salted} />
                      <Rect x={mx - w / 2} y={my} width={w} height={17} cornerRadius={2} fill={C.navy} opacity={0.92} />
                      <Text x={mx - w / 2} y={my} width={w} height={17} text={text} fontSize={11} fontStyle="bold" fontFamily="monospace" fill={C.cream} align="center" verticalAlign="middle" />
                    </Group>
                  );
                })()}

                {/* Direction tool: the freehand curve you're drawing, with an
                    arrowhead + angle. A straight drag becomes a fixed grain; a
                    curved one becomes a flow the rows follow. */}
                {dirDrag && dirDrag.length >= 1 && (() => {
                  const pts = dirDrag;
                  const start = pts[0], end = pts[pts.length - 1];
                  const x2 = px(end.x), y2 = py(end.y);
                  const prev = pts.length > 1 ? pts[pts.length - 2] : start;
                  const ang = Math.atan2(py(end.y) - py(prev.y), px(end.x) - px(prev.x));
                  const ah = 9;
                  let deg = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
                  deg = Math.round(((deg % 180) + 180) % 180);
                  return (
                    <Group listening={false}>
                      <Line points={pts.flatMap((p) => [px(p.x), py(p.y)])} stroke={C.navy} strokeWidth={2} lineJoin="round" lineCap="round" />
                      {pts.length > 1 && (
                        <>
                          <Line points={[x2, y2, x2 + ah * Math.cos(ang + 2.6), y2 + ah * Math.sin(ang + 2.6)]} stroke={C.navy} strokeWidth={2} />
                          <Line points={[x2, y2, x2 + ah * Math.cos(ang - 2.6), y2 + ah * Math.sin(ang - 2.6)]} stroke={C.navy} strokeWidth={2} />
                          <Rect x={x2 + 8} y={y2 - 8} width={36} height={16} cornerRadius={2} fill={C.navy} opacity={0.92} />
                          <Text x={x2 + 8} y={y2 - 8} width={36} height={16} text={`${deg}°`} fontSize={11} fontStyle="bold" fontFamily="monospace" fill={C.cream} align="center" verticalAlign="middle" />
                        </>
                      )}
                    </Group>
                  );
                })()}

                {/* Persistent flow curve on each selected fill that has one painted. */}
                {tool === "direction" && !dirDrag &&
                  project.objects
                    .filter((o) => selectedIds.includes(o.id) && o.type === "fill" && o.params.flowPath)
                    .map((o) => {
                      const b = pathsBounds(o.paths);
                      if (!b) return null;
                      const w = b.maxX - b.minX, h = b.maxY - b.minY;
                      const pts = o.params.flowPath!.flatMap(([nx, ny]) => [px(b.minX + nx * w), py(b.minY + ny * h)]);
                      return (
                        <Line key={`flow-${o.id}`} points={pts} stroke={C.salted} strokeWidth={2} dash={[5, 3]} lineJoin="round" lineCap="round" listening={false} />
                      );
                    })}

                {/* Persistent grain arrow on each selected fill that has a painted
                    direction, so the current manual grain is always visible. */}
                {tool === "direction" && !dirDrag &&
                  project.objects
                    .filter((o) => selectedIds.includes(o.id) && o.type === "fill" && o.params.directionDeg != null)
                    .map((o) => {
                      const b = pathsBounds(o.paths);
                      if (!b) return null;
                      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
                      const half = Math.max(4, Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.35);
                      const rad = (o.params.directionDeg! * Math.PI) / 180;
                      const ux = Math.cos(rad), uy = Math.sin(rad);
                      const ax = px(cx - ux * half), ay = py(cy - uy * half);
                      const bx = px(cx + ux * half), by = py(cy + uy * half);
                      const ang = Math.atan2(by - ay, bx - ax);
                      const ah = 8;
                      return (
                        <Group key={`grain-${o.id}`} listening={false}>
                          <Line points={[ax, ay, bx, by]} stroke={C.salted} strokeWidth={2} />
                          <Line points={[bx, by, bx + ah * Math.cos(ang + 2.6), by + ah * Math.sin(ang + 2.6)]} stroke={C.salted} strokeWidth={2} />
                          <Line points={[bx, by, bx + ah * Math.cos(ang - 2.6), by + ah * Math.sin(ang - 2.6)]} stroke={C.salted} strokeWidth={2} />
                          <Line points={[ax, ay, ax - ah * Math.cos(ang + 2.6), ay - ah * Math.sin(ang + 2.6)]} stroke={C.salted} strokeWidth={2} />
                          <Line points={[ax, ay, ax - ah * Math.cos(ang - 2.6), ay - ah * Math.sin(ang - 2.6)]} stroke={C.salted} strokeWidth={2} />
                        </Group>
                      );
                    })}

                {/* Two-rail satin: show the captured first rail while you draw the second. */}
                {tool === "satin2" && satinRailA && satinRailA.length > 1 && (
                  <Line
                    points={satinRailA.flatMap((p) => [px(p.x), py(p.y)])}
                    stroke={C.salted}
                    strokeWidth={2}
                    dash={[6, 3]}
                    listening={false}
                  />
                )}

                {(drawing || freehand) && draft.length > 0 && (
                  <DraftPreview
                    draft={draft}
                    cursor={freehand ? null : cursorMm}
                    closed={tool === "fill" || tool === "brush" || tool === "applique"}
                    smooth={smooth || freehand}
                    px={px}
                    py={py}
                  />
                )}

                {/* Live preview of the shape being dragged. */}
                {shapeDraft &&
                  shapePreviewRings(shapeKind, shapeDraft.start, shapeDraft.end).map((ring, i) => (
                    <Line
                      key={`shape-preview-${i}`}
                      points={ring.flatMap((p) => [px(p.x), py(p.y)])}
                      stroke={C.navy}
                      strokeWidth={1.5}
                      dash={[4, 3]}
                      closed={shapeKind !== "line"}
                      listening={false}
                    />
                  ))}

                <Transformer
                  ref={trRef}
                  rotateEnabled
                  keepRatio={false}
                  shiftBehavior="none"
                  ignoreStroke
                  anchorFill={C.cream}
                  anchorStroke={C.navy}
                  anchorStrokeWidth={1.5}
                  anchorCornerRadius={2}
                  borderStroke={C.navy}
                  borderStrokeWidth={1.5}
                  anchorSize={9}
                />
              </>
            )}

            {viewMode === "stitch" && (
              <StitchView design={design} colorById={colorById} px={px} py={py} />
            )}
          </Layer>

          {/* Butter-stick rulers run the whole canvas; the shaded span marks the
              usable hoop area (the size limit). */}
          <Layer listening={false}>
            <Ruler
              axis="x"
              ticks={ticksX}
              originPx={originX}
              scale={scale}
              spanPx={size.width}
              hoopStartPx={originX}
              hoopEndPx={originX + hoopW}
            />
            <Ruler
              axis="y"
              ticks={ticksY}
              originPx={originY}
              scale={scale}
              spanPx={size.height}
              hoopStartPx={originY}
              hoopEndPx={originY + hoopH}
            />
            <Rect x={0} y={0} width={RULER} height={RULER} fill={C.butterDeep} />
          </Layer>
        </Stage>
      )}

      {/* Node action bar — the touch path for a selected node's keyboard-only
          actions (toggle smooth/corner, delete). Appears only while editing
          points with a node focused; also a discoverable affordance on desktop. */}
      {viewMode === "edit" && tool === "node" && selectedNode && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-sm border-2 border-ink bg-cream p-1 shadow-press-sm">
          <button
            onClick={() => toggleSelectedNodeSmooth()}
            data-tip="Smooth / corner (C)"
            aria-label="Toggle smooth or corner"
            aria-keyshortcuts="C"
            className="tap-target flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm text-ink-deep hover:bg-butter-200"
          >
            <Spline size={16} />
            <span className="font-label text-[11px] font-semibold uppercase tracking-wide">Smooth</span>
          </button>
          <div className="h-6 w-px bg-ink/15" />
          <button
            onClick={() => deleteSelectedNode()}
            data-tip="Delete point (⌫)"
            aria-label="Delete point"
            aria-keyshortcuts="Delete"
            className="tap-target flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm text-stamp hover:bg-stamp/10"
          >
            <Trash2 size={16} />
            <span className="font-label text-[11px] font-semibold uppercase tracking-wide">Delete</span>
          </button>
        </div>
      )}

      {/* Zoom controls — work in both edit and stitch view. */}
      {size.width > 0 && (
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-sm border-2 border-ink bg-cream shadow-press-sm">
          <ZoomButton label="Zoom in" onClick={zoomIn} disabled={zoom >= MAX_ZOOM - 1e-6}>
            <ZoomIn size={16} strokeWidth={2} />
          </ZoomButton>
          <button
            onClick={resetView}
            aria-label="Fit to view"
            title="Fit to view"
            className="tap-target grid h-8 w-8 place-items-center border-y border-ink/20 font-mono text-[11px] font-semibold text-ink-deep hover:bg-butter-200"
          >
            {Math.round(zoom * 100)}%
          </button>
          <ZoomButton label="Zoom out" onClick={zoomOut} disabled={zoom <= MIN_ZOOM + 1e-6}>
            <ZoomOut size={16} strokeWidth={2} />
          </ZoomButton>
          <button
            onClick={resetView}
            aria-label="Reset view"
            title="Reset view"
            className="tap-target grid h-8 w-8 place-items-center border-t border-ink/20 text-ink-deep hover:bg-butter-200"
          >
            <Maximize2 size={15} strokeWidth={2} />
          </button>
        </div>
      )}

      {viewMode === "edit" &&
        project.objects.length === 0 &&
        draft.length === 0 &&
        !startDismissed && (
        // Tapping the empty area dismisses the hint; the X button gives the keyboard path.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div
          className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-navy"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStartDismissed(true);
          }}
        >
          <div className="relative w-full max-w-md rounded-sm border-[2.5px] border-ink bg-cream p-6 shadow-press">
            <button
              onClick={() => setStartDismissed(true)}
              aria-label="Close"
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-navy/40 hover:bg-butter-200 hover:text-navy"
            >
              <X size={16} strokeWidth={2.25} />
            </button>
            <div className="font-label uppercase tracking-[0.08em] text-2xl font-semibold">
              Let&apos;s make something 🧈
            </div>
            <p className="mt-1 text-sm text-navy/80">Pick how you&apos;d like to start.</p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <StartButton
                icon={ImageIcon}
                label="Use an image"
                hint="Turn a photo or logo into stitches"
                onClick={() => {
                  useEditorStore.getState().setPendingStart("image");
                  setStartDismissed(true);
                }}
              />
              <StartButton
                icon={Type}
                label="Add words"
                hint="Stitch a name or message"
                onClick={() => {
                  useEditorStore.getState().setPendingStart("text");
                  setStartDismissed(true);
                }}
              />
              <StartButton
                icon={Pencil}
                label="Draw it"
                hint="Draw your own shape"
                onClick={() => {
                  useEditorStore.getState().setTool("fill");
                  setStartDismissed(true);
                }}
              />
            </div>
            <button
              onClick={() => {
                setProject(buildTestSwatch());
                useProjectStore.temporal.getState().clear();
                setStartDismissed(true);
                toast("Loaded the calibration swatch — export it and stitch a test", "success");
              }}
              className="mt-3 font-body text-xs text-navy/70 underline decoration-dotted underline-offset-2 hover:text-navy"
            >
              Or load the calibration test swatch
            </button>
            <p className="mt-2 text-xs text-navy/80">
              New here? Press <b>?</b> any time for help.
            </p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 left-3 rounded-sm bg-navy/85 px-2 py-0.5 font-mono text-[11px] tracking-wide text-butter-100">
        {rulerUnit === "inch"
          ? `${mmToInch(project.widthMm).toFixed(2)} × ${mmToInch(project.heightMm).toFixed(2)} in`
          : `${project.widthMm.toFixed(0)} × ${project.heightMm.toFixed(0)} mm`}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </main>
  );
}

// ---------------------------------------------------------------------------

/** Big friendly action in the empty-state quick-start guide. */
function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="tap-target grid h-8 w-8 place-items-center text-ink-deep hover:bg-butter-200 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function StartButton({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-sm border-2 border-ink bg-cream px-3 py-3 text-ink shadow-press-sm transition-transform hover:bg-butter-200 active:translate-y-[2px] active:shadow-none"
    >
      <Icon size={26} strokeWidth={1.75} aria-hidden />

      <span className="font-label text-sm font-semibold uppercase tracking-wide">{label}</span>
      <span className="font-body text-[11px] text-char/80">{hint}</span>
    </button>
  );
}

function Ruler({
  axis,
  ticks,
  originPx,
  scale,
  spanPx,
  hoopStartPx,
  hoopEndPx,
}: {
  axis: "x" | "y";
  ticks: { mm: number; major: boolean; label?: string }[];
  originPx: number;
  scale: number;
  /** total length of the ruler in px (the whole canvas edge). */
  spanPx: number;
  /** px position where the usable hoop area begins along this axis. */
  hoopStartPx: number;
  /** px position where the usable hoop area ends along this axis. */
  hoopEndPx: number;
}) {
  const horizontal = axis === "x";
  // The ruler covers the whole canvas; only the hoop span is "usable". Anything
  // outside it is dimmed so the user can see exactly where the sewable area —
  // the canvas-size limit — stops.
  const usableStart = Math.max(hoopStartPx, RULER);
  const usableLen = Math.max(0, hoopEndPx - usableStart);
  return (
    <Group>
      {/* Full-length ruler bed (dimmed = beyond the hoop). */}
      <Rect
        x={horizontal ? RULER : 0}
        y={horizontal ? 0 : RULER}
        width={horizontal ? spanPx - RULER : RULER}
        height={horizontal ? RULER : spanPx - RULER}
        fill={C.butterDeep}
        opacity={0.4}
      />
      {/* Bright butter band over the usable hoop area. */}
      {usableLen > 0 && (
        <Rect
          x={horizontal ? usableStart : 0}
          y={horizontal ? 0 : usableStart}
          width={horizontal ? usableLen : RULER}
          height={horizontal ? RULER : usableLen}
          fill={C.butter}
        />
      )}
      {ticks.map((t, i) => {
        const pos = originPx + t.mm * scale;
        const tickLen = t.major ? RULER * 0.55 : RULER * 0.3;
        const line = horizontal
          ? [pos, RULER, pos, RULER - tickLen]
          : [RULER, pos, RULER - tickLen, pos];
        return (
          <Group key={i}>
            <Line points={line} stroke={C.navy} strokeWidth={t.major ? 1.2 : 0.7} />
            {t.label !== undefined && (
              <Text
                x={horizontal ? pos + 2 : 1}
                y={horizontal ? 5 : pos + 1}
                text={t.label}
                fontSize={8}
                fill={C.navy}
              />
            )}
          </Group>
        );
      })}
      {/* Limit markers at the hoop edges so the boundary is unmistakable. */}
      {[hoopStartPx, hoopEndPx].map((edge, i) => (
        <Line
          key={`edge-${i}`}
          points={horizontal ? [edge, 0, edge, RULER] : [0, edge, RULER, edge]}
          stroke={C.navy}
          strokeWidth={1.5}
        />
      ))}
    </Group>
  );
}

/** Preview rings (mm) for a shape being dragged between two corner points. */
function shapePreviewRings(kind: ShapeKind, start: Point, end: Point): Path[] {
  if (kind === "line") return [[start, end]];
  const w = Math.max(0.1, Math.abs(end.x - start.x));
  const h = Math.max(0.1, Math.abs(end.y - start.y));
  const c = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return translatePaths(shapeRings(kind, { width: w, height: h }), c.x, c.y);
}

function DraftPreview({
  draft,
  cursor,
  closed,
  smooth,
  px,
  py,
}: {
  draft: Point[];
  cursor: Point | null;
  closed: boolean;
  smooth: boolean;
  px: (x: number) => number;
  py: (y: number) => number;
}) {
  // Control points are the placed points plus the moving cursor; in curve mode
  // the rubber-band shows the smoothed spline through them, otherwise straight
  // segments exactly as before.
  const control = cursor ? [...draft, cursor] : draft;
  const pts = smooth ? smoothPath(control) : control;
  const flat = pts.flatMap((p) => [px(p.x), py(p.y)]);
  return (
    <Group listening={false}>
      <Line
        points={flat}
        stroke={C.navy}
        strokeWidth={1.5}
        dash={[4, 3]}
        closed={closed && pts.length > 2}
      />
      {draft.map((p, i) => (
        <Circle
          key={i}
          x={px(p.x)}
          y={py(p.y)}
          radius={3}
          fill={C.butterDeep}
          stroke={C.navy}
          strokeWidth={1}
        />
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------------

/** Lighten (f>1) or darken (f<1) an rgb triple to a css color, clamped. */
/** Read-only render of the assembled stitches, up to the simulator cursor.
 * Subscribes to `simIndex` itself so playback re-renders only this view, not the
 * whole (hidden) edit layer. */
function StitchView({
  design,
  colorById,
  px,
  py,
}: {
  design: Parameters<typeof designToSegments>[0];
  colorById: Map<string, ThreadColor>;
  px: (x: number) => number;
  py: (y: number) => number;
}) {
  const upTo = useEditorStore((s) => s.simIndex);
  const realistic = useEditorStore((s) => s.realistic);
  const segs = useMemo(() => designToSegments(design, upTo), [design, upTo]);
  const needle = useMemo(() => needleAt(design, upTo), [design, upTo]);
  // Render the whole preview as ONE custom canvas Shape rather than hundreds of
  // <Line> nodes: during playback simIndex changes every frame, and reconciling
  // hundreds of Konva nodes per frame is both slow and fragile (it was crashing
  // the canvas). Drawing straight to the context is fast and rock-solid. Each
  // stitch is stroked at the real thread thickness (~0.4 mm) so a dense fill or
  // satin reads as solid coverage instead of separate hairline "scanlines".
  const mmPx = px(1) - px(0);
  const threadPx = Math.min(4, Math.max(1.4, mmPx * 0.42));
  // Fade the stitched preview in when entering Stitch view — a gentle "watch it
  // sew" reveal (instant under prefers-reduced-motion).
  const groupRef = useRef<Konva.Group>(null);
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      g.opacity(1);
      return;
    }
    g.opacity(0);
    g.to({ opacity: 1, duration: 0.25 });
  }, []);
  return (
    <Group ref={groupRef} listening={false}>
      <Shape
        sceneFunc={(ctx) => {
          // Draw straight to the layer's NATIVE 2D context via the shared painter,
          // so the live simulator and the digitize-dialog preview render stitches
          // identically (one source of truth). Each stitch is a round-capped
          // capsule — overlapping capsules read as solid satin/tatami — and in
          // In realistic view, each thread is a shaded, lit, fuzzy tube. The shape is
          // visual-only (listening false), so bypassing Konva's hit tracing here
          // is safe.
          const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
          drawStitches(native, segs, { colorById, px, py, threadPx, realistic });
        }}
      />
      {needle && (
        <Group x={px(needle.x)} y={py(needle.y)} listening={false}>
          {/* A flat stamp-red ring around a cream dot — a clear "live needle"
              marker, in brand ink, no glow. */}
          <Circle radius={5} stroke={C.salted} strokeWidth={1.25} />
          <Circle radius={2.6} fill={C.cream} stroke={C.navy} strokeWidth={1.25} />
        </Group>
      )}
    </Group>
  );
}

// ---------------------------------------------------------------------------

/**
 * Insert a new vertex into a ring at the click point, projected onto the nearest
 * segment (so the node lands ON the outline). `closed` also considers the wrap
 * segment (last→first) for fill rings. Returns a NEW ring, or null if degenerate.
 */
function insertPointOnRing(ring: Path, at: Point, closed: boolean): Path | null {
  if (ring.length < 2) return null;
  let bestIdx = -1;
  let bestD = Infinity;
  let bestPt: Point = at;
  const last = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < last; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2)) : 0;
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (proj.x - at.x) ** 2 + (proj.y - at.y) ** 2;
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
      bestPt = proj;
    }
  }
  if (bestIdx < 0) return null;
  const out = ring.map((p) => ({ ...p }));
  out.splice(bestIdx + 1, 0, bestPt);
  return out;
}

function ObjectShape({
  object,
  tool,
  selected,
  color,
  px,
  py,
  toMm,
  registerNode,
  onSelect,
  onCommitPaths,
  onCommitNodes,
  selectedIds,
  onMoveSelected,
  onMultiDrag,
  hoopMm,
  targets,
  onGuides,
}: {
  object: EmbObject;
  tool: string;
  selected: boolean;
  color?: ThreadColor;
  px: (x: number) => number;
  py: (y: number) => number;
  toMm: (sx: number, sy: number) => Point;
  registerNode: (node: Konva.Group | null) => void;
  onSelect: (additive: boolean) => void;
  onCommitPaths: (paths: Path[], satinCenterlines?: Path[]) => void;
  onCommitNodes: (nodes: NodePath[]) => void;
  selectedIds: string[];
  onMoveSelected: (dxMm: number, dyMm: number) => void;
  /** Drag every OTHER selected object's node to this px offset (0,0 to reset). */
  onMultiDrag: (dxPx: number, dyPx: number) => void;
  hoopMm: { wMm: number; hMm: number };
  targets: Bounds[];
  onGuides: (g: { x: number[]; y: number[] }) => void;
}) {
  // Part of a multi-selection: dragging moves every selected object together.
  const multi = selected && selectedIds.length > 1;
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  // px per mm — for converting a snap offset (mm) back to canvas pixels.
  const scalePx = px(1) - px(0);
  const stroke = color ? `rgb(${color.rgb.join(",")})` : "#888";
  // Solid, clean thread color so the design view reads like the finished piece.
  const fillColor = color ? `rgba(${color.rgb.join(",")},0.85)` : "rgba(136,136,136,0.85)";
  const isFill = object.type === "fill";
  // The border outline is a display option. When off (and not selected) the
  // object shows no stroke, but the path stays clickable via its hit width.
  const outlineOn = object.params.outline !== false;
  const selectable = tool === "select" || tool === "node";
  const movable = tool === "select" && selected;
  const editingNodes = tool === "node" && selected;
  const nodeSel = useEditorStore((s) => s.selectedNode);

  // Live geometry while dragging a vertex (committed to the store on release so
  // a node-drag is a single undo step and the outline follows the handle).
  const [livePaths, setLivePaths] = useState<Path[] | null>(null);
  const paths = livePaths ?? object.paths;
  // Editable control nodes (running/fill). Absent → legacy polyline editing.
  const nodeRings = object.nodes;
  const closedRings = object.type === "fill";

  // Rings oriented for nonzero-winding fill so counters cut and overlapping
  // (script) contours union — no false holes.
  const fillRings = useMemo(() => (isFill ? orientByDepth(paths) : []), [isFill, paths]);

  // Satin renders as a solid column (the area between its two rails), so the
  // design view reads clean and premium rather than as raw zig-zag lines. The
  // actual stitches are shown in Stitch view.
  const isSatin = object.type === "satin";
  const satinColumnPts = useMemo(() => {
    if (!isSatin || paths.length < 2) return null;
    return [...paths[0], ...[...paths[1]].reverse()];
  }, [isSatin, paths]);

  return (
    <Group
      ref={registerNode}
      draggable={movable}
      onMouseDown={
        selectable
          ? (e) => {
              // Shift-click toggles this object in/out of the selection.
              if (e.evt.shiftKey) onSelect(true);
              // A fresh click selects just this one (so it can then be dragged).
              else if (!selected) onSelect(false);
              // Already selected, no shift: KEEP the selection so a multi-object
              // drag isn't collapsed to one. A plain click that doesn't drag
              // narrows to this object via onClick below.
            }
          : undefined
      }
      onClick={
        selectable
          ? (e) => {
              // Click (not a drag) on a member of a multi-selection → narrow to it.
              if (!e.evt.shiftKey && selected && selectedIds.length > 1) onSelect(false);
            }
          : undefined
      }
      onTap={selectable ? () => onSelect(false) : undefined}
      onDblClick={
        object.text ? () => useEditorStore.getState().setEditingTextId(object.id) : undefined
      }
      onDblTap={
        object.text ? () => useEditorStore.getState().setEditingTextId(object.id) : undefined
      }
      onDragMove={(e) => {
        if (multi) {
          // Moving a group: drag every other selected object's node by the same
          // offset live (skip per-object snapping) so the whole selection tracks
          // the cursor, not just the one under it.
          onMultiDrag(e.target.x(), e.target.y());
          e.target.getLayer()?.batchDraw();
          return;
        }
        // Snap the moving object to hoop/object guide lines and show the guides.
        const g = e.target;
        const a = toMm(0, 0);
        const b = toMm(g.x(), g.y());
        const base = pathsBounds(object.paths);
        if (!base) return;
        const moving: Bounds = {
          minX: base.minX + (b.x - a.x),
          maxX: base.maxX + (b.x - a.x),
          minY: base.minY + (b.y - a.y),
          maxY: base.maxY + (b.y - a.y),
        };
        if (snapEnabled) {
          const res = snap(moving, targets, hoopMm, SNAP_MM);
          if (res.dx !== 0) g.x(g.x() + res.dx * scalePx);
          if (res.dy !== 0) g.y(g.y() + res.dy * scalePx);
          // Alignment guides always show while snapping (no toggle).
          onGuides({ x: res.guidesX, y: res.guidesY });
        } else {
          onGuides({ x: [], y: [] });
        }
        // Force the layer to repaint mid-drag so the guide lines actually show
        // (a React state change alone doesn't reliably redraw during a Konva drag).
        g.getLayer()?.batchDraw();
      }}
      onDragEnd={(e) => {
        onGuides({ x: [], y: [] });
        const g = e.target;
        const dxPx = g.x();
        const dyPx = g.y();
        g.position({ x: 0, y: 0 });
        if (dxPx === 0 && dyPx === 0) return; // pure click, no move
        const a = toMm(0, 0);
        const b = toMm(dxPx, dyPx);
        const dxMm = b.x - a.x;
        const dyMm = b.y - a.y;
        if (multi) {
          onMultiDrag(0, 0); // snap sibling nodes back; the store move repositions all
          onMoveSelected(dxMm, dyMm);
        } else if (nodeRings) {
          // Keep the editable nodes in step with the move (don't drop the curve).
          onCommitNodes(translateNodes(nodeRings, dxMm, dyMm));
        } else {
          onCommitPaths(
            translatePaths(object.paths, dxMm, dyMm),
            object.satinCenterlines ? translatePaths(object.satinCenterlines, dxMm, dyMm) : undefined,
          );
        }
      }}
      onTransformEnd={(e) => {
        const node = e.target;
        const m = node.getTransform().getMatrix() as unknown as Matrix;
        node.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
        if (nodeRings) {
          // Transform the control NODES (keep curve-editability through scale/rotate).
          const pxNodes = nodeRings.map((r) => r.map((nd) => ({ x: px(nd.x), y: py(nd.y) })));
          const movedNodes = applyMatrix(pxNodes, m).map((r, ri) =>
            r.map((p, pi) => ({ ...toMm(p.x, p.y), smooth: nodeRings[ri][pi].smooth })),
          );
          onCommitNodes(movedNodes);
          return;
        }
        const pxPaths = object.paths.map((path) =>
          path.map((p) => ({ x: px(p.x), y: py(p.y) })),
        );
        const movedMm = applyMatrix(pxPaths, m).map((path) =>
          path.map((p) => toMm(p.x, p.y)),
        );
        // Carry authored satin centerlines through the same matrix so they stay
        // glued to the glyphs after a free scale/rotate.
        const movedCenters = object.satinCenterlines
          ? applyMatrix(
              object.satinCenterlines.map((path) => path.map((p) => ({ x: px(p.x), y: py(p.y) }))),
              m,
            ).map((path) => path.map((p) => toMm(p.x, p.y)))
          : undefined;
        onCommitPaths(movedMm, movedCenters);
      }}
    >
      {/* Fill objects get a translucent body drawn with the nonzero rule (rings
          oriented by depth), so every disjoint region fills, counters cut out,
          and overlapping script letters union cleanly. The body is listening, so
          clicking a filled interior selects the object. */}
      {isFill && (
        <Shape
          listening={selectable}
          perfectDrawEnabled={false}
          sceneFunc={(ctx) => {
            const native = (ctx as unknown as { _context: CanvasRenderingContext2D })
              ._context;
            native.beginPath();
            for (const ring of fillRings) {
              if (ring.length < 3) continue;
              native.moveTo(px(ring[0].x), py(ring[0].y));
              for (let i = 1; i < ring.length; i++) {
                native.lineTo(px(ring[i].x), py(ring[i].y));
              }
              native.closePath();
            }
            native.fillStyle = fillColor;
            native.fill("nonzero");
          }}
          hitFunc={(ctx, shape) => {
            ctx.beginPath();
            for (const ring of fillRings) {
              if (ring.length < 3) continue;
              ctx.moveTo(px(ring[0].x), py(ring[0].y));
              for (let i = 1; i < ring.length; i++) {
                ctx.lineTo(px(ring[i].x), py(ring[i].y));
              }
              ctx.closePath();
            }
            ctx.fillStrokeShape(shape);
          }}
          fill={fillColor}
        />
      )}

      {/* Satin renders as a solid column between its rails. Selection is handled
          by the parent Group (events bubble up) — duplicating onMouseDown here
          would fire onSelect twice and cancel a shift-click toggle. */}
      {satinColumnPts && (
        <Line
          points={satinColumnPts.flatMap((p) => [px(p.x), py(p.y)])}
          closed
          fill={fillColor}
          listening={selectable}
        />
      )}

      {paths.map((path, pi) => (
        <Line
          key={pi}
          points={path.flatMap((p) => [px(p.x), py(p.y)])}
          stroke={stroke}
          strokeWidth={selected ? 2.5 : outlineOn ? 1.5 : 0}
          closed={object.type === "fill"}
          listening={selectable}
          hitStrokeWidth={editingNodes ? 14 : 10}
          // In node mode, clicking the outline (not a handle) inserts a new node
          // on the nearest segment so you can add detail anywhere.
          onClick={
            editingNodes
              ? (e) => {
                  e.cancelBubble = true;
                  const pos = e.target.getStage()?.getPointerPosition();
                  if (!pos) return;
                  const at = toMm(pos.x, pos.y);
                  if (nodeRings) {
                    const nodes = nodeRings.map((r, i) => (i === pi ? insertNode(r, at, closedRings) : r));
                    onCommitNodes(nodes);
                  } else {
                    const ring = insertPointOnRing(object.paths[pi], at, object.type === "fill");
                    if (ring) onCommitPaths(object.paths.map((pp, i) => (i === pi ? ring : pp)));
                  }
                }
              : undefined
          }
        />
      ))}

      {/* Node-backed editing: handles sit on the CONTROL nodes — a round handle is
          smooth (curve flows through it), a square handle is a sharp corner.
          Press C to toggle the focused one. Dragging re-densifies the curve live. */}
      {editingNodes && nodeRings &&
        nodeRings.map((ring, pi) =>
          ring.map((nd, ti) => {
            const focused =
              nodeSel?.objectId === object.id && nodeSel.ring === pi && nodeSel.point === ti;
            const fill = focused ? C.butterDeep : C.cream;
            const select = () =>
              useEditorStore.getState().setSelectedNode({ objectId: object.id, ring: pi, point: ti });
            const liveMove = (e: Konva.KonvaEventObject<DragEvent>) => {
              const m = toMm(e.target.x(), e.target.y());
              const moved = nodeRings.map((r, ri) => (ri === pi ? moveNode(r, ti, m) : r));
              setLivePaths(moved.map((r) => densifyRing(r, closedRings)));
            };
            const commit = (e: Konva.KonvaEventObject<DragEvent>) => {
              const m = toMm(e.target.x(), e.target.y());
              onCommitNodes(nodeRings.map((r, ri) => (ri === pi ? moveNode(r, ti, m) : r)));
              setLivePaths(null);
            };
            const common = {
              x: px(nd.x),
              y: py(nd.y),
              fill,
              stroke: C.navy,
              strokeWidth: 1.5,
              draggable: true,
              onClick: select,
              onTap: select,
              onDblClick: () =>
                onCommitNodes(nodeRings.map((r, ri) => (ri === pi ? toggleNodeSmooth(r, ti) : r))),
              onDragStart: select,
              onDragMove: liveMove,
              onDragEnd: commit,
            };
            const r = focused ? 6 : 4.5;
            return nd.smooth ? (
              <Circle key={`${pi}-${ti}`} {...common} radius={r} />
            ) : (
              <Rect key={`${pi}-${ti}`} {...common} x={px(nd.x) - r} y={py(nd.y) - r} width={r * 2} height={r * 2} />
            );
          }),
        )}

      {/* Legacy polyline editing (imported / shapes): handles on raw vertices. */}
      {editingNodes && !nodeRings &&
        paths.map((path, pi) =>
          path.map((p, ti) => {
            const focused =
              nodeSel?.objectId === object.id &&
              nodeSel.ring === pi &&
              nodeSel.point === ti;
            return (
            <Circle
              key={`${pi}-${ti}`}
              x={px(p.x)}
              y={py(p.y)}
              radius={focused ? 6 : 4.5}
              fill={focused ? C.butterDeep : C.cream}
              stroke={C.navy}
              strokeWidth={1.5}
              draggable
              onClick={() =>
                useEditorStore.getState().setSelectedNode({
                  objectId: object.id,
                  ring: pi,
                  point: ti,
                })
              }
              onTap={() =>
                useEditorStore.getState().setSelectedNode({
                  objectId: object.id,
                  ring: pi,
                  point: ti,
                })
              }
              onDragStart={() =>
                setLivePaths(object.paths.map((pp) => pp.map((q) => ({ ...q }))))
              }
              onDragMove={(e) => {
                const c = e.target;
                const m = toMm(c.x(), c.y());
                setLivePaths((prev) => {
                  const base = prev ?? object.paths;
                  return base.map((pp, ppi) =>
                    ppi === pi ? pp.map((q, qi) => (qi === ti ? m : q)) : pp,
                  );
                });
              }}
              onDragEnd={() => {
                if (livePaths) onCommitPaths(livePaths);
                setLivePaths(null);
              }}
            />
            );
          }),
        )}
    </Group>
  );
}
