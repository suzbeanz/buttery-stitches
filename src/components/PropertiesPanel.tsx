import { useMemo, useState } from "react";
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
    <aside className="flex h-full w-64 shrink-0 flex-col border-l border-navy/15 bg-butter-100">
      <div className="border-b border-navy/15 px-3 py-2 font-butter text-sm font-semibold text-navy">
        Properties
      </div>

      <div className="flex-1 overflow-y-auto">
        <DesignPanel />

        {selected.length === 0 ? (
          <div className="px-3 py-5 text-sm text-navy/60">
            Select an object to edit its stitch parameters.
          </div>
        ) : selected.length > 1 ? (
          <div className="px-3 py-5 text-sm text-navy/60">
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
    <div className="flex flex-col gap-3 border-b border-navy/15 p-3 text-sm">
      <Field label="Name">
        <input
          value={object.name}
          onChange={(e) => onName(e.target.value)}
          className="input"
        />
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
        <NumberField
          label="Stitch length (mm)"
          value={p.stitchLength ?? DEFAULT_PARAMS.stitchLength}
          step={0.1}
          min={0.5}
          onChange={(v) => onParam({ stitchLength: v })}
        />
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
          label="Angle (°)"
          value={p.angle ?? DEFAULT_PARAMS.angle}
          step={5}
          onChange={(v) => onParam({ angle: v })}
        />
      )}

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
        </>
      )}

      {object.type !== "running" && (
        <label className="flex items-center gap-2 text-navy">
          <input
            type="checkbox"
            checked={p.underlay ?? DEFAULT_PARAMS.underlay}
            onChange={(e) => onParam({ underlay: e.target.checked })}
          />
          Underlay
        </label>
      )}

      {object.type !== "running" && (
        <label className="flex items-center gap-2 text-navy">
          <input
            type="checkbox"
            checked={p.outline ?? DEFAULT_PARAMS.outline}
            onChange={(e) => onParam({ outline: e.target.checked })}
          />
          Show outline
        </label>
      )}

      <div className="mt-1 flex items-center justify-between rounded bg-butter-200/60 px-2 py-1 text-xs text-navy/80">
        <span>Stitches</span>
        <span className="tabular-nums">{stitchCount.toLocaleString()}</span>
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
  const addObject = useProjectStore((s) => s.addObject);
  const addColor = useProjectStore((s) => s.addColor);
  const reorderObjects = useProjectStore((s) => s.reorderObjects);

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

    // addObject appends to the end, so add each outline and then move it to sit
    // immediately after the fill (and after any earlier outlines we just added).
    outlines.forEach((outline, i) => {
      addObject(outline);
      const from = useProjectStore.getState().project.objects.length - 1;
      const fillIndex = useProjectStore
        .getState()
        .project.objects.findIndex((o) => o.id === fill.id);
      reorderObjects(from, fillIndex + 1 + i);
    });
  };

  return (
    <div className="flex flex-col gap-2 border-b border-navy/15 p-3 text-sm">
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
        />
        Outline holes
      </label>

      <button
        onClick={addOutline}
        className="rounded bg-navy px-2 py-1 text-xs text-butter-200 hover:bg-navy-light"
      >
        Add satin outline
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThreadColors() {
  const colors = useProjectStore((s) => s.project.colors);
  const addColor = useProjectStore((s) => s.addColor);
  const updateColor = useProjectStore((s) => s.updateColor);
  const activeColorId = useEditorStore((s) => s.activeColorId);
  const setActiveColorId = useEditorStore((s) => s.setActiveColorId);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-navy/60">
          Threads
        </span>
        <button
          onClick={() =>
            addColor({ id: newId("color"), rgb: [120, 120, 120], name: "New" })
          }
          className="rounded bg-navy px-2 py-0.5 text-xs text-butter-200 hover:bg-navy-light"
        >
          + Add
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {colors.map((c) => (
          <li
            key={c.id}
            className={`flex flex-col gap-1 rounded px-1.5 py-1.5 ${
              activeColorId === c.id ? "bg-butter-300" : "hover:bg-butter-200/70"
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
                title="Change color"
              />
              <input
                value={c.name ?? ""}
                placeholder="Unnamed"
                onChange={(e) => updateColor(c.id, { name: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm text-navy outline-none"
              />
              <button
                onClick={() => setActiveColorId(c.id)}
                title="Use for new objects"
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  activeColorId === c.id
                    ? "bg-navy text-butter-200"
                    : "text-navy/60 hover:bg-butter-300/60"
                }`}
              >
                {activeColorId === c.id ? "Active" : "Use"}
              </button>
            </div>
            {/* Brand / catalog code for the thread worksheet. */}
            <div className="flex gap-1 pl-7">
              <input
                value={c.brand ?? ""}
                placeholder="Brand"
                onChange={(e) => updateColor(c.id, { brand: e.target.value })}
                className="min-w-0 flex-1 rounded border border-navy/15 bg-butter-50/60 px-1 py-0.5 text-[11px] text-navy outline-none placeholder:text-navy/30"
              />
              <input
                value={c.code ?? ""}
                placeholder="Code"
                onChange={(e) => updateColor(c.id, { code: e.target.value })}
                className="w-16 rounded border border-navy/15 bg-butter-50/60 px-1 py-0.5 text-[11px] text-navy outline-none placeholder:text-navy/30"
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
      <span className="text-xs text-navy/60">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="input"
      />
    </Field>
  );
}
