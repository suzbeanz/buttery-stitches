import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../store/projectStore";
import { HOOP_PRESETS } from "../lib/hoops";
import {
  designSize,
  designBounds,
  scaleAllPaths,
  fitToHoop,
} from "../lib/layout";
import { generateDesign } from "../lib/engine";
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

  const warnings = useMemo(
    () => validateDesign(generateDesign(project), project),
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
    <div className="flex flex-col gap-3 border-b border-navy/15 p-3 text-sm">
      <div className="font-butter text-sm font-semibold text-navy">Design</div>

      {/* Hoop */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-navy/60">Hoop</span>
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
            label="Hoop W"
            value={hoop.wMm}
            onCommit={(v) => onHoopDim({ wMm: v })}
          />
          <LabeledNumber
            label="Hoop H"
            value={hoop.hMm}
            onCommit={(v) => onHoopDim({ hMm: v })}
          />
        </div>
      )}

      {/* Design size */}
      {hasDesign ? (
        <>
          <div className="flex items-end gap-2">
            <LabeledNumber label="Width (mm)" value={size.w} onCommit={onWidth} />
            <LabeledNumber label="Height (mm)" value={size.h} onCommit={onHeight} />
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
            className="rounded bg-navy px-2 py-1 text-xs text-butter-200 hover:bg-navy-light"
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
            <li key={i} className="flex gap-1">
              <span aria-hidden>⚠️</span>
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
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
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(value.toFixed(1));
  const [editing, setEditing] = useState(false);
  // Reflect external changes (undo, fit, etc.) when not actively editing.
  useEffect(() => {
    if (!editing) setText(value.toFixed(1));
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const v = parseFloat(text);
    if (!Number.isNaN(v) && v > 0) onCommit(v);
    else setText(value.toFixed(1));
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs text-navy/60">{label}</span>
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
        step={1}
        min={1}
      />
    </label>
  );
}
