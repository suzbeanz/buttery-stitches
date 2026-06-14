import { useEffect, useMemo, useRef, useState } from "react";
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
import { useEditorStore, isDrawTool } from "../store/editorStore";
import type { EmbObject, Path, Point, ThreadColor } from "../types/project";
import { makeObject, minPointsFor } from "../lib/objects";
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
import { smoothPath } from "../lib/smooth";
import { computeTicks } from "../lib/ruler";
import { mmToInch } from "../lib/units";
import { generateDesign, orientByDepth } from "../lib/engine";
import { designToSegments, needleAt } from "../lib/engine/render";

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
const PADDING = 28; // px breathing room around the hoop
const SNAP_MM = 2; // snap distance (mm) for alignment to hoop/object edges
const JOIN_SNAP_MM = 3; // snap the closing end of a fill polygon to its start

const C = {
  cream: "#FFFDF3",
  butter: "#F9E9A6",
  butterDeep: "#EBCB4E",
  navy: "#16234A",
  navySoft: "#27386E",
};

export default function CanvasStage() {
  const project = useProjectStore((s) => s.project);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const setSelection = useProjectStore((s) => s.setSelection);
  const updateObject = useProjectStore((s) => s.updateObject);
  const addObject = useProjectStore((s) => s.addObject);

  const tool = useEditorStore((s) => s.tool);
  const draft = useEditorStore((s) => s.draft);
  const cursorMm = useEditorStore((s) => s.cursorMm);
  const rulerUnit = useEditorStore((s) => s.rulerUnit);
  const activeColorId = useEditorStore((s) => s.activeColorId);
  const addDraftPoint = useEditorStore((s) => s.addDraftPoint);
  const setCursor = useEditorStore((s) => s.setCursor);
  const clearDraft = useEditorStore((s) => s.clearDraft);
  const smooth = useEditorStore((s) => s.smooth);

  const viewMode = useEditorStore((s) => s.viewMode);
  const setSimTotal = useEditorStore((s) => s.setSimTotal);
  // Note: `simIndex` is intentionally NOT subscribed here. It changes every
  // animation frame during playback; reading it inside StitchView keeps the
  // (hidden) edit layer from re-rendering on every frame.

  // The assembled design drives both this preview and the exporter.
  const design = useMemo(() => generateDesign(project), [project]);
  useEffect(() => setSimTotal(design.length), [design, setSimTotal]);

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
  const availW = size.width - RULER - PADDING * 2;
  const availH = size.height - RULER - PADDING * 2;
  const scale =
    availW > 0 && availH > 0 ? Math.min(availW / hoop.wMm, availH / hoop.hMm) : 1;
  const hoopW = hoop.wMm * scale;
  const hoopH = hoop.hMm * scale;
  const originX = RULER + PADDING + (availW - hoopW) / 2;
  const originY = RULER + PADDING + (availH - hoopH) / 2;

  const px = (xMm: number) => originX + xMm * scale;
  const py = (yMm: number) => originY + yMm * scale;
  const toMm = (sx: number, sy: number): Point => ({
    x: (sx - originX) / scale,
    y: (sy - originY) / scale,
  });

  const colorById = useMemo(
    () => new Map<string, ThreadColor>(project.colors.map((c) => [c.id, c])),
    [project.colors],
  );

  // --- selection / transform plumbing ---
  const nodeRefs = useRef(new Map<string, Konva.Group>());
  const trRef = useRef<Konva.Transformer>(null);
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
    const colorId = activeColorId ?? project.colors[0]?.id;
    if (!colorId) return;
    // In curve mode the placed points are control points: feed makeObject a
    // densified spline polyline (for satin this is the smoothed centerline,
    // from which makeObject derives the rail pair exactly as before).
    const finalPath = smooth ? smoothPath(cleaned) : cleaned;
    addObject(makeObject(tool, finalPath, colorId));
    clearDraft();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "Enter") finishDraft();
      else if (e.key === "Escape") clearDraft();
      else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        tool === "select" &&
        selectedIds.length
      ) {
        e.preventDefault();
        useProjectStore.getState().removeObjects(selectedIds);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, draft, selectedIds, activeColorId, smooth]);

  // --- stage pointer handlers ---
  function stagePointMm(stage: Konva.Stage): Point | null {
    const pos = stage.getPointerPosition();
    return pos ? toMm(pos.x, pos.y) : null;
  }

  function onStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (viewMode === "stitch") return; // simulation view is read-only
    const stage = e.target.getStage();
    if (!stage) return;
    if (!isDrawTool(tool)) {
      if (e.target === stage) setSelection([]); // click empty canvas clears
      return;
    }
    const p = stagePointMm(stage);
    if (p) addDraftPoint(p);
  }

  function onStageMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (viewMode === "stitch" || !isDrawTool(tool)) return;
    const stage = e.target.getStage();
    if (stage) setCursor(stagePointMm(stage));
  }

  const drawing = viewMode === "edit" && isDrawTool(tool);
  const ticksX = useMemo(() => computeTicks(hoop.wMm, rulerUnit), [hoop.wMm, rulerUnit]);
  const ticksY = useMemo(() => computeTicks(hoop.hMm, rulerUnit), [hoop.hMm, rulerUnit]);

  return (
    <main
      ref={containerRef}
      className="relative min-w-0 flex-1 overflow-hidden"
      style={{ background: C.cream }}
    >
      {size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onDblClick={finishDraft}
          style={{ cursor: drawing ? "crosshair" : "default" }}
        >
          <Layer>
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

            {viewMode === "edit" && (
              <>
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
                      onCommitPaths={(paths) => updateObject(o.id, { paths })}
                      selectedIds={selectedIds}
                      onMoveSelected={(dx, dy) =>
                        useProjectStore.getState().moveObjects(selectedIds, dx, dy)
                      }
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
                        stroke={C.butterDeep}
                        strokeWidth={1}
                        dash={[4, 3]}
                      />
                    ))}
                    {guides.y.map((gy, i) => (
                      <Line
                        key={`gy-${i}`}
                        points={[originX, py(gy), originX + hoopW, py(gy)]}
                        stroke={C.butterDeep}
                        strokeWidth={1}
                        dash={[4, 3]}
                      />
                    ))}
                  </Group>
                )}

                {drawing && draft.length > 0 && (
                  <DraftPreview
                    draft={draft}
                    cursor={cursorMm}
                    closed={tool === "fill"}
                    smooth={smooth}
                    px={px}
                    py={py}
                  />
                )}

                <Transformer
                  ref={trRef}
                  rotateEnabled
                  keepRatio={false}
                  ignoreStroke
                  anchorFill={C.cream}
                  anchorStroke={C.navy}
                  borderStroke={C.navy}
                  anchorSize={8}
                />
              </>
            )}

            {viewMode === "stitch" && (
              <StitchView design={design} colorById={colorById} px={px} py={py} />
            )}
          </Layer>

          {/* Rulers above the scene edges */}
          <Layer listening={false}>
            <Ruler axis="x" ticks={ticksX} originPx={originX} scale={scale} length={hoopW} />
            <Ruler axis="y" ticks={ticksY} originPx={originY} scale={scale} length={hoopH} />
            <Rect x={0} y={0} width={RULER} height={RULER} fill={C.butterDeep} />
          </Layer>
        </Stage>
      )}

      {viewMode === "edit" && project.objects.length === 0 && draft.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center text-navy/45">
          <div className="font-butter text-xl">Spread some stitches 🧈</div>
          <div className="mt-1 text-sm">
            Pick a tool and draw, or <b>Import image</b> to auto-digitize a logo.
          </div>
          <div className="mt-1 text-xs">Press <b>?</b> for keyboard shortcuts.</div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-navy/80 px-2 py-0.5 text-[11px] text-butter-100">
        {rulerUnit === "inch"
          ? `${mmToInch(project.widthMm).toFixed(2)} × ${mmToInch(project.heightMm).toFixed(2)} in`
          : `${project.widthMm.toFixed(0)} × ${project.heightMm.toFixed(0)} mm`}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

function Ruler({
  axis,
  ticks,
  originPx,
  scale,
  length,
}: {
  axis: "x" | "y";
  ticks: { mm: number; major: boolean; label?: string }[];
  originPx: number;
  scale: number;
  length: number;
}) {
  const horizontal = axis === "x";
  return (
    <Group>
      <Rect
        x={horizontal ? originPx : 0}
        y={horizontal ? 0 : originPx}
        width={horizontal ? length : RULER}
        height={horizontal ? RULER : length}
        fill={C.butter}
      />
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
                y={horizontal ? 2 : pos + 1}
                text={t.label}
                fontSize={8}
                fill={C.navy}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
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
  const segs = useMemo(() => designToSegments(design, upTo), [design, upTo]);
  const needle = useMemo(() => needleAt(design, upTo), [design, upTo]);
  return (
    <Group listening={false}>
      {segs.map((seg, i) => {
        const c = colorById.get(seg.colorId);
        const stroke = c ? `rgb(${c.rgb.join(",")})` : "#888";
        return (
          <Line
            key={i}
            points={seg.points.flatMap((p) => [px(p.x), py(p.y)])}
            stroke={stroke}
            strokeWidth={seg.underlay ? 0.6 : 1}
            opacity={seg.underlay ? 0.4 : 1}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}
      {needle && (
        <Circle
          x={px(needle.x)}
          y={py(needle.y)}
          radius={3.5}
          fill={C.cream}
          stroke={C.navy}
          strokeWidth={1.5}
        />
      )}
    </Group>
  );
}

// ---------------------------------------------------------------------------

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
  selectedIds,
  onMoveSelected,
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
  onCommitPaths: (paths: Path[]) => void;
  selectedIds: string[];
  onMoveSelected: (dxMm: number, dyMm: number) => void;
  hoopMm: { wMm: number; hMm: number };
  targets: Bounds[];
  onGuides: (g: { x: number[]; y: number[] }) => void;
}) {
  // Part of a multi-selection: dragging moves every selected object together.
  const multi = selected && selectedIds.length > 1;
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

  // Live geometry while dragging a vertex (committed to the store on release so
  // a node-drag is a single undo step and the outline follows the handle).
  const [livePaths, setLivePaths] = useState<Path[] | null>(null);
  const paths = livePaths ?? object.paths;

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
      onMouseDown={selectable ? (e) => onSelect(e.evt.shiftKey) : undefined}
      onTap={selectable ? () => onSelect(false) : undefined}
      onDblClick={
        object.text ? () => useEditorStore.getState().setEditingTextId(object.id) : undefined
      }
      onDblTap={
        object.text ? () => useEditorStore.getState().setEditingTextId(object.id) : undefined
      }
      onDragMove={(e) => {
        if (multi) return; // moving a group: skip per-object snapping
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
        const res = snap(moving, targets, hoopMm, SNAP_MM);
        if (res.dx !== 0) g.x(g.x() + res.dx * scalePx);
        if (res.dy !== 0) g.y(g.y() + res.dy * scalePx);
        onGuides({ x: res.guidesX, y: res.guidesY });
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
        if (multi) onMoveSelected(dxMm, dyMm);
        else onCommitPaths(translatePaths(object.paths, dxMm, dyMm));
      }}
      onTransformEnd={(e) => {
        const node = e.target;
        const m = node.getTransform().getMatrix() as unknown as Matrix;
        const pxPaths = object.paths.map((path) =>
          path.map((p) => ({ x: px(p.x), y: py(p.y) })),
        );
        const movedMm = applyMatrix(pxPaths, m).map((path) =>
          path.map((p) => toMm(p.x, p.y)),
        );
        node.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
        onCommitPaths(movedMm);
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
          onMouseDown={selectable ? (e) => onSelect(e.evt.shiftKey) : undefined}
          onTap={selectable ? () => onSelect(false) : undefined}
        />
      )}

      {/* Satin renders as a solid column between its rails. */}
      {satinColumnPts && (
        <Line
          points={satinColumnPts.flatMap((p) => [px(p.x), py(p.y)])}
          closed
          fill={fillColor}
          listening={selectable}
          onMouseDown={selectable ? (e) => onSelect(e.evt.shiftKey) : undefined}
          onTap={selectable ? () => onSelect(false) : undefined}
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
          hitStrokeWidth={10}
        />
      ))}

      {editingNodes &&
        paths.map((path, pi) =>
          path.map((p, ti) => (
            <Circle
              key={`${pi}-${ti}`}
              x={px(p.x)}
              y={py(p.y)}
              radius={4.5}
              fill={C.cream}
              stroke={C.navy}
              strokeWidth={1.5}
              draggable
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
          )),
        )}
    </Group>
  );
}
