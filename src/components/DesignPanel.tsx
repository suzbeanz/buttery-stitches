import { useEffect, useMemo, useRef, useState } from "react";
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
import { THREAD_CHARTS, type ThreadChart } from "../lib/thread/catalog";
import { matchColorsToChart } from "../lib/thread/match";
import { reduceProjectColors } from "../lib/thread/reduce";
import {
  loadCustomCharts,
  parseChartFile,
  removeCustomChart,
  saveCustomChart,
} from "../lib/thread/customCharts";
import { toast } from "../store/toastStore";
import {
  FABRICS,
  DEFAULT_FABRIC,
  DEFAULT_THREAD_WEIGHT,
  type FabricType,
  type ThreadWeight,
} from "../types/project";

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

  // Jump to the object a warning points at: select it and drop into edit view.
  const selectOffender = (id: string) => {
    useProjectStore.getState().setSelection([id]);
    useEditorStore.getState().setViewMode("edit");
  };

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
      <div className="font-label text-xs font-semibold uppercase tracking-[0.1em] text-ink-deep">
        Design
      </div>

      {/* Hoop */}
      <label className="flex flex-col gap-1">
        <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">Hoop</span>
        <div className="flex items-center gap-1.5">
          <select
            value={presetIndex === -1 ? "custom" : presetIndex}
            onChange={(e) => onHoopPreset(e.target.value)}
            className="select flex-1"
          >
            {HOOP_PRESETS.map((h, i) => (
              <option key={h.name} value={i}>
                {h.name}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {/* Rotate: mount the same hoop sideways (a 5×7 becomes a 7×5). */}
          <button
            type="button"
            disabled={hoop.wMm === hoop.hMm}
            data-tip="Rotate hoop 90° (swap width and height)"
            aria-label="Rotate hoop 90 degrees — swap width and height"
            onClick={() =>
              updateProject({
                hoop: {
                  wMm: hoop.hMm,
                  hMm: hoop.wMm,
                  name: hoop.name.endsWith(" (rotated)")
                    ? hoop.name.slice(0, -" (rotated)".length)
                    : `${hoop.name} (rotated)`,
                },
                widthMm: hoop.hMm,
                heightMm: hoop.wMm,
              })
            }
            className="tap-target grid h-9 w-9 shrink-0 place-items-center rounded-sm border-2 border-ink/50 text-ink hover:bg-butter-200 disabled:opacity-30"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <rect x="1.5" y="4.5" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 1.5l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
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

      <FabricTypePicker />

      <ThreadWeightPicker />

      <FabricPicker />

      <ThreadsSection />

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
              className="accent-ink"
            />
            Lock aspect ratio
          </label>
          <button
            onClick={() => updateProject({ objects: fitToHoop(objects, hoop) })}
            className="rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-[0.1em] text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
          >
            Fit to hoop
          </button>
        </>
      ) : (
        <p className="text-xs text-navy/70">Add a design to set its size.</p>
      )}

      {/* Warnings — clickable when we can point at the object at fault, so the user
          jumps straight to fixing it instead of hunting for "Fill 3". */}
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-sm border border-stamp/30 bg-stamp/5 p-2 text-[11px] text-char/80">
          {warnings.map((w, i) => {
            const content = (
              <>
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-stamp" />
                <span>{w.message}</span>
              </>
            );
            return w.objectId ? (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => selectOffender(w.objectId!)}
                  className="flex w-full gap-1.5 rounded-sm text-left hover:bg-stamp/10"
                  title="Select this object to fix it"
                >
                  {content}
                </button>
              </li>
            ) : (
              <li key={i} className="flex gap-1.5">
                {content}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Thread/color management: list the design's threads, snap them to a real thread
 * chart (name + code to order by), and reduce the palette to fewer colors.
 */
function ThreadsSection() {
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const colors = project.colors;
  const [chartId, setChartId] = useState(THREAD_CHARTS[0].id);
  const [reduceN, setReduceN] = useState(Math.max(1, colors.length));
  // Built-in charts + the user's imported ones (CSV/JSON of the chart they own).
  const [customCharts, setCustomCharts] = useState<ThreadChart[]>(() => loadCustomCharts());
  const chartInput = useRef<HTMLInputElement>(null);
  const allCharts = [...THREAD_CHARTS, ...customCharts];

  if (colors.length === 0) return null;

  const matchAll = () => {
    const chart = allCharts.find((c) => c.id === chartId);
    if (chart) updateProject({ colors: matchColorsToChart(colors, chart) });
  };

  const importChart = async (file: File) => {
    try {
      const nameFromFile = file.name.replace(/\.(csv|tsv|txt|json)$/i, "");
      const chart = parseChartFile(await file.text(), nameFromFile);
      setCustomCharts(saveCustomChart(chart));
      setChartId(chart.id);
      toast(`Imported "${chart.name}" — ${chart.threads.length} threads`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't read that chart file.", "error");
    }
  };

  const selectedCustom = customCharts.find((c) => c.id === chartId);
  const applyReduce = () => {
    const r = reduceProjectColors(project, Math.max(1, Math.min(reduceN, colors.length)));
    updateProject({ colors: r.colors, objects: r.objects });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-navy/15 pt-3">
      <div className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">
        Threads ({colors.length})
      </div>
      <ul className="flex flex-col gap-1">
        {colors.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-[12px] text-navy">
            <span
              className="h-4 w-4 shrink-0 rounded-sm border border-ink/30"
              style={{ background: `rgb(${c.rgb.join(",")})` }}
            />
            <span className="truncate">
              {c.name ?? `rgb(${c.rgb.join(",")})`}
              {c.code && <span className="text-navy/45"> · {c.code}</span>}
            </span>
          </li>
        ))}
      </ul>

      <label className="flex flex-col gap-1 text-[12px] text-navy">
        <span className="sr-only">Thread chart</span>
        <select value={chartId} onChange={(e) => setChartId(e.target.value)} className="select">
          {THREAD_CHARTS.map((ch) => (
            <option key={ch.id} value={ch.id}>{ch.name}</option>
          ))}
          {customCharts.length > 0 && (
            <optgroup label="Your charts">
              {customCharts.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name} ({ch.threads.length})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <button
        onClick={matchAll}
        className="rounded-sm border-2 border-ink bg-cream px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-wide text-ink shadow-press-sm transition-transform hover:bg-ink hover:text-cream active:translate-y-[2px] active:shadow-none"
      >
        Match to thread chart
      </button>
      <div className="flex items-center gap-2">
        <button
          onClick={() => chartInput.current?.click()}
          className="flex-1 rounded-sm border-2 border-ink/50 px-3 py-1 font-label text-[11px] font-semibold uppercase tracking-wide text-ink/80 hover:bg-butter-200"
        >
          Import chart (CSV / JSON)…
        </button>
        {selectedCustom && (
          <button
            onClick={() => {
              setCustomCharts(removeCustomChart(selectedCustom.id));
              setChartId(THREAD_CHARTS[0].id);
              toast(`Removed "${selectedCustom.name}"`, "info");
            }}
            className="rounded-sm border-2 border-ink/50 px-2 py-1 font-label text-[11px] font-semibold uppercase tracking-wide text-stamp hover:bg-butter-200"
          >
            Remove
          </button>
        )}
      </div>
      <p className="font-body text-[10px] leading-snug text-navy/50">
        Have your brand&apos;s chart (Madeira, Isacord…)? Import it as{" "}
        <span className="font-mono">code, name, #hex</span> lines and matching uses real
        order codes.
      </p>
      <input
        ref={chartInput}
        type="file"
        accept=".csv,.tsv,.txt,.json"
        className="hidden"
        aria-label="Import a thread chart file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importChart(f);
          e.target.value = "";
        }}
      />

      <div className="flex items-end gap-2">
        <label className="flex-1 text-[12px] text-navy">
          <div className="mb-1">Reduce to colors</div>
          <input
            type="number"
            min={1}
            max={colors.length}
            value={reduceN}
            onChange={(e) => setReduceN(Number(e.target.value) || 1)}
            className="input no-spin"
          />
        </label>
        <button
          onClick={applyReduce}
          disabled={reduceN >= colors.length}
          className="rounded-sm border-2 border-ink px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-wide text-ink hover:bg-butter-200 disabled:opacity-40"
        >
          Reduce
        </button>
      </div>
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

/**
 * The fabric the design will be stitched onto. The choice bends the engine's
 * density, pull compensation, and underlay weight (docs/stitch-logic.md §8) so
 * the same artwork sews cleanly on a stable woven or a stretchy knit.
 */
function FabricTypePicker() {
  const fabric = useProjectStore((s) => s.project.fabric ?? DEFAULT_FABRIC);
  const updateProject = useProjectStore((s) => s.updateProject);
  return (
    <label className="flex flex-col gap-1">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">Fabric type</span>
      <select
        value={fabric}
        onChange={(e) => updateProject({ fabric: e.target.value as FabricType })}
        className="select"
      >
        {(Object.keys(FABRICS) as FabricType[]).map((id) => (
          <option key={id} value={id}>
            {FABRICS[id].name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Thread weight (wt). Finer thread (higher number) packs rows denser to keep
 *  coverage; bolder thread opens them up. 40wt is the standard. */
const THREAD_WEIGHTS: { value: ThreadWeight; label: string }[] = [
  { value: 30, label: "30 wt (bold)" },
  { value: 40, label: "40 wt (standard)" },
  { value: 60, label: "60 wt (fine detail)" },
];

function ThreadWeightPicker() {
  const weight = useProjectStore((s) => s.project.threadWeight ?? DEFAULT_THREAD_WEIGHT);
  const updateProject = useProjectStore((s) => s.updateProject);
  return (
    <label className="flex flex-col gap-1">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">Thread weight</span>
      <select
        value={weight}
        onChange={(e) => updateProject({ threadWeight: Number(e.target.value) as ThreadWeight })}
        className="select"
      >
        {THREAD_WEIGHTS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}

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
