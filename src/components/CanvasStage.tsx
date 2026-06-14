import { useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Rect,
  Line,
  Text,
  Circle,
  Group,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore, isDrawTool } from "../store/editorStore";
import type { EmbObject, Path, Point, ThreadColor } from "../types/project";
import { makeObject, minPointsFor } from "../lib/objects";
import { translatePaths, dedupePath, applyMatrix, type Matrix } from "../lib/geometry";
import { smoothPath } from "../lib/smooth";
import { computeTicks } from "../lib/ruler";
import { mmToInch } from "../lib/units";
import { generateDesign } from "../lib/engine";
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
  const simIndex = useEditorStore((s) => s.simIndex);
  const setSimTotal = useEditorStore((s) => s.setSimTotal);

  // The assembled design drives both this preview and the exporter.
  const design = useMemo(() => generateDesign(project), [project]);
  useEffect(() => setSimTotal(design.length), [design, setSimTotal]);

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
    const cleaned = dedupePath(draft); // drop double-click / stationary dupes
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
  const needle = viewMode === "stitch" ? needleAt(design, simIndex) : null;
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
                      onSelect={() => setSelection([o.id])}
                      onCommitPaths={(paths) => updateObject(o.id, { paths })}
                    />
                  ))}

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
              <StitchView
                design={design}
                upTo={simIndex}
                needle={needle}
                colorById={colorById}
                px={px}
                py={py}
              />
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

/** Read-only render of the assembled stitches, up to the simulator cursor. */
function StitchView({
  design,
  upTo,
  needle,
  colorById,
  px,
  py,
}: {
  design: Parameters<typeof designToSegments>[0];
  upTo: number;
  needle: Point | null;
  colorById: Map<string, ThreadColor>;
  px: (x: number) => number;
  py: (y: number) => number;
}) {
  const segs = useMemo(() => designToSegments(design, upTo), [design, upTo]);
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
}: {
  object: EmbObject;
  tool: string;
  selected: boolean;
  color?: ThreadColor;
  px: (x: number) => number;
  py: (y: number) => number;
  toMm: (sx: number, sy: number) => Point;
  registerNode: (node: Konva.Group | null) => void;
  onSelect: () => void;
  onCommitPaths: (paths: Path[]) => void;
}) {
  const stroke = color ? `rgb(${color.rgb.join(",")})` : "#888";
  const fillColor = color ? `rgba(${color.rgb.join(",")},0.28)` : "rgba(136,136,136,0.28)";
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

  return (
    <Group
      ref={registerNode}
      draggable={movable}
      onMouseDown={selectable ? onSelect : undefined}
      onTap={selectable ? onSelect : undefined}
      onDragEnd={(e) => {
        const g = e.target;
        const dxPx = g.x();
        const dyPx = g.y();
        g.position({ x: 0, y: 0 });
        if (dxPx === 0 && dyPx === 0) return; // pure click, no move
        const a = toMm(0, 0);
        const b = toMm(dxPx, dyPx);
        onCommitPaths(translatePaths(object.paths, b.x - a.x, b.y - a.y));
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
      {/* Fill objects get a translucent body so they read as solid in the
          editor. The first ring is the outer; the rest are holes, painted with
          the hoop's white to punch them back out. */}
      {isFill &&
        paths.map((path, pi) => (
          <Line
            key={`fill-${pi}`}
            points={path.flatMap((p) => [px(p.x), py(p.y)])}
            closed
            fill={pi === 0 ? fillColor : "#ffffff"}
            listening={false}
          />
        ))}

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
