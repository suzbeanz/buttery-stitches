import { useEffect, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  X,
  PaintBucket,
  AlignJustify,
  Minus,
  type LucideIcon,
} from "lucide-react";
import { useEditorStore } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";
import { convertObjectType } from "../lib/objects";
import type { EmbObject, StitchType } from "../types/project";

/**
 * Guided region review. After an auto-digitize drops a pile of objects on the
 * canvas, this floating card walks the user through them one at a time so they can
 * confirm each region's stitch type and keep or skip it before sewing. It reuses
 * the existing primitives: the selection highlight frames the current region,
 * `convertObjectType` retypes it, and the `visible` flag is "skip" (already
 * excluded from stitchout). Renders nothing unless a review is active.
 */

const TYPE_ICON: Record<StitchType, LucideIcon> = {
  fill: PaintBucket,
  satin: AlignJustify,
  running: Minus,
};

const TYPE_LABEL: Record<StitchType, string> = {
  fill: "Fill",
  satin: "Satin",
  running: "Running",
};

/** Humanized read-out of what the region currently is (the digitizer's guess). */
function detectedLabel(o: EmbObject): string {
  if (o.type === "fill") {
    const style = o.params.fillStyle;
    return style && style !== "tatami" ? `Fill — ${style}` : "Fill";
  }
  if (o.type === "satin") return o.params.lineArt ? "Satin — line art" : "Satin column";
  return "Running line";
}

export default function ReviewBar() {
  const reviewIds = useEditorStore((s) => s.reviewIds);
  const reviewIndex = useEditorStore((s) => s.reviewIndex);
  const reviewNext = useEditorStore((s) => s.reviewNext);
  const reviewPrev = useEditorStore((s) => s.reviewPrev);
  const endReview = useEditorStore((s) => s.endReview);

  const objects = useProjectStore((s) => s.project.objects);
  const colors = useProjectStore((s) => s.project.colors);
  const setSelection = useProjectStore((s) => s.setSelection);
  const updateObject = useProjectStore((s) => s.updateObject);

  const colorById = useMemo(
    () => new Map(colors.map((c) => [c.id, c])),
    [colors],
  );

  // The current region resolved against the live project. After an undo the frozen
  // id list may reference objects that no longer exist; resolve to the present one.
  const current = useMemo(() => {
    if (!reviewIds) return null;
    const id = reviewIds[reviewIndex];
    return objects.find((o) => o.id === id) ?? null;
  }, [reviewIds, reviewIndex, objects]);

  // Undo guard: if none of the reviewed ids survive in the project, close review so
  // we never dangle over a vanished design.
  const anyPresent = useMemo(
    () => !!reviewIds && reviewIds.some((id) => objects.some((o) => o.id === id)),
    [reviewIds, objects],
  );
  useEffect(() => {
    if (reviewIds && !anyPresent) endReview();
  }, [reviewIds, anyPresent, endReview]);

  // Frame the current region with the existing selection highlight, and keep the
  // whole design fitted as we step. Only select a visible object — skipping hides
  // it (and projectStore drops it from the selection), so re-selecting would flicker.
  const currentVisibleId = current?.visible ? current.id : null;
  useEffect(() => {
    if (currentVisibleId) setSelection([currentVisibleId]);
  }, [currentVisibleId, setSelection]);
  useEffect(() => {
    if (reviewIds)
      window.dispatchEvent(new CustomEvent("bs:zoom", { detail: "fit" }));
  }, [reviewIndex, reviewIds]);

  if (!reviewIds || !current) return null;

  const total = reviewIds.length;
  const isLast = reviewIndex >= total - 1;
  const color = colorById.get(current.colorId);

  const setType = (type: StitchType) => {
    if (type === current.type) return;
    updateObject(current.id, convertObjectType(current, type));
  };
  const toggleKeep = () =>
    updateObject(current.id, { visible: !current.visible });

  return (
    <div
      role="group"
      aria-label="Review regions"
      className="anim-press-in pointer-events-auto absolute inset-x-0 bottom-3 z-20 mx-auto flex w-fit max-w-[calc(100%-1rem)] flex-wrap items-center gap-3 rounded-sm border-2 border-ink bg-cream px-3 py-2 shadow-press"
    >
      <span className="font-label text-xs font-semibold uppercase tracking-wide text-ink-deep">
        Region {reviewIndex + 1} of {total}
      </span>

      <span className="flex min-w-0 items-center gap-1.5 text-sm text-navy">
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-sm border border-navy/30"
          style={{ backgroundColor: color ? `rgb(${color.rgb.join(",")})` : "#888" }}
        />
        <span className="max-w-[10rem] truncate">{current.name}</span>
        <span className="hidden text-navy/50 sm:inline">· {detectedLabel(current)}</span>
      </span>

      {/* Stitch type switch */}
      <div className="flex overflow-hidden rounded-sm border-2 border-ink text-xs">
        {(["running", "satin", "fill"] as StitchType[]).map((t) => {
          const Icon = TYPE_ICON[t];
          const active = current.type === t;
          return (
            <button
              key={t}
              onClick={() => setType(t)}
              aria-pressed={active}
              data-tip={TYPE_LABEL[t]}
              data-tip-side="top"
              className={`tap-target flex items-center gap-1 px-2.5 py-1 font-label font-semibold uppercase tracking-wide ${
                active ? "bg-ink text-cream" : "bg-cream text-ink hover:bg-butter-200"
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{TYPE_LABEL[t]}</span>
            </button>
          );
        })}
      </div>

      {/* Keep / skip — skip reuses the visible flag (excluded from stitchout). */}
      <button
        onClick={toggleKeep}
        aria-pressed={!current.visible}
        className={`tap-target flex items-center gap-1 rounded-sm border-2 border-ink px-2.5 py-1 font-label text-xs font-semibold uppercase tracking-wide ${
          current.visible
            ? "bg-cream text-ink hover:bg-butter-200"
            : "bg-stamp text-cream"
        }`}
      >
        {current.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        {current.visible ? "Skip" : "Skipped"}
      </button>

      {/* Navigation */}
      <div className="flex items-center gap-1">
        <button
          onClick={reviewPrev}
          disabled={reviewIndex === 0}
          aria-label="Previous region"
          data-tip="Back"
          data-tip-side="top"
          className="tap-target grid h-8 w-8 place-items-center rounded-sm border-2 border-ink bg-cream text-ink hover:bg-butter-200 disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        {isLast ? (
          <button
            onClick={endReview}
            className="tap-target rounded-sm border-2 border-ink bg-ink px-3 py-1 font-label text-xs font-semibold uppercase tracking-wide text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
          >
            Done
          </button>
        ) : (
          <button
            onClick={reviewNext}
            aria-label="Next region"
            data-tip="Next"
            data-tip-side="top"
            className="tap-target grid h-8 w-8 place-items-center rounded-sm border-2 border-ink bg-ink text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>

      <button
        onClick={endReview}
        aria-label="Close review"
        data-tip="Close"
        data-tip-side="top"
        className="tap-target grid h-7 w-7 place-items-center rounded-sm text-navy/60 hover:bg-butter-200 hover:text-ink"
      >
        <X size={15} />
      </button>
    </div>
  );
}
