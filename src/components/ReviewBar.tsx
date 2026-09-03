import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  X,
  PaintBucket,
  AlignJustify,
  Minus,
  Plus,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useEditorStore } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";
import { convertObjectType } from "../lib/objects";
import { styleObject, STITCH_STYLE_OPTIONS, type StitchStyle } from "../lib/stitchStyle";
import { buildOutline, DEFAULT_OUTLINE_WIDTH } from "../lib/outline";
import { DEFAULT_PARAMS } from "../types/project";
import type { EmbObject, EmbObjectParams, StitchType } from "../types/project";

/**
 * Guided region review. After an auto-digitize drops a pile of objects on the
 * canvas, this floating card walks the user through them one at a time so they can
 * confirm each region's stitch type and keep or skip it before sewing. It reuses
 * the existing primitives: the selection highlight frames the current region,
 * `convertObjectType` retypes it, and the `visible` flag is "skip" (already
 * excluded from stitchout). Renders nothing unless a review is active.
 *
 * REFINE (optional, per region): a collapsed row of the levers a digitizer
 * actually reaches for — stitch style (the wizard's per-color options, via the
 * same `styleObject` mapping), fill angle, density, and a real satin outline
 * on/off (`buildOutline`, the Properties panel's machinery). Every change is an
 * ordinary per-object store edit, so it re-styles ONLY the touched region —
 * other regions' stitches are untouched by construction — and each edit is one
 * undo step. Accept-all stays one tap: Done / close accept everything as-is.
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
  const updateObjectParams = useProjectStore((s) => s.updateObjectParams);
  const insertObjectsAfter = useProjectStore((s) => s.insertObjectsAfter);
  const removeObjects = useProjectStore((s) => s.removeObjects);

  // ---- optional per-region refine (collapsed by default) ----
  const [refineOpen, setRefineOpen] = useState(false);
  // The style OVERRIDE chosen per region id ("auto" = as traced), plus each
  // region's pre-override {type, params} so choosing Auto genuinely restores
  // the trace's own classification. Transient by design (like the review
  // cursor): it never lands in undo history.
  const [styleById, setStyleById] = useState<Record<string, StitchStyle>>({});
  const [styleOriginals, setStyleOriginals] = useState<
    Record<string, { type: StitchType; params: EmbObjectParams }>
  >({});
  // Satin-outline objects added per region id, so the checkbox can remove them.
  const [outlineIds, setOutlineIds] = useState<Record<string, string[]>>({});

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
    // An explicit retype CONVERTS the geometry, so any refine style override
    // and its captured original are stale: a later style pick would run
    // styleObject on non-fill geometry (flipping type without converting
    // paths), and Auto-restore would stamp pre-retype params onto converted
    // paths. The region reads as Auto again after a retype.
    setStyleById((m) => {
      const { [current.id]: _gone, ...rest } = m;
      return rest;
    });
    setStyleOriginals((m) => {
      const { [current.id]: _gone, ...rest } = m;
      return rest;
    });
  };
  const toggleKeep = () =>
    updateObject(current.id, { visible: !current.visible });

  // ---- refine handlers (all scoped to current.id — one region, one edit) ----
  const regionStyle = styleById[current.id] ?? "auto";
  const setRegionStyle = (s: StitchStyle) => {
    if (s === regionStyle) return;
    if (s === "auto") {
      // Restore the trace's own classification, captured before the first override.
      const orig = styleOriginals[current.id];
      if (orig) updateObject(current.id, { type: orig.type, params: orig.params });
    } else {
      if (!(current.id in styleOriginals))
        setStyleOriginals((m) => ({
          ...m,
          [current.id]: { type: current.type, params: current.params },
        }));
      // The wizard's exact per-color mapping — styleObject never touches paths,
      // so only type + params flow into the store.
      const styled = styleObject(current, s);
      updateObject(current.id, { type: styled.type, params: styled.params });
    }
    setStyleById((m) => ({ ...m, [current.id]: s }));
  };

  // Style overrides apply to traced FILL regions (running is covered by the type
  // switch; a true satin rail pair has no ring geometry for the fill styles).
  const styleable = current.type === "fill" || regionStyle !== "auto";
  // Angle is offered only when the BASE angle actually drives the fill: any
  // painted direction overrides it (precedence: angleGuides ≥2 > flowPath >
  // directionDeg > base angle — see EmbObjectParams).
  const showAngle =
    current.type === "fill" &&
    (current.params.angleGuides?.length ?? 0) < 2 &&
    current.params.flowPath == null &&
    current.params.directionDeg == null;
  const showDensity = current.type === "fill" || current.type === "satin";

  // Real satin outline on/off — the Properties panel's buildOutline machinery,
  // inserted right after this region (and removable). Sewn in the region's own
  // thread so the toggle never adds a color change.
  const liveOutlineIds = (outlineIds[current.id] ?? []).filter((id) =>
    objects.some((o) => o.id === id),
  );
  const hasOutline = liveOutlineIds.length > 0;
  const toggleOutline = () => {
    if (hasOutline) {
      removeObjects(liveOutlineIds);
      setOutlineIds((m) => ({ ...m, [current.id]: [] }));
    } else {
      const built = buildOutline(current.paths, DEFAULT_OUTLINE_WIDTH, current.colorId);
      if (built.length === 0) return;
      insertObjectsAfter(current.id, built);
      // insertObjectsAfter selects what it inserted — keep the review's frame
      // on the region being reviewed.
      setSelection([current.id]);
      setOutlineIds((m) => ({ ...m, [current.id]: built.map((o) => o.id) }));
    }
  };

  const round2 = (v: number) => Math.round(v * 100) / 100;
  const density = current.params.density ?? DEFAULT_PARAMS.density;
  const angle = current.params.angle ?? DEFAULT_PARAMS.angle;

  return (
    // Phones: a full-width sheet — identity (progress · name · keep · refine)
    // over actions (type · nav · close), plus the optional refine row — because
    // the old single flex-wrap row broke into 2-3 ragged rows over the exact
    // region being reviewed. From sm up the two core wrappers dissolve
    // (`sm:contents`) into the classic one-row bar; the refine row wraps onto
    // its own full-width line (`sm:basis-full`).
    <div
      role="group"
      aria-label="Review regions"
      className="anim-press-in pointer-events-auto absolute inset-x-2 bottom-2 z-20 mx-auto flex flex-col gap-2 rounded-sm border-2 border-ink bg-cream px-3 py-2 shadow-press sm:inset-x-0 sm:bottom-3 sm:w-fit sm:max-w-[calc(100%-1rem)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
    >
      <div className="flex min-w-0 items-center gap-2 sm:contents">
        <span className="shrink-0 font-label text-xs font-semibold uppercase tracking-wide text-ink-deep">
          Region {reviewIndex + 1} of {total}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-navy sm:flex-initial">
          <span
            className="h-3.5 w-3.5 shrink-0 rounded-sm border border-navy/30"
            style={{ backgroundColor: color ? `rgb(${color.rgb.join(",")})` : "#888" }}
          />
          <span className="max-w-[10rem] truncate">{current.name}</span>
          <span className="hidden text-navy/50 sm:inline">· {detectedLabel(current)}</span>
        </span>

        {/* Keep / skip — skip reuses the visible flag (excluded from stitchout). */}
        <button
          onClick={toggleKeep}
          aria-pressed={!current.visible}
          className={`tap-target flex shrink-0 items-center gap-1 rounded-sm border-2 border-ink px-2.5 py-1 font-label text-xs font-semibold uppercase tracking-wide ${
            current.visible
              ? "bg-cream text-ink hover:bg-butter-200"
              : "bg-stamp text-cream"
          }`}
        >
          {current.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          {current.visible ? "Skip" : "Skipped"}
        </button>

        {/* Optional per-region refine: style · angle · density · outline. */}
        {(styleable || showDensity) && (
          <button
            onClick={() => setRefineOpen((v) => !v)}
            aria-expanded={refineOpen}
            aria-label="Refine stitches"
            data-tip="Refine stitches"
            data-tip-side="top"
            // Edge button: end-anchor the tooltip so it can't spill past the
            // sheet and horizontally scroll the whole shell on a phone.
            data-tip-align="end"
            className={`tap-target grid h-8 w-8 shrink-0 place-items-center rounded-sm border-2 border-ink ${
              refineOpen ? "bg-ink text-cream" : "bg-cream text-ink hover:bg-butter-200"
            }`}
          >
            <SlidersHorizontal size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 sm:contents">
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
          data-tip="Accept all & close"
          data-tip-side="top"
          // Edge button: end-anchor the (always-present, transparent) tooltip
          // box so it can't widen the shell's scrollable area on a phone.
          data-tip-align="end"
          className="tap-target grid h-7 w-7 place-items-center rounded-sm text-navy/60 hover:bg-butter-200 hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      {/* REFINE row — live per-region stitch controls. Each change writes only
          this region's object, so the rest of the design never re-styles. */}
      {refineOpen && (styleable || showDensity || hasOutline) && (
        <div
          role="group"
          aria-label="Refine region stitches"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink/15 pt-2 sm:basis-full"
        >
          {styleable && (
            <label className="flex min-w-0 items-center gap-1.5 text-xs text-navy">
              <span className="font-label text-[10px] font-semibold uppercase tracking-wide text-navy/60">
                Style
              </span>
              {/* Width-capped: the 16px coarse-pointer font would otherwise
                  push this row past the phone sheet's edge. */}
              <select
                value={regionStyle}
                onChange={(e) => setRegionStyle(e.target.value as StitchStyle)}
                aria-label="Region stitch style"
                className="tap-target w-full max-w-[8.5rem] appearance-none rounded-sm border-2 border-ink/30 bg-cream px-1.5 py-1 text-xs text-navy outline-none focus:ring-1 focus:ring-ink/40"
              >
                {STITCH_STYLE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showAngle && (
            <MiniStepper
              label="Angle"
              display={`${Math.round(angle)}°`}
              onStep={(dir) => updateObjectParams(current.id, { angle: round2(angle + dir * 5) })}
            />
          )}

          {showDensity && (
            <MiniStepper
              label="Density"
              display={density.toFixed(2)}
              onStep={(dir) =>
                updateObjectParams(current.id, {
                  density: Math.max(0.1, round2(density + dir * 0.05)),
                })
              }
            />
          )}

          {/* Offered for fills — but ALWAYS while an inserted outline exists,
              whatever the region's current type: retyping away from fill must
              never orphan an outline with no way to remove it. */}
          {(current.type === "fill" || hasOutline) && (
            <label className="tap-target flex items-center gap-1.5 text-xs text-navy">
              <input
                type="checkbox"
                checked={hasOutline}
                onChange={toggleOutline}
                aria-label="Satin outline"
                className="accent-ink"
              />
              Outline
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** A compact −/value/+ stepper for the refine row (finger-sized buttons). */
function MiniStepper({
  label,
  display,
  onStep,
}: {
  label: string;
  display: string;
  onStep: (dir: 1 | -1) => void;
}) {
  return (
    <span className="flex items-center gap-1 text-xs text-navy">
      <span className="font-label text-[10px] font-semibold uppercase tracking-wide text-navy/60">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onStep(-1)}
        aria-label={`Decrease ${label.toLowerCase()}`}
        className="tap-target grid h-7 w-7 place-items-center rounded-sm border-2 border-ink/70 text-ink hover:bg-butter-200"
      >
        <Minus size={13} />
      </button>
      <span className="w-10 text-center font-mono tabular-nums">{display}</span>
      <button
        type="button"
        onClick={() => onStep(1)}
        aria-label={`Increase ${label.toLowerCase()}`}
        className="tap-target grid h-7 w-7 place-items-center rounded-sm border-2 border-ink/70 text-ink hover:bg-butter-200"
      >
        <Plus size={13} />
      </button>
    </span>
  );
}
