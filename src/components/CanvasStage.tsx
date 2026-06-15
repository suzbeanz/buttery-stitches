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
import { rectFromPoints, rectSpanMm, marqueeSelect } from "../lib/marquee";
import { smoothPath } from "../lib/smooth";
import { computeTicksRange } from "../lib/ruler";
import { mmToInch } from "../lib/units";
import { designFor, orientByDepth } from "../lib/engine";
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
const PADDING = 48; // px breathing room around the hoop (room for frame + bracket)
const SNAP_MM = 2; // snap distance (mm) for alignment to hoop/object edges
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
  const fabricColor = useEditorStore((s) => s.fabricColor);
  const startDismissed = useEditorStore((s) => s.startDismissed);
  const setStartDismissed = useEditorStore((s) => s.setStartDismissed);
  const activeColorId = useEditorStore((s) => s.activeColorId);
  const addDraftPoint = useEditorStore((s) => s.addDraftPoint);
  const setCursor = useEditorStore((s) => s.setCursor);
  const clearDraft = useEditorStore((s) => s.clearDraft);
  const smooth = useEditorStore((s) => s.smooth);

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
    // Read the color list fresh (not via the render closure): a draft can be
    // finished after colors changed, and a stale empty list would silently
    // drop the shape.
    const colorId =
      useEditorStore.getState().activeColorId ??
      useProjectStore.getState().project.colors[0]?.id;
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
      else if (e.key === "Escape") {
        clearDraft();
        useEditorStore.getState().setSelectedNode(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const node = useEditorStore.getState().selectedNode;
        if (tool === "node" && node) {
          // Delete the focused vertex (never below the type's minimum).
          e.preventDefault();
          const obj = useProjectStore
            .getState()
            .project.objects.find((o) => o.id === node.objectId);
          if (obj) {
            const ring = obj.paths[node.ring];
            const min = obj.type === "fill" ? 3 : 2;
            if (ring && ring.length > min) {
              const paths = obj.paths.map((p, i) =>
                i === node.ring ? p.filter((_, j) => j !== node.point) : p,
              );
              useProjectStore.getState().updateObject(obj.id, { paths });
            }
          }
          useEditorStore.getState().setSelectedNode(null);
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
    if (p) addDraftPoint(p);
  }

  function onStageMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (viewMode === "stitch") return;
    const stage = e.target.getStage();
    if (!stage) return;
    if (marquee) {
      const p = stagePointMm(stage);
      if (p) setMarquee((m) => (m ? { ...m, end: p } : m));
      return;
    }
    if (!isDrawTool(tool)) return;
    setCursor(stagePointMm(stage));
  }

  function finishMarquee() {
    if (!marquee) return;
    const rect = rectFromPoints(marquee.start.x, marquee.start.y, marquee.end.x, marquee.end.y);
    // A tiny rectangle is really a click on empty space — clear the selection.
    // Anything bigger selects every object the box grazes.
    setSelection(rectSpanMm(rect) < 1 ? [] : marqueeSelect(rect, objectBounds));
    setMarquee(null);
  }
  // Resolve the marquee on any mouse release — even outside the canvas — so the
  // rubber-band never gets stuck on screen. The ref always holds the latest
  // closure (fresh marquee + object bounds) without re-subscribing each frame.
  const finishMarqueeRef = useRef(finishMarquee);
  finishMarqueeRef.current = finishMarquee;
  useEffect(() => {
    const onUp = () => finishMarqueeRef.current();
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const drawing = viewMode === "edit" && isDrawTool(tool);
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

      {viewMode === "edit" &&
        project.objects.length === 0 &&
        draft.length === 0 &&
        !startDismissed && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-navy"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStartDismissed(true);
          }}
        >
          <div className="relative w-full max-w-md rounded-2xl border border-navy/10 bg-cream/95 p-6 shadow-butter">
            <button
              onClick={() => setStartDismissed(true)}
              aria-label="Close"
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-navy/40 hover:bg-butter-200 hover:text-navy"
            >
              ✕
            </button>
            <div className="font-label uppercase tracking-[0.08em] text-2xl font-semibold">
              Let&apos;s make something 🧈
            </div>
            <p className="mt-1 text-sm text-navy/60">Pick how you&apos;d like to start.</p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <StartButton
                emoji="🖼️"
                label="Use a picture"
                hint="Turn a photo or logo into stitches"
                onClick={() => useEditorStore.getState().setPendingStart("image")}
              />
              <StartButton
                emoji="🔤"
                label="Add words"
                hint="Stitch a name or message"
                onClick={() => useEditorStore.getState().setPendingStart("text")}
              />
              <StartButton
                emoji="✏️"
                label="Draw it"
                hint="Draw your own shape"
                onClick={() => {
                  useEditorStore.getState().setTool("fill");
                  setStartDismissed(true);
                }}
              />
            </div>
            <p className="mt-3 text-xs text-navy/45">
              New here? Press <b>?</b> any time for help.
            </p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 right-3 rounded-sm bg-navy/85 px-2 py-0.5 font-mono text-[11px] tracking-wide text-butter-100">
        {rulerUnit === "inch"
          ? `${mmToInch(project.widthMm).toFixed(2)} × ${mmToInch(project.heightMm).toFixed(2)} in`
          : `${project.widthMm.toFixed(0)} × ${project.heightMm.toFixed(0)} mm`}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

/** Big friendly action in the empty-state quick-start guide. */
function StartButton({
  emoji,
  label,
  hint,
  onClick,
}: {
  emoji: string;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-xl border border-navy/15 bg-white px-3 py-3 text-navy transition-colors hover:border-navy/40 hover:bg-butter-100"
    >
      <span className="text-2xl" aria-hidden>
        {emoji}
      </span>
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-[11px] text-navy/55">{hint}</span>
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
                y={horizontal ? 2 : pos + 1}
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
  // Render the whole preview as ONE custom canvas Shape rather than hundreds of
  // <Line> nodes: during playback simIndex changes every frame, and reconciling
  // hundreds of Konva nodes per frame is both slow and fragile (it was crashing
  // the canvas). Drawing straight to the context is fast and rock-solid. Each
  // stitch is stroked at the real thread thickness (~0.4 mm) so a dense fill or
  // satin reads as solid coverage instead of separate hairline "scanlines".
  const mmPx = px(1) - px(0);
  const threadPx = Math.min(4, Math.max(1.4, mmPx * 0.42));
  return (
    <Group listening={false}>
      <Shape
        sceneFunc={(ctx) => {
          for (const seg of segs) {
            if (seg.points.length === 0) continue;
            const c = colorById.get(seg.colorId);
            ctx.beginPath();
            ctx.moveTo(px(seg.points[0].x), py(seg.points[0].y));
            for (let i = 1; i < seg.points.length; i++) {
              ctx.lineTo(px(seg.points[i].x), py(seg.points[i].y));
            }
            ctx.setAttr("strokeStyle", c ? `rgb(${c.rgb.join(",")})` : "#888");
            ctx.setAttr("lineWidth", seg.underlay ? 0.6 : threadPx);
            ctx.setAttr("lineCap", "round");
            ctx.setAttr("lineJoin", "round");
            ctx.setAttr("globalAlpha", seg.underlay ? 0.4 : 0.95);
            ctx.stroke();
          }
          ctx.setAttr("globalAlpha", 1);
        }}
      />
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
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const guidesEnabled = useEditorStore((s) => s.guidesEnabled);
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
        if (snapEnabled) {
          const res = snap(moving, targets, hoopMm, SNAP_MM);
          if (res.dx !== 0) g.x(g.x() + res.dx * scalePx);
          if (res.dy !== 0) g.y(g.y() + res.dy * scalePx);
          onGuides(guidesEnabled ? { x: res.guidesX, y: res.guidesY } : { x: [], y: [] });
        } else {
          onGuides({ x: [], y: [] });
        }
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
