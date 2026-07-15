import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EmbObject, GlyphTweak, Hoop, ThreadColor, Point } from "../types/project";
import type { Font } from "opentype.js";
import { FONTS, DEFAULT_FONT_ID, loadFont, invalidateFontCache } from "../lib/text/fonts";
import {
  listCustomFonts,
  parseImportedFont,
  removeCustomFont,
  saveCustomFont,
  type CustomFontMeta,
} from "../lib/text/customFonts";
import { layoutText } from "../lib/text/layout";
import { translatePaths, pathsBounds } from "../lib/geometry";
import { ringsToSvgPath } from "../lib/svgPath";
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
// Exactly half an inch: the dialog defaults to inches, and 15mm read as an
// arbitrary "0.59" there. 12.7mm also matches the first quick-size chip (0.5).
const DEFAULT_HEIGHT_MM = 12.7;

/** Quick height presets, in each unit. Inches mirror common lettering sizes. */
const SIZE_PRESETS: Record<"in" | "mm", number[]> = {
  in: [0.5, 1, 1.5, 2, 3],
  mm: [12, 25, 38, 50, 75],
};

export default function TextDialog({
  hoop,
  colors,
  editObject,
  followPath,
  onAdd,
  onClose,
}: {
  hoop: Hoop;
  colors: ThreadColor[];
  /** when set, the dialog edits this existing text object in place. */
  editObject?: EmbObject;
  /** an open path (mm) the text can follow, from the current selection. */
  followPath?: Point[];
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
  // Baseline shape: straight/arch, on a circle (top/bottom), or following a path.
  const initialShape: "line" | "circleTop" | "circleBottom" | "path" = initial?.pathMm
    ? "path"
    : initial?.circleRadiusMm
      ? initial.circleSide === "bottom"
        ? "circleBottom"
        : "circleTop"
      : "line";
  const [shape, setShape] = useState(initialShape);
  const [circleRadiusMm, setCircleRadiusMm] = useState(initial?.circleRadiusMm ?? 40);
  const lineSpacing = initial?.lineSpacing ?? 1.35;
  // The path to follow: a freshly-selected path wins; otherwise the stored one.
  const pathMm = followPath ?? initial?.pathMm;
  const onPath = shape === "path" && !!pathMm && pathMm.length >= 2;
  const onCircle = shape === "circleTop" || shape === "circleBottom";
  const circleSide: "top" | "bottom" = shape === "circleBottom" ? "bottom" : "top";

  // PER-GLYPH TWEAKS: nudge/rotate/scale for single letters, keyed by VISIBLE
  // glyph index (whitespace excluded — the layout's counting rule). Restored
  // from the stored TextSpec when re-editing, so tweaks survive round trips.
  const [glyphTweaks, setGlyphTweaks] = useState<Record<number, GlyphTweak>>(
    initial?.glyphTweaks ?? {},
  );
  const [selGlyph, setSelGlyph] = useState<number | null>(null);

  // Color: either an existing project color id, or "__new" to add one.
  const [colorChoice, setColorChoice] = useState<string>(
    editObject?.colorId ?? colors[0]?.id ?? "__new",
  );
  const [newColorHex, setNewColorHex] = useState("#1f3a5f");

  const [font, setFont] = useState<Font | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscapeToClose(onClose);
  const dialogRef = useDialogFocus<HTMLDivElement>();

  // User-imported fonts (IndexedDB): list for the picker, plus import/remove.
  const [customFonts, setCustomFonts] = useState<CustomFontMeta[]>([]);
  const [fontNote, setFontNote] = useState<string | null>(null);
  const fontFileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void listCustomFonts().then(setCustomFonts);
  }, []);
  const importFont = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const { meta } = parseImportedFont(buf, file.name);
      await saveCustomFont(meta, buf);
      invalidateFontCache(meta.id);
      setCustomFonts(await listCustomFonts());
      setFontId(meta.id);
      setFontNote(meta.note || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't import that font.");
    }
  };
  const removeFont = async (id: string) => {
    await removeCustomFont(id);
    invalidateFontCache(id);
    setCustomFonts(await listCustomFonts());
    setFontNote(null);
    if (fontId === id) setFontId(DEFAULT_FONT_ID);
  };

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
        archDeg: onCircle || onPath ? 0 : archDeg,
        circleRadiusMm: onCircle ? circleRadiusMm : undefined,
        circleSide,
        pathMm: onPath ? pathMm : undefined,
        colorId: "preview",
        name: text.replace(/\n/g, " "),
        fontId,
        glyphTweaks,
      });
    } catch {
      return null;
    }
  }, [font, text, heightMm, letterSpacingMm, lineSpacing, archDeg, fontId, onCircle, circleRadiusMm, circleSide, onPath, pathMm, glyphTweaks]);

  // Tweaks are INDEX-based ("per letter position"): when the content changes,
  // drop tweaks whose index is past the new visible-glyph count, and clamp the
  // selection. Tweaks on surviving indices stay (they may land on a different
  // letter after an edit — accepted v1 behavior, noted in the hint line).
  const glyphCount = layout?.glyphs?.length;
  useEffect(() => {
    if (glyphCount == null) return;
    setGlyphTweaks((prev) => {
      const stale = Object.keys(prev).filter((k) => Number(k) >= glyphCount);
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const k of stale) delete next[Number(k)];
      return next;
    });
    setSelGlyph((s) => (s !== null && s >= glyphCount ? null : s));
  }, [glyphCount]);

  /** Merge a tweak change for glyph `i`; an all-identity tweak is removed. */
  const round2 = (v: number) => Math.round(v * 100) / 100;
  function updateTweak(i: number, patch: (t: GlyphTweak) => GlyphTweak) {
    setGlyphTweaks((prev) => {
      const t = patch(prev[i] ?? {});
      const identity = !t.dx && !t.dy && !t.rotDeg && (t.scale ?? 1) === 1;
      const next = { ...prev };
      if (identity) delete next[i];
      else next[i] = t;
      return next;
    });
  }
  const nudge = (i: number, axis: "dx" | "dy", dir: 1 | -1, big: boolean) =>
    updateTweak(i, (t) => ({ ...t, [axis]: round2((t[axis] ?? 0) + dir * (big ? 1 : 0.25)) }));
  const rotate = (i: number, dir: 1 | -1) =>
    updateTweak(i, (t) => ({ ...t, rotDeg: round2((t.rotDeg ?? 0) + dir * 2) }));
  const resize = (i: number, dir: 1 | -1) =>
    updateTweak(i, (t) => ({
      ...t,
      scale: round2(Math.min(10, Math.max(0.1, (t.scale ?? 1) + dir * 0.05))),
    }));
  const resetTweak = (i: number) =>
    setGlyphTweaks((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });

  // Keyboard on the (focusable) preview: [ / ] pick a letter, arrows nudge the
  // selected one (0.25 mm; Shift = 1 mm).
  function onPreviewKeyDown(e: React.KeyboardEvent) {
    const n = glyphCount ?? 0;
    if (n === 0) return;
    if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      const d = e.key === "]" ? 1 : -1;
      setSelGlyph((s) => (s === null ? (d === 1 ? 0 : n - 1) : (s + d + n) % n));
      return;
    }
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    if (selGlyph === null) {
      setSelGlyph(0);
      return;
    }
    const big = e.shiftKey;
    if (e.key === "ArrowLeft") nudge(selGlyph, "dx", -1, big);
    else if (e.key === "ArrowRight") nudge(selGlyph, "dx", 1, big);
    else if (e.key === "ArrowUp") nudge(selGlyph, "dy", -1, big);
    else if (e.key === "ArrowDown") nudge(selGlyph, "dy", 1, big);
  }

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
      text: {
        content: text,
        fontId,
        heightMm,
        letterSpacingMm,
        lineSpacing,
        archDeg: onCircle || onPath ? 0 : archDeg,
        circleRadiusMm: onCircle ? circleRadiusMm : undefined,
        circleSide: onCircle ? circleSide : undefined,
        pathMm: onPath ? pathMm : undefined,
        glyphTweaks: Object.keys(glyphTweaks).length > 0 ? glyphTweaks : undefined,
      },
    };
    onAdd({ object, newColor });
    onClose();
  }

  return createPortal(
    // Portaled to <body> — mounted in the top bar, where an ancestor scroll
    // container would clip this fixed overlay on iOS Safari.
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
        className="anim-press-in max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-4 shadow-press outline-none"
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

        <label className="mb-1 block text-sm text-navy">
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
            {customFonts.length > 0 && (
              <optgroup label="Your fonts">
                {customFonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fontFileInput.current?.click()}
            className="rounded-sm border border-ink/40 px-1.5 py-0.5 font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/80 hover:bg-butter-200"
          >
            Import font (TTF / OTF)…
          </button>
          {customFonts.some((f) => f.id === fontId) && (
            <button
              type="button"
              onClick={() => void removeFont(fontId)}
              className="rounded-sm border border-ink/40 px-1.5 py-0.5 font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-stamp hover:bg-butter-200"
            >
              Remove
            </button>
          )}
          <span className="font-body text-[10px] leading-tight text-navy/50">
            Bold, even-stroke faces embroider best.
          </span>
          <input
            ref={fontFileInput}
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            className="hidden"
            aria-label="Import a font file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFont(f);
              e.target.value = "";
            }}
          />
        </div>
        {fontNote && (
          <p className="mb-2 font-body text-[11px] leading-snug text-stamp">{fontNote}</p>
        )}

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
          <div className="mb-1">Shape</div>
          <select
            value={shape}
            onChange={(e) => setShape(e.target.value as typeof shape)}
            className="input"
          >
            <option value="line">Straight / Arch</option>
            <option value="circleTop">Circle — top arc</option>
            <option value="circleBottom">Circle — bottom arc (upright)</option>
            {(pathMm?.length ?? 0) >= 2 && <option value="path">Follow selected path</option>}
          </select>
          {shape === "path" && !onPath && (
            <p className="mt-1 text-[11px] text-stamp">Select an open line first, then reopen text.</p>
          )}
        </label>

        {onCircle ? (
          <label className="mb-3 block text-sm text-navy">
            <div className="mb-1 flex justify-between">
              <span>Circle radius</span>
              <span className="tabular-nums text-navy/60">{circleRadiusMm} mm</span>
            </div>
            <input
              type="range"
              min={10}
              max={120}
              step={1}
              value={circleRadiusMm}
              onChange={(e) => setCircleRadiusMm(Number(e.target.value))}
              className="w-full cursor-pointer accent-ink"
              aria-label="Circle radius"
            />
            <p className="mt-1 text-[11px] text-navy/55">
              Top and bottom text at the same radius form a badge, centered together.
            </p>
          </label>
        ) : (
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
        )}

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
          selected={selGlyph}
          onSelectGlyph={setSelGlyph}
          onKeyDown={onPreviewKeyDown}
        />

        {selGlyph !== null && (glyphCount ?? 0) > selGlyph ? (
          <div className="mt-2 rounded-sm border border-ink/30 bg-cream p-2">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-ink">
                Letter {selGlyph + 1}
              </span>
              <TweakButton label="Nudge letter left (Shift for 1 mm)" onClick={(e) => nudge(selGlyph, "dx", -1, e.shiftKey)}>←</TweakButton>
              <TweakButton label="Nudge letter right (Shift for 1 mm)" onClick={(e) => nudge(selGlyph, "dx", 1, e.shiftKey)}>→</TweakButton>
              <TweakButton label="Nudge letter up (Shift for 1 mm)" onClick={(e) => nudge(selGlyph, "dy", -1, e.shiftKey)}>↑</TweakButton>
              <TweakButton label="Nudge letter down (Shift for 1 mm)" onClick={(e) => nudge(selGlyph, "dy", 1, e.shiftKey)}>↓</TweakButton>
              <span aria-hidden className="mx-0.5 h-4 w-px bg-ink/20" />
              <TweakButton label="Rotate letter counterclockwise 2 degrees" onClick={() => rotate(selGlyph, -1)}>−2°</TweakButton>
              <TweakButton label="Rotate letter clockwise 2 degrees" onClick={() => rotate(selGlyph, 1)}>+2°</TweakButton>
              <span aria-hidden className="mx-0.5 h-4 w-px bg-ink/20" />
              <TweakButton label="Shrink letter 5 percent" onClick={() => resize(selGlyph, -1)}>A−</TweakButton>
              <TweakButton label="Enlarge letter 5 percent" onClick={() => resize(selGlyph, 1)}>A+</TweakButton>
              <span aria-hidden className="mx-0.5 h-4 w-px bg-ink/20" />
              <TweakButton label="Reset this letter's tweaks" onClick={() => resetTweak(selGlyph)}>Reset</TweakButton>
            </div>
            <p className="mt-1 font-body text-[10px] leading-snug text-ink/80">
              Tweaks apply per letter position. Arrow keys nudge 0.25 mm (Shift = 1 mm); [ and ] change letter.
            </p>
          </div>
        ) : (glyphCount ?? 0) > 0 ? (
          <p className="mt-1 font-body text-[10px] text-ink/80">
            Click a letter in the preview to nudge, rotate, or resize just that letter.
          </p>
        ) : null}

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
    </div>,
    document.body,
  );
}

/** A calm strip button (nudge / rotate / resize / reset a single letter). */
function TweakButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="min-w-7 rounded-sm border border-ink/40 px-1.5 py-0.5 font-label text-[11px] font-semibold text-ink hover:bg-butter-200"
    >
      {children}
    </button>
  );
}

/** A small SVG preview of the generated rings (even-odd so counters show).
 *  Each VISIBLE glyph is its own clickable path (the layout reports which rings
 *  belong to which letter), and the whole preview is focusable so a keyboard
 *  user can pick ([ / ]) and nudge (arrows) letters without a mouse. */
function TextPreview({
  layout,
  colorHex,
  loading,
  selected,
  onSelectGlyph,
  onKeyDown,
}: {
  layout: ReturnType<typeof layoutText> | null;
  colorHex: string;
  loading?: boolean;
  selected: number | null;
  onSelectGlyph: (i: number | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
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

  const glyphs = layout?.glyphs ?? [];
  // Dashed marker box around the selected letter.
  const selBox = useMemo(() => {
    if (!layout || selected === null) return null;
    const g = layout.glyphs?.[selected];
    if (!g) return null;
    const b = pathsBounds(layout.object.paths.slice(g.ringStart, g.ringStart + g.ringCount));
    if (!b) return null;
    const pad = 0.6;
    return { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
  }, [layout, selected]);

  return (
    // A focusable "canvas" region operated by the keyboard ([ ] to pick a
    // letter, arrows to nudge) — announced via its aria-label. jsx-a11y has no
    // interactive role for this widget shape, so the two rules are silenced.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
    <div role="application" tabIndex={0} onKeyDown={onKeyDown}
      aria-label="Letter preview. Click a letter to select it, or press [ and ] to change the selected letter; arrow keys nudge it (hold Shift for bigger steps)."
      className="flex h-24 items-center justify-center rounded border border-navy/10 bg-white outline-none focus-visible:ring-2 focus-visible:ring-ink/60"
    >
      {layout && box ? (
        <svg
          viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
          className="max-h-full max-w-full"
          preserveAspectRatio="xMidYMid meet"
          onClick={() => onSelectGlyph(null)}
        >
          {/* Render with the font's own winding (nonzero), exactly like a
              browser — so the preview works for every font. One path per
              letter so single glyphs are clickable; a transparent stroke
              widens the hit area for thin strokes. */}
          {glyphs.length > 0 ? (
            glyphs.map((g, i) => (
              <path
                key={i}
                d={ringsToSvgPath(layout.object.paths.slice(g.ringStart, g.ringStart + g.ringCount))}
                fill={colorHex}
                fillRule="nonzero"
                stroke="transparent"
                strokeWidth={1.5}
                className="cursor-pointer"
                aria-label={`Letter ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectGlyph(selected === i ? null : i);
                }}
              />
            ))
          ) : (
            <path d={ringsToSvgPath(layout.object.paths)} fill={colorHex} fillRule="nonzero" />
          )}
          {selBox && (
            <rect
              x={selBox.x}
              y={selBox.y}
              width={selBox.w}
              height={selBox.h}
              fill="none"
              stroke="#20242c"
              strokeWidth={0.35}
              strokeDasharray="1.2 0.8"
              pointerEvents="none"
            />
          )}
        </svg>
      ) : loading ? (
        <span className="font-mono text-[12px] text-ink/55">Loading font…</span>
      ) : (
        <span className="text-[12px] text-navy/40">Preview</span>
      )}
    </div>
  );
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
