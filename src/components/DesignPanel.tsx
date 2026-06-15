import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { mmToInch, inchToMm } from "../lib/units";
import { HOOP_PRESETS } from "../lib/hoops";
import {
  designSize,
  designBounds,
  scaleAllPaths,
  fitToHoop,
} from "../lib/layout";
import { designFor } from "../lib/engine";
import { validateDesign } from "../lib/engine/validate";

/**
 * Document settings: hoop, design size (with aspect lock + fit-to-hoop), and
 * the live design-wide validation warnings. Resizing scales the geometry, so
 * the engine re-densifies automatically.
 */
export default function DesignPanel() {
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);

  const { objects, hoop } = project;
  const size = designSize(objects);
  const [lock, setLock] = useState(true);

  // All geometry is stored in mm; the panel just displays the active unit.
  const rulerUnit = useEditorStore((s) => s.rulerUnit);
  const isInch = rulerUnit === "inch";
  const unit = isInch ? "in" : "mm";
  const toDisp = (mm: number) => (isInch ? mmToInch(mm) : mm);
  const fromDisp = (v: number) => (isInch ? inchToMm(v) : v);
  const decimals = isInch ? 2 : 1;
  const step = isInch ? 0.1 : 1;
  const minDim = isInch ? 0.1 : 1;

  const warnings = useMemo(
    () => validateDesign(designFor(project), project),
    [project],
  );

  // Which preset (if any) the current hoop matches.
  const presetIndex = HOOP_PRESETS.findIndex(
    (h) => h.wMm === hoop.wMm && h.hMm === hoop.hMm,
  );

  function applyScale(sx: number, sy: number) {
    const b = designBounds(objects);
    if (!b) return;
    const pivot = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    updateProject({ objects: scaleAllPaths(objects, sx, sy, pivot) });
  }

  function onWidth(w: number) {
    if (size.w <= 0 || w <= 0) return;
    const f = w / size.w;
    applyScale(f, lock ? f : 1);
  }
  function onHeight(h: number) {
    if (size.h <= 0 || h <= 0) return;
    const f = h / size.h;
    applyScale(lock ? f : 1, f);
  }

  function onHoopPreset(value: string) {
    if (value === "custom") return;
    const h = HOOP_PRESETS[Number(value)];
    updateProject({ hoop: { ...h }, widthMm: h.wMm, heightMm: h.hMm });
  }
  function onHoopDim(patch: { wMm?: number; hMm?: number }) {
    const next = { ...hoop, ...patch, name: "Custom" };
    updateProject({ hoop: next, widthMm: next.wMm, heightMm: next.hMm });
  }

  const hasDesign = size.w > 0;

  return (
    <div className="flex flex-col gap-3 border-b border-navy/25 p-3 text-sm">
      <div className="font-label text-xs font-semibold uppercase tracking-[0.14em] text-ink-deep">
        Design
      </div>

      {/* Hoop */}
      <label className="flex flex-col gap-1">
        <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">Hoop</span>
        <select
          value={presetIndex === -1 ? "custom" : presetIndex}
          onChange={(e) => onHoopPreset(e.target.value)}
          className="input"
        >
          {HOOP_PRESETS.map((h, i) => (
            <option key={h.name} value={i}>
              {h.name}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>

      {presetIndex === -1 && (
        <div className="flex gap-2">
          <LabeledNumber
            label={`Hoop W (${unit})`}
            value={toDisp(hoop.wMm)}
            decimals={decimals}
            step={step}
            min={minDim}
            onCommit={(v) => onHoopDim({ wMm: fromDisp(v) })}
          />
          <LabeledNumber
            label={`Hoop H (${unit})`}
            value={toDisp(hoop.hMm)}
            decimals={decimals}
            step={step}
            min={minDim}
            onCommit={(v) => onHoopDim({ hMm: fromDisp(v) })}
          />
        </div>
      )}

      <FabricPicker />

      {/* Design size */}
      {hasDesign ? (
        <>
          <div className="flex items-end gap-2">
            <LabeledNumber
              label={`Width (${unit})`}
              value={toDisp(size.w)}
              decimals={decimals}
              step={step}
              min={minDim}
              onCommit={(v) => onWidth(fromDisp(v))}
            />
            <LabeledNumber
              label={`Height (${unit})`}
              value={toDisp(size.h)}
              decimals={decimals}
              step={step}
              min={minDim}
              onCommit={(v) => onHeight(fromDisp(v))}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-navy/70">
            <input
              type="checkbox"
              checked={lock}
              onChange={(e) => setLock(e.target.checked)}
            />
            Lock aspect ratio
          </label>
          <button
            onClick={() => updateProject({ objects: fitToHoop(objects, hoop) })}
            className="rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
          >
            Fit to hoop
          </button>
        </>
      ) : (
        <p className="text-xs text-navy/50">Add a design to set its size.</p>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <ul className="rounded bg-butter-200/60 p-1.5 text-[11px] text-navy/80">
          {warnings.map((w, i) => (
            <li key={i} className="flex gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-butter-600" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Choose the hoop's fabric background for the stitch-view mockup. */
const FABRIC_SWATCHES = [
  "#ECE8DE", // natural
  "#FFFFFF", // white
  "#C9C6BD", // gray
  "#3A4A63", // denim
  "#16234A", // navy
  "#2A2A2A", // black
  "#D9B89C", // tan
  "#E9C9D0", // blush
];

function FabricPicker() {
  const fabricColor = useEditorStore((s) => s.fabricColor);
  const setFabricColor = useEditorStore((s) => s.setFabricColor);
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">Fabric (hoop background)</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {FABRIC_SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => setFabricColor(c)}
            aria-label={`Fabric color ${c}`}
            className={`h-6 w-6 rounded-sm border-2 ${
              fabricColor.toUpperCase() === c
                ? "border-ink ring-2 ring-ink/40"
                : "border-ink/25"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(fabricColor) ? fabricColor : "#ECE8DE"}
          onChange={(e) => setFabricColor(e.target.value)}
          aria-label="Custom fabric color"
          title="Custom fabric color"
          className="h-6 w-6 cursor-pointer rounded-md border border-navy/20 bg-transparent p-0"
        />
      </div>
    </div>
  );
}

/**
 * Number input that shows the live value but only commits on Enter / blur, so
 * typing "40" doesn't rescale through "4" first.
 */
function LabeledNumber({
  label,
  value,
  onCommit,
  decimals = 1,
  step = 1,
  min = 1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  decimals?: number;
  step?: number;
  min?: number;
}) {
  const [text, setText] = useState(value.toFixed(decimals));
  const [editing, setEditing] = useState(false);
  // Reflect external changes (undo, fit, etc.) when not actively editing.
  useEffect(() => {
    if (!editing) setText(value.toFixed(decimals));
  }, [value, editing, decimals]);

  function commit() {
    setEditing(false);
    const v = parseFloat(text);
    if (!Number.isNaN(v) && v > 0) onCommit(v);
    else setText(value.toFixed(decimals));
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">{label}</span>
      <input
        type="number"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="input"
        step={step}
        min={min}
      />
    </label>
  );
}
