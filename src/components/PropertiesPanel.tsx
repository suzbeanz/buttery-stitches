import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  SlidersHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  SendToBack,
  BringToFront,
  ChevronUp,
  ChevronDown,
  Group,
  Ungroup,
  Combine,
  Split,
  Trash2,
  Check,
} from "lucide-react";
import { alignObjects, distributeObjects, type AlignEdge } from "../lib/arrange";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { DEFAULT_PARAMS } from "../types/project";
import type {
  EmbObject,
  EmbObjectParams,
  Path,
  ThreadColor,
} from "../types/project";
import { newId } from "../lib/id";
import { convertObjectType, satinWidthOf, setSatinWidth } from "../lib/objects";
import { splitRegionComponents } from "../lib/regions";
import { toast } from "../store/toastStore";
import { MOTIFS } from "../lib/engine/motifs";
import { buildOutline, DEFAULT_OUTLINE_WIDTH } from "../lib/outline";
import { generateObjectStitches } from "../lib/engine";
import DesignPanel from "./DesignPanel";

/**
 * Right panel: parameters for the current selection plus thread-color
 * management. Live stitch counts and validation warnings arrive with the
 * stitch engine (Phase 3).
 */
export default function PropertiesPanel() {
  const objects = useProjectStore((s) => s.project.objects);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const updateObject = useProjectStore((s) => s.updateObject);
  const updateObjectParams = useProjectStore((s) => s.updateObjectParams);

  const selected = useMemo(
    () => objects.filter((o) => selectedIds.includes(o.id)),
    [objects, selectedIds],
  );

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-l border-navy/25 bg-butter-100">
      <div className="flex items-center gap-1.5 border-b border-ink/20 px-3 py-2.5 font-label text-xs font-semibold uppercase tracking-[0.18em] text-ink-deep">
        <SlidersHorizontal size={14} className="text-ink-deep" aria-hidden /> Properties
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DesignPanel />

        <ArrangeSection />

        {selected.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <SlidersHorizontal size={22} className="text-ink/25" aria-hidden />
            <p className="font-body text-sm text-navy/60">
              Select an object to fine-tune its stitches.
            </p>
          </div>
        ) : selected.length > 1 ? (
          <div className="px-3 py-4 text-center font-body text-sm text-navy/60">
            {selected.length} objects selected.
          </div>
        ) : (
          <>
            <ObjectProperties
              object={selected[0]}
              onName={(name) => updateObject(selected[0].id, { name })}
              // Converting type also rebuilds geometry to satisfy the new
              // type's invariant (satin = rail pair, running/fill = one
              // polyline).
              onType={(type) =>
                updateObject(
                  selected[0].id,
                  convertObjectType(selected[0], type),
                )
              }
              onColor={(colorId) => updateObject(selected[0].id, { colorId })}
              onPaths={(paths) => updateObject(selected[0].id, { paths })}
              onParam={(patch) => updateObjectParams(selected[0].id, patch)}
            />
            {selected[0].type === "fill" && (
              <OutlineControl fill={selected[0]} />
            )}
          </>
        )}

        <ThreadColors />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

/** A compact icon button used by the Arrange controls. */
function ArrangeBtn({
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
      data-tip={label}
      aria-label={label}
      className="tap-target grid h-8 flex-1 place-items-center rounded-sm border border-ink/25 bg-cream text-ink-deep hover:bg-butter-200 disabled:opacity-30 disabled:hover:bg-cream"
    >
      {children}
    </button>
  );
}

/**
 * Align, distribute, and re-order the current selection. Align uses the
 * selection's combined box (2+) or the hoop (a lone object); distribute needs 3+;
 * order moves objects in the stitch sequence (later = sits on top).
 */
function ArrangeSection() {
  const objects = useProjectStore((s) => s.project.objects);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const hoop = useProjectStore((s) => s.project.hoop);
  const updateProject = useProjectStore((s) => s.updateProject);
  const moveOrder = useProjectStore((s) => s.moveOrder);
  const groupObjects = useProjectStore((s) => s.groupObjects);
  const ungroupObjects = useProjectStore((s) => s.ungroupObjects);
  const mergeObjects = useProjectStore((s) => s.mergeObjects);
  const splitRegion = useProjectStore((s) => s.splitRegion);
  const n = selectedIds.length;
  const selectedSet = new Set(selectedIds);
  const anyGrouped = objects.some((o) => selectedSet.has(o.id) && o.groupId);
  const selectedObjs = useMemo(
    () => objects.filter((o) => selectedSet.has(o.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, selectedIds],
  );
  // Merge needs 2+ fills of one color; split needs a lone fill with 2+ pieces.
  const canMerge =
    selectedObjs.length >= 2 &&
    selectedObjs.every(
      (o) => o.type === "fill" && o.colorId === selectedObjs[0].colorId,
    );
  const splitTarget =
    selectedObjs.length === 1 && selectedObjs[0].type === "fill"
      ? selectedObjs[0]
      : null;
  const canSplit = useMemo(
    () => !!splitTarget && splitRegionComponents(splitTarget.paths).length > 1,
    [splitTarget],
  );
  if (n === 0) return null;

  const align = (edge: AlignEdge) =>
    updateProject({ objects: alignObjects(objects, selectedIds, edge, hoop) });
  const distribute = (axis: "h" | "v") =>
    updateProject({ objects: distributeObjects(objects, selectedIds, axis) });

  return (
    <div className="flex flex-col gap-2 border-b border-navy/25 p-3 text-sm">
      <span className="font-label text-xs font-semibold uppercase tracking-[0.14em] text-ink-deep">
        Arrange
      </span>

      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">
        {n >= 2 ? "Align selection" : "Align in hoop"}
      </span>
      <div className="flex gap-1">
        <ArrangeBtn label="Align left" onClick={() => align("left")}><AlignStartVertical size={15} /></ArrangeBtn>
        <ArrangeBtn label="Align centers (horizontal)" onClick={() => align("hcenter")}><AlignCenterVertical size={15} /></ArrangeBtn>
        <ArrangeBtn label="Align right" onClick={() => align("right")}><AlignEndVertical size={15} /></ArrangeBtn>
        <ArrangeBtn label="Align top" onClick={() => align("top")}><AlignStartHorizontal size={15} /></ArrangeBtn>
        <ArrangeBtn label="Align middles (vertical)" onClick={() => align("vcenter")}><AlignCenterHorizontal size={15} /></ArrangeBtn>
        <ArrangeBtn label="Align bottom" onClick={() => align("bottom")}><AlignEndHorizontal size={15} /></ArrangeBtn>
      </div>

      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">
        Distribute {n < 3 && <span className="normal-case tracking-normal text-ink/40">(needs 3+)</span>}
      </span>
      <div className="flex gap-1">
        <ArrangeBtn label="Distribute horizontally" disabled={n < 3} onClick={() => distribute("h")}>
          <AlignHorizontalDistributeCenter size={15} />
        </ArrangeBtn>
        <ArrangeBtn label="Distribute vertically" disabled={n < 3} onClick={() => distribute("v")}>
          <AlignVerticalDistributeCenter size={15} />
        </ArrangeBtn>
      </div>

      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">
        Order
      </span>
      <div className="flex gap-1">
        <ArrangeBtn label="Send to back (stitch first)" onClick={() => moveOrder(selectedIds, "first")}><SendToBack size={15} /></ArrangeBtn>
        <ArrangeBtn label="Backward (stitch earlier)" onClick={() => moveOrder(selectedIds, "earlier")}><ChevronUp size={15} /></ArrangeBtn>
        <ArrangeBtn label="Forward (stitch later)" onClick={() => moveOrder(selectedIds, "later")}><ChevronDown size={15} /></ArrangeBtn>
        <ArrangeBtn label="Bring to front (stitch last)" onClick={() => moveOrder(selectedIds, "last")}><BringToFront size={15} /></ArrangeBtn>
      </div>

      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">
        Group
      </span>
      <div className="flex gap-1">
        <ArrangeBtn label="Group" disabled={n < 2} onClick={() => groupObjects(selectedIds)}>
          <Group size={15} />
        </ArrangeBtn>
        <ArrangeBtn label="Ungroup" disabled={!anyGrouped} onClick={() => ungroupObjects(selectedIds)}>
          <Ungroup size={15} />
        </ArrangeBtn>
      </div>

      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">
        Regions
      </span>
      <div className="flex gap-1">
        <ArrangeBtn
          label="Merge regions (same-color fills)"
          disabled={!canMerge}
          onClick={() => {
            mergeObjects(selectedIds);
            toast(`Merged ${selectedObjs.length} regions`, "success");
          }}
        >
          <Combine size={15} />
        </ArrangeBtn>
        <ArrangeBtn
          label="Split into separate pieces"
          disabled={!canSplit}
          onClick={() => {
            if (!splitTarget) return;
            const count = splitRegionComponents(splitTarget.paths).length;
            splitRegion(splitTarget.id);
            toast(`Split into ${count} regions`, "success");
          }}
        >
          <Split size={15} />
        </ArrangeBtn>
      </div>
    </div>
  );
}

function ObjectProperties({
  object,
  onName,
  onType,
  onColor,
  onPaths,
  onParam,
}: {
  object: EmbObject;
  onName: (name: string) => void;
  onType: (type: EmbObject["type"]) => void;
  onColor: (colorId: string) => void;
  onPaths: (paths: Path[]) => void;
  onParam: (patch: Partial<EmbObjectParams>) => void;
}) {
  const colors = useProjectStore((s) => s.project.colors);
  const p = object.params;

  // Live stitch count for the selected object (recomputed only when it changes).
  const stitchCount = useMemo(() => {
    try {
      const { underlay, main } = generateObjectStitches(object);
      return underlay.length + main.length;
    } catch {
      return 0;
    }
  }, [object]);

  return (
    <div className="flex flex-col gap-3 border-b border-navy/25 p-3 text-sm">
      <Field label="Name">
        <CommitInput value={object.name} onCommit={onName} />
      </Field>

      <Field label="Stitch type">
        <select
          value={object.type}
          onChange={(e) => onType(e.target.value as EmbObject["type"])}
          className="input"
        >
          <option value="running">Running</option>
          <option value="satin">Satin</option>
          <option value="fill">Fill</option>
        </select>
      </Field>

      <Field label="Thread color">
        <select
          value={object.colorId}
          onChange={(e) => onColor(e.target.value)}
          className="input"
        >
          {colors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? `rgb(${c.rgb.join(",")})`}
            </option>
          ))}
        </select>
      </Field>

      {object.type === "running" && (
        <>
          <NumberField
            label="Stitch length (mm)"
            value={p.stitchLength ?? DEFAULT_PARAMS.stitchLength}
            step={0.1}
            min={0.5}
            onChange={(v) => onParam({ stitchLength: v })}
          />
          <Field label="Line weight">
            <select
              value={p.beanRepeats ?? DEFAULT_PARAMS.beanRepeats}
              onChange={(e) => onParam({ beanRepeats: Number(e.target.value) })}
              className="input"
            >
              <option value={0}>Single</option>
              <option value={3}>Bold — triple (3×)</option>
              <option value={5}>Bolder — bean (5×)</option>
              <option value={7}>Boldest — bean (7×)</option>
            </select>
          </Field>
          <Field label="Motif run">
            <select
              value={p.motifRun ?? "none"}
              onChange={(e) => onParam({ motifRun: e.target.value })}
              className="input"
            >
              <option value="none">None (plain line)</option>
              {MOTIFS.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          {p.motifRun && p.motifRun !== "none" && (
            <NumberField
              label="Motif size (mm)"
              value={p.motifSizeMm ?? DEFAULT_PARAMS.motifSizeMm}
              step={0.5}
              min={1}
              onChange={(v) => onParam({ motifSizeMm: v })}
            />
          )}
        </>
      )}

      {(object.type === "fill" || object.type === "satin") && (
        <NumberField
          label="Density (mm/row)"
          value={p.density ?? DEFAULT_PARAMS.density}
          step={0.05}
          min={0.1}
          onChange={(v) => onParam({ density: v })}
        />
      )}

      {object.type === "fill" && (
        <NumberField
          label="Stitch length (mm)"
          value={p.fillStitchLength ?? DEFAULT_PARAMS.fillStitchLength}
          step={0.5}
          min={1}
          onChange={(v) => onParam({ fillStitchLength: v })}
        />
      )}

      {object.type === "fill" && !p.applique && (
        <Field label="Stitch style">
          <select
            value={p.fillStyle ?? DEFAULT_PARAMS.fillStyle}
            onChange={(e) => {
              const fillStyle = e.target.value as
                | "tatami"
                | "satin"
                | "contour"
                | "gradient"
                | "motif"
                | "blend";
              // Default the second color so a blend renders the moment it's picked.
              const blendColorId =
                fillStyle === "blend" && !p.blendColorId
                  ? colors.find((c) => c.id !== object.colorId)?.id ?? object.colorId
                  : p.blendColorId;
              onParam({ fillStyle, blendColorId });
            }}
            className="input"
          >
            <option value="tatami">Solid fill (tatami)</option>
            <option value="satin">Satin columns</option>
            <option value="contour">Contour (echo the shape)</option>
            <option value="gradient">Gradient (shaded)</option>
            <option value="blend">Multi-blend (two threads)</option>
            <option value="motif">Motif (decorative)</option>
          </select>
        </Field>
      )}

      {object.type === "fill" && p.fillStyle === "blend" && (
        <Field label="Blend to color">
          <select
            value={p.blendColorId ?? colors.find((c) => c.id !== object.colorId)?.id ?? object.colorId}
            onChange={(e) => onParam({ blendColorId: e.target.value })}
            className="input"
          >
            {colors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? `rgb(${c.rgb.join(",")})`}
              </option>
            ))}
          </select>
        </Field>
      )}

      {object.type === "fill" && p.fillStyle === "motif" && (
        <>
          <Field label="Motif">
            <select
              value={p.motif ?? DEFAULT_PARAMS.motif}
              onChange={(e) => onParam({ motif: e.target.value })}
              className="input"
            >
              {MOTIFS.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          <NumberField
            label="Motif size (mm)"
            value={p.motifSizeMm ?? DEFAULT_PARAMS.motifSizeMm}
            step={0.5}
            min={1}
            onChange={(v) => onParam({ motifSizeMm: v })}
          />
        </>
      )}

      {object.type === "fill" && p.fillStyle !== "motif" && (
        <Disclosure title="Advanced fill">
          <Field label="Carve pattern">
            <select
              value={p.carve ?? "none"}
              onChange={(e) => onParam({ carve: e.target.value })}
              className="input"
            >
              <option value="none">None</option>
              {MOTIFS.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-navy">
            <input
              type="checkbox"
              checked={!!p.applique}
              onChange={(e) => onParam({ applique: e.target.checked })}
              className="accent-ink"
            />
            Appliqué (placement → stop → tackdown → stop → cover)
          </label>
        </Disclosure>
      )}

      {object.type === "fill" &&
        (p.flowPath || p.directionDeg != null ? (
          // A painted grain (Direction tool) overrides the auto angle — a straight
          // drag is a fixed angle, a curve is a flow the rows follow. One click resets
          // both back to the automatic direction.
          <Field label="Direction">
            <div className="flex items-center justify-between gap-2 text-sm text-navy">
              <span>{p.flowPath ? "Curved (flow)" : `Manual — ${Math.round(p.directionDeg!)}°`}</span>
              <button
                type="button"
                onClick={() => onParam({ directionDeg: null, flowPath: null })}
                className="rounded-sm border border-ink/20 px-2 py-0.5 font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-navy/70 hover:bg-butter-200/60 hover:text-ink"
              >
                Auto
              </button>
            </div>
          </Field>
        ) : (
          <NumberField
            label="Angle (° from auto)"
            value={p.angle ?? DEFAULT_PARAMS.angle}
            step={5}
            onChange={(v) => onParam({ angle: v })}
          />
        ))}

      {object.type === "satin" && (
        <>
          <NumberField
            label="Column width (mm)"
            value={satinWidthOf(object.paths)}
            step={0.25}
            min={0.5}
            onChange={(v) => onPaths(setSatinWidth(object.paths, v))}
          />
          <NumberField
            label="Pull comp (mm)"
            value={p.pullComp ?? DEFAULT_PARAMS.pullComp}
            step={0.05}
            min={0}
            onChange={(v) => onParam({ pullComp: v })}
          />
          <NumberField
            label="Push comp (mm)"
            value={p.pushComp ?? DEFAULT_PARAMS.pushComp}
            step={0.05}
            min={0}
            onChange={(v) => onParam({ pushComp: v })}
          />
        </>
      )}

      {object.type !== "running" && (
        <label className="flex items-center gap-2 text-navy">
          <input
            type="checkbox"
            checked={p.underlay ?? DEFAULT_PARAMS.underlay}
            onChange={(e) => onParam({ underlay: e.target.checked })}
            className="accent-ink"
          />
          Underlay
        </label>
      )}

      {object.type !== "running" && (p.underlay ?? DEFAULT_PARAMS.underlay) && (
        <Field label="Underlay weight">
          <select
            value={p.underlayWeight ?? DEFAULT_PARAMS.underlayWeight}
            onChange={(e) =>
              onParam({
                underlayWeight: e.target.value as "auto" | "light" | "standard" | "heavy",
              })
            }
            className="input"
          >
            <option value="auto">Auto (from fabric)</option>
            <option value="light">Light — edge only</option>
            <option value="standard">Standard</option>
            <option value="heavy">Heavy — extra support</option>
          </select>
        </Field>
      )}

      {object.type !== "running" && (
        <label className="flex items-center gap-2 text-navy">
          <input
            type="checkbox"
            checked={p.outline ?? DEFAULT_PARAMS.outline}
            onChange={(e) => onParam({ outline: e.target.checked })}
            className="accent-ink"
          />
          Show outline
        </label>
      )}

      <div className="mt-1 flex items-center justify-between rounded-sm border border-ink/15 bg-butter-200/50 px-2 py-1 text-navy/80">
        <span className="font-label text-[11px] font-semibold uppercase tracking-[0.12em]">
          Stitches
        </span>
        <span className="font-mono text-xs tabular-nums">
          {stitchCount.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Sentinel value in the color picker that means "create a fresh thread color". */
const NEW_COLOR = "__new__";

/**
 * "Add satin outline": builds a satin border around the selected fill in a
 * chosen color and inserts it immediately after the fill in stitch order.
 */
function OutlineControl({ fill }: { fill: EmbObject }) {
  const colors = useProjectStore((s) => s.project.colors);
  const insertObjectsAfter = useProjectStore((s) => s.insertObjectsAfter);
  const addColor = useProjectStore((s) => s.addColor);

  const [widthMm, setWidthMm] = useState(DEFAULT_OUTLINE_WIDTH);
  // Default to a different color than the fill so the outline is visible.
  const [colorChoice, setColorChoice] = useState<string>(
    colors.find((c) => c.id !== fill.colorId)?.id ?? NEW_COLOR,
  );
  const [includeHoles, setIncludeHoles] = useState(false);

  const addOutline = () => {
    let colorId = colorChoice;
    if (colorChoice === NEW_COLOR) {
      const color: ThreadColor = {
        id: newId("color"),
        rgb: [120, 120, 120],
        name: "Outline",
      };
      addColor(color);
      colorId = color.id;
    }

    const outlines = buildOutline(fill.paths, widthMm, colorId, {
      includeHoles,
    });
    if (outlines.length === 0) return;

    // Insert all outline rings right after the fill in ONE step, so the whole
    // action is a single undo (never a half-applied, mis-ordered outline).
    insertObjectsAfter(fill.id, outlines);
  };

  return (
    <div className="flex flex-col gap-2 border-b border-navy/25 p-3 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-navy/60">
        Outline
      </span>

      <NumberField
        label="Outline width (mm)"
        value={widthMm}
        step={0.25}
        min={0.5}
        onChange={setWidthMm}
      />

      <Field label="Outline color">
        <select
          value={colorChoice}
          onChange={(e) => setColorChoice(e.target.value)}
          className="input"
        >
          {colors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? `rgb(${c.rgb.join(",")})`}
            </option>
          ))}
          <option value={NEW_COLOR}>New color…</option>
        </select>
      </Field>

      <label className="flex items-center gap-2 text-navy">
        <input
          type="checkbox"
          checked={includeHoles}
          onChange={(e) => setIncludeHoles(e.target.checked)}
          className="accent-ink"
        />
        Outline holes
      </label>

      <button
        onClick={addOutline}
        className="rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
      >
        Add satin outline
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThreadColors() {
  const colors = useProjectStore((s) => s.project.colors);
  const objects = useProjectStore((s) => s.project.objects);
  const addColor = useProjectStore((s) => s.addColor);
  const updateColor = useProjectStore((s) => s.updateColor);
  const removeColor = useProjectStore((s) => s.removeColor);
  const activeColorId = useEditorStore((s) => s.activeColorId);
  const setActiveColorId = useEditorStore((s) => s.setActiveColorId);
  // Deleting the ACTIVE draw colour needs a confirming second click (it's not
  // referenced by an object, so the in-use guard wouldn't catch it).
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // A thread is removable only when nothing references it (so a delete never
  // silently recolors an object) and it isn't the last thread left.
  const usedIds = useMemo(() => {
    const s = new Set<string>();
    for (const o of objects) {
      s.add(o.colorId);
      if (o.params?.blendColorId) s.add(o.params.blendColorId);
    }
    return s;
  }, [objects]);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-label text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-deep">
          Threads
        </span>
        <button
          onClick={() =>
            addColor({ id: newId("color"), rgb: [120, 120, 120], name: "New" })
          }
          className="rounded-sm border-2 border-ink bg-ink px-2 py-0.5 font-label text-[10px] font-semibold uppercase tracking-wide text-cream shadow-press-sm hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
        >
          + Add
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {colors.map((c) => (
          <li
            key={c.id}
            className={`flex flex-col gap-1 rounded-sm px-1.5 py-1.5 ${
              activeColorId === c.id
                ? "bg-butter-200 ring-1 ring-ink/25"
                : "hover:bg-butter-200/60"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={rgbToHex(c.rgb)}
                onChange={(e) =>
                  updateColor(c.id, { rgb: hexToRgb(e.target.value) })
                }
                className="h-5 w-5 shrink-0 cursor-pointer rounded border border-navy/30 bg-transparent p-0"
                title={`Change color for ${c.name ?? "thread"}`}
                aria-label={`Change color for ${c.name ?? "thread"}`}
              />
              <CommitInput
                value={c.name ?? ""}
                placeholder="Unnamed"
                onCommit={(name) => updateColor(c.id, { name })}
                className="min-w-0 flex-1 bg-transparent text-sm text-navy outline-none"
              />
              <button
                onClick={() => setActiveColorId(c.id)}
                title="Use for new objects"
                className={`rounded-sm px-1.5 py-0.5 font-label text-[10px] font-semibold uppercase tracking-wide ${
                  activeColorId === c.id
                    ? "bg-ink text-cream"
                    : "text-ink/60 hover:bg-butter-300/60"
                }`}
              >
                {activeColorId === c.id ? "Active" : "Use"}
              </button>
              {(() => {
                const inUse = usedIds.has(c.id);
                const last = colors.length <= 1;
                const disabled = inUse || last;
                const isActive = c.id === activeColorId;
                const pending = confirmId === c.id;
                return (
                  <button
                    onClick={() => {
                      // First click on the active thread arms a confirm; everything
                      // else (and the second click) deletes immediately.
                      if (isActive && !pending) {
                        setConfirmId(c.id);
                        return;
                      }
                      removeColor(c.id);
                      setConfirmId(null);
                    }}
                    disabled={disabled}
                    aria-label={
                      pending ? `Confirm delete ${c.name ?? "thread"}` : `Delete ${c.name ?? "thread"}`
                    }
                    title={
                      last
                        ? "Can't delete the last thread"
                        : inUse
                          ? "In use — reassign objects first"
                          : pending
                            ? "Deleting your active thread — click again to confirm"
                            : isActive
                              ? "Delete your active thread"
                              : "Delete thread"
                    }
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-sm disabled:opacity-25 disabled:hover:bg-transparent ${
                      pending
                        ? "bg-stamp/15 text-stamp"
                        : "text-ink/45 hover:bg-stamp/10 hover:text-stamp disabled:hover:text-ink/45"
                    }`}
                  >
                    {pending ? <Check size={13} /> : <Trash2 size={13} />}
                  </button>
                );
              })()}
            </div>
            {/* Brand / catalog code for the thread worksheet. Commit on blur so a
                typed name is one undo step, not one per keystroke. */}
            <div className="flex gap-1 pl-7">
              <CommitInput
                value={c.brand ?? ""}
                placeholder="Brand"
                onCommit={(brand) => updateColor(c.id, { brand })}
                className="min-w-0 flex-1 rounded border border-navy/25 bg-butter-50/60 px-1 py-0.5 text-[11px] text-navy outline-none placeholder:text-navy/30"
              />
              <CommitInput
                value={c.code ?? ""}
                placeholder="Code"
                onCommit={(code) => updateColor(c.id, { code })}
                className="w-16 rounded border border-navy/25 bg-butter-50/60 px-1 py-0.5 text-[11px] text-navy outline-none placeholder:text-navy/30"
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">{label}</span>
      {children}
    </label>
  );
}

/**
 * A collapsible group for secondary controls — keeps the panel calm by tucking the
 * rarely-used extras behind one click. Collapsed by default.
 */
function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60 hover:text-ink"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        {title}
      </button>
      {open && <div className="flex flex-col gap-2 pl-1">{children}</div>}
    </div>
  );
}

/**
 * A text input that commits only on blur or Enter — so typing a name or color
 * label is a single undo step, not one per keystroke. It mirrors the live value
 * while focused and re-syncs if the underlying value changes elsewhere.
 */
function CommitInput({
  value,
  onCommit,
  placeholder,
  className = "input",
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={className}
    />
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  // Keep a draft while typing and COMMIT only on blur / Enter (not every
  // keystroke) — so the canvas doesn't jitter through "0.5 → 0.05 → 0.005" and the
  // edit is one undo step. The committed value is CLAMPed to [min,max] so a typed
  // number can never push a param below its safe floor (e.g. density 0). Re-syncs
  // to the live value when it changes elsewhere.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const clamp = (v: number) => {
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    return v;
  };
  const commit = () => {
    const v = parseFloat(draft);
    if (Number.isNaN(v)) {
      setDraft(String(value)); // invalid → revert
      return;
    }
    const c = clamp(v);
    if (c !== value) onChange(c);
    setDraft(String(c)); // show the clamped value
  };
  return (
    <Field label={label}>
      <input
        type="number"
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="input"
      />
    </Field>
  );
}
