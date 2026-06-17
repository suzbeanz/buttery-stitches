import { useEffect, useMemo, useState } from "react";
import type { EmbObject, Hoop, ThreadColor } from "../types/project";
import type { Font } from "opentype.js";
import { FONTS, DEFAULT_FONT_ID, loadFont } from "../lib/text/fonts";
import { layoutText } from "../lib/text/layout";
import { translatePaths, pathsBounds } from "../lib/geometry";
import { useEscapeToClose, useDialogFocus } from "./useEscapeToClose";
import { mmToInch, inchToMm } from "../lib/units";
import { newId } from "../lib/id";

/**
 * Add-text dialog. Mirrors AutoDigitizeDialog's modal styling (butter / navy).
 * The user types text, picks a bundled font, a size (mm or inches — defaults to
 * inches, the app's display unit), letter spacing, and a color (an existing
 * project color or a new one). On add we generate ONE tatami fill object sized
 * to the chosen height, centered in the hoop, and hand it back to the caller.
 *
 * QUALITY NOTE: the result is a fill — the engine adds underlay + lock stitches.
 * For a crisper border the user can apply "Add satin outline" to the fill after.
 */

export interface AddTextResult {
  object: EmbObject;
  /** present when the user chose a brand-new color to add to the project. */
  newColor?: ThreadColor;
}

/** Default text height in mm (≈ 0.6"), a comfortable readable size. */
const DEFAULT_HEIGHT_MM = 15;

/** Quick height presets, in each unit. Inches mirror common lettering sizes. */
const SIZE_PRESETS: Record<"in" | "mm", number[]> = {
  in: [0.5, 1, 1.5, 2, 3],
  mm: [12, 25, 38, 50, 75],
};

export default function TextDialog({
  hoop,
  colors,
  editObject,
  onAdd,
  onClose,
}: {
  hoop: Hoop;
  colors: ThreadColor[];
  /** when set, the dialog edits this existing text object in place. */
  editObject?: EmbObject;
  onAdd: (result: AddTextResult) => void;
  onClose: () => void;
}) {
  const initial = editObject?.text;
  const [text, setText] = useState(initial?.content ?? "Hello");
  const [fontId, setFontId] = useState(initial?.fontId ?? DEFAULT_FONT_ID);
  const [unit, setUnit] = useState<"in" | "mm">("in"); // default to inches
  const [heightMm, setHeightMm] = useState(initial?.heightMm ?? DEFAULT_HEIGHT_MM);
  const [letterSpacingMm, setLetterSpacingMm] = useState(initial?.letterSpacingMm ?? 0);
  const [archDeg, setArchDeg] = useState(initial?.archDeg ?? 0);
  const lineSpacing = initial?.lineSpacing ?? 1.35;

  // Color: either an existing project color id, or "__new" to add one.
  const [colorChoice, setColorChoice] = useState<string>(
    editObject?.colorId ?? colors[0]?.id ?? "__new",
  );
  const [newColorHex, setNewColorHex] = useState("#1f3a5f");

  const [font, setFont] = useState<Font | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscapeToClose(onClose);
  const dialogRef = useDialogFocus<HTMLDivElement>();

  // Load (and cache) the chosen font.
  useEffect(() => {
    let alive = true;
    setFont(null);
    loadFont(fontId)
      .then((f) => alive && setFont(f))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [fontId]);

  // Build the geometry whenever the inputs change (drives preview + add).
  const layout = useMemo(() => {
    if (!font || text.trim().length === 0) return null;
    try {
      return layoutText({
        text,
        font,
        heightMm,
        letterSpacingMm,
        lineSpacing,
        archDeg,
        colorId: "preview",
        name: text.replace(/\n/g, " "),
        fontId,
      });
    } catch {
      return null;
    }
  }, [font, text, heightMm, letterSpacingMm, lineSpacing, archDeg, fontId]);

  // Size shown in the active unit; editing it converts back to mm.
  const sizeValue = unit === "in" ? mmToInch(heightMm) : heightMm;
  const sizeStep = unit === "in" ? 0.05 : 1;
  function setSize(v: number) {
    if (!Number.isFinite(v) || v <= 0) return;
    setHeightMm(unit === "in" ? inchToMm(v) : v);
  }

  // Presets for the active unit; highlight the one matching the current height.
  const presets = SIZE_PRESETS[unit];
  const presetMm = (p: number) => (unit === "in" ? inchToMm(p) : p);
  const isPresetActive = (p: number) => Math.abs(presetMm(p) - heightMm) < 0.05;

  function add() {
    if (!font || !layout || layout.object.paths.length === 0) {
      setError("Type some text first.");
      return;
    }

    // Resolve the color (existing or new) and re-stamp the object's colorId.
    let colorId = colorChoice;
    let newColor: ThreadColor | undefined;
    if (colorChoice === "__new") {
      newColor = { id: newId("color"), rgb: hexToRgb(newColorHex), name: "Text" };
      colorId = newColor.id;
    }

    // Place the centered-on-origin geometry: keep an edited object where it sits,
    // otherwise center a new one in the hoop.
    const centered = layout.object.paths;
    const editBounds = editObject ? pathsBounds(editObject.paths) : null;
    const target = editBounds
      ? { x: (editBounds.minX + editBounds.maxX) / 2, y: (editBounds.minY + editBounds.maxY) / 2 }
      : { x: hoop.wMm / 2, y: hoop.hMm / 2 };
    const move = pathsBounds(centered);
    const paths = move ? translatePaths(centered, target.x, target.y) : centered;
    // Authored satin centerlines live in the same centered space — move them with
    // the geometry so they stay glued to their glyphs.
    const satinCenterlines =
      layout.object.satinCenterlines && move
        ? translatePaths(layout.object.satinCenterlines, target.x, target.y)
        : layout.object.satinCenterlines;

    const object: EmbObject = {
      ...layout.object,
      id: editObject?.id ?? newId("obj"),
      colorId,
      paths,
      satinCenterlines,
      params: editObject ? editObject.params : layout.object.params,
      text: { content: text, fontId, heightMm, letterSpacingMm, lineSpacing, archDeg },
    };
    onAdd({ object, newColor });
    onClose();
  }

  return (
    // Click-outside closes; keyboard users dismiss with Escape (useEscapeToClose).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="anim-scrim-in fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={editObject ? "Edit text" : "Add text"}
        className="anim-press-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-4 shadow-press outline-none"
      >
        <h2 className="mb-3 font-label uppercase tracking-[0.08em] text-lg font-semibold text-ink-deep">
          {editObject ? "Edit text" : "Add text"}
        </h2>

        <label className="mb-3 block text-sm text-navy">
          <div className="mb-1">Text <span className="text-navy/50">(Enter for a new line)</span></div>
          <textarea
            value={text}
            autoFocus
            rows={2}
            onChange={(e) => setText(e.target.value)}
            className="input resize-y"
          />
        </label>

        <label className="mb-3 block text-sm text-navy">
          <div className="mb-1">Font</div>
          <select
            value={fontId}
            onChange={(e) => setFontId(e.target.value)}
            className="input"
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-3 flex gap-3">
          <label className="flex-1 text-sm text-navy">
            <div className="mb-1 flex items-center justify-between">
              <span>Height</span>
              <div className="flex overflow-hidden rounded-sm border-2 border-ink text-[11px]">
                {(["in", "mm"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    className={
                      "px-1.5 py-0.5 font-label font-semibold uppercase " +
                      (unit === u
                        ? "bg-ink text-cream"
                        : "bg-cream text-ink hover:bg-butter-200")
                    }
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="number"
              aria-label="Text height"
              min={0}
              step={sizeStep}
              value={Number(sizeValue.toFixed(unit === "in" ? 2 : 1))}
              onChange={(e) => setSize(Number(e.target.value))}
              className="input"
            />
          </label>

          <label className="flex-1 text-sm text-navy">
            <div className="mb-1">Letter spacing (mm)</div>
            <input
              type="number"
              step={0.2}
              value={letterSpacingMm}
              onChange={(e) => setLetterSpacingMm(Number(e.target.value) || 0)}
              className="input"
            />
          </label>
        </div>

        <label className="mb-3 block text-sm text-navy">
          <div className="mb-1 flex justify-between">
            <span>Arch {archDeg > 0 ? "(up ∩)" : archDeg < 0 ? "(down ∪)" : "(straight)"}</span>
            <span className="tabular-nums text-navy/60">{archDeg}°</span>
          </div>
          <input
            type="range"
            min={-180}
            max={180}
            step={5}
            value={archDeg}
            onChange={(e) => setArchDeg(Number(e.target.value))}
            className="w-full cursor-pointer accent-ink"
            aria-label="Arch curve"
          />
          {archDeg !== 0 && (
            <button
              type="button"
              onClick={() => setArchDeg(0)}
              className="mt-1 font-label text-[11px] uppercase tracking-wide text-ink/60 hover:text-ink"
            >
              Reset to straight
            </button>
          )}
        </label>

        <div className="mb-3 text-sm text-navy">
          <div className="mb-1">Quick sizes ({unit})</div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSize(p)}
                aria-label={`Set height to ${p} ${unit}`}
                className={
                  "rounded-sm border-2 px-2.5 py-1 text-[12px] " +
                  (isPresetActive(p)
                    ? "border-ink bg-ink text-cream"
                    : "border-ink/30 bg-cream text-ink hover:bg-butter-200")
                }
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <label className="mb-3 block text-sm text-navy">
          <div className="mb-1">Color</div>
          <div className="flex items-center gap-2">
            <select
              value={colorChoice}
              onChange={(e) => setColorChoice(e.target.value)}
              className="input min-w-0 flex-1"
            >
              {colors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? `rgb(${c.rgb.join(",")})`}
                </option>
              ))}
              <option value="__new">New color…</option>
            </select>
            {colorChoice === "__new" && (
              <input
                type="color"
                value={newColorHex}
                onChange={(e) => setNewColorHex(e.target.value)}
                className="h-9 w-10 cursor-pointer rounded-sm border-2 border-ink"
              />
            )}
          </div>
        </label>

        <TextPreview
          layout={layout}
          colorHex={previewHex(colorChoice, colors, newColorHex)}
          loading={font === null && !error}
        />

        {error && <p className="mt-2 text-[12px] text-stamp">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-sm border-2 border-ink px-4 py-2 font-label text-xs font-semibold uppercase tracking-wide text-ink hover:bg-butter-200"
          >
            Cancel
          </button>
          <button
            onClick={add}
            disabled={!font || !layout || layout.object.paths.length === 0}
            className="rounded-sm border-2 border-ink bg-ink px-4 py-2 font-label text-xs font-semibold uppercase tracking-wide text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none disabled:opacity-50"
          >
            {editObject ? "Update text" : "Add text"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A small SVG preview of the generated rings (even-odd so counters show). */
function TextPreview({
  layout,
  colorHex,
  loading,
}: {
  layout: ReturnType<typeof layoutText> | null;
  colorHex: string;
  loading?: boolean;
}) {
  const box = useMemo(() => {
    if (!layout || layout.object.paths.length === 0) return null;
    const b = pathsBounds(layout.object.paths);
    if (!b) return null;
    const pad = 2;
    return {
      minX: b.minX - pad,
      minY: b.minY - pad,
      w: b.maxX - b.minX + pad * 2,
      h: b.maxY - b.minY + pad * 2,
    };
  }, [layout]);

  return (
    <div className="flex h-24 items-center justify-center rounded border border-navy/10 bg-white">
      {layout && box ? (
        <svg
          viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
          className="max-h-full max-w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Render with the font's own winding (nonzero), exactly like a
              browser — so the preview works for every font. */}
          <path
            d={ringsToSvgPath(layout.object.paths)}
            fill={colorHex}
            fillRule="nonzero"
          />
        </svg>
      ) : loading ? (
        <span className="font-mono text-[12px] text-ink/55">Loading font…</span>
      ) : (
        <span className="text-[12px] text-navy/40">Preview</span>
      )}
    </div>
  );
}

function ringsToSvgPath(rings: { x: number; y: number }[][]): string {
  return rings
    .map(
      (r) =>
        "M" +
        r.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("L") +
        "Z",
    )
    .join(" ");
}

function previewHex(
  choice: string,
  colors: ThreadColor[],
  newHex: string,
): string {
  if (choice === "__new") return newHex;
  const c = colors.find((x) => x.id === choice);
  return c ? rgbToHex(c.rgb) : "#1f3a5f";
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
