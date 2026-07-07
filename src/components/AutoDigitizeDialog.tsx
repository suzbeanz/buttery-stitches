import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Eye, EyeOff, Minus, Plus } from "lucide-react";
import type { EmbObject, Hoop, Project, ThreadColor } from "../types/project";
import { loadImageData } from "../lib/image";
import { imageDataToObjects, estimateColorComplexity, suggestColorCount, type DigitizeDetail } from "../lib/trace";
import { ocrWords } from "../lib/trace/ocr";
import { recognizeTextObjects, applyTextRecognition } from "../lib/trace/textRecognize";
import {
  detectTextClusters,
  placeManualText,
  placeGuidedText,
  applyManualText,
  type DetectedTextCluster,
} from "../lib/trace/manualText";
import { loadFont, DEFAULT_FONT_ID } from "../lib/text/fonts";
import type { Font } from "opentype.js";
import { parseSvgShapes } from "../lib/trace/svgParse";
import { svgShapesToObjects } from "../lib/trace/svgImport";
import { fixStitches } from "../lib/fix";
import { mergeSimilarColors, consolidateFringeColors } from "../lib/thread/reduce";
import { matchColorsToChart } from "../lib/thread/match";
import { THREAD_CHARTS } from "../lib/thread/catalog";
import { pathsBounds } from "../lib/geometry";
import { generateDesign } from "../lib/engine";
import { designToSegments } from "../lib/engine/render";
import { drawStitches } from "../lib/render-stitches";
import { createEmptyProject } from "../lib/project";
import { useEscapeToClose, useDialogFocus } from "./useEscapeToClose";
import { logError } from "../lib/log";

/**
 * Auto-digitize dialog: one live screen — the source image beside a preview that
 * RE-RENDERS as you change the colors or options, plus a color list you curate
 * before adding. Best for clean logos and line art; photos are warned about and
 * digitize roughly (an explicit v1 non-goal).
 */

/** Above this estimated color count, the image is probably a photo. */
const PHOTO_COMPLEXITY = 160;
/** How long to wait after a settings change before re-tracing (ms). */
const RETRACE_DEBOUNCE_MS = 250;
const MIN_COLORS = 2;
const MAX_COLORS = 12;

/** Per-color stitch style the user can force in the dialog. */
type StitchStyle = "auto" | "satin" | "outline";

/** Apply a per-color style override to an object (no-op for "auto"). Satin/running
 *  survive the apply-time fixStitches pass, so the choice sticks. */
function styleObject(o: EmbObject, style: StitchStyle): EmbObject {
  if (style === "satin") return { ...o, type: "fill", params: { ...o.params, fillStyle: "satin" } };
  if (style === "outline") return { ...o, type: "running" };
  return o;
}

const rgbToHex = (rgb: [number, number, number]) =>
  "#" + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

export default function AutoDigitizeDialog({
  file,
  hoop,
  hasExistingWork = false,
  onApply,
  onClose,
}: {
  file: File;
  hoop: Hoop;
  hasExistingWork?: boolean;
  onApply: (project: Project) => void;
  onClose: () => void;
}) {
  const [imageData, setImageData] = useState<ImageData | null>(null);
  // A vector (SVG) source is imported EXACTLY — its shapes become stitch objects
  // directly, skipping the raster tracer's resolution ceiling. Null for rasters.
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const [svgShapes, setSvgShapes] = useState<{
    shapes: ReturnType<typeof parseSvgShapes>;
  } | null>(null);
  const [numColors, setNumColors] = useState(4);
  const [userSetColors, setUserSetColors] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [detail, setDetail] = useState<DigitizeDetail>("balanced");
  const [recognizeText, setRecognizeText] = useState(false);
  // Text-retype assist: detected text-like clusters + the string the user types
  // for each. Typed clusters are replaced with crisp authored lettering — the
  // professional move for text OCR can't read (small, stylized, rotated).
  const [textClusters, setTextClusters] = useState<DetectedTextCluster[]>([]);
  const [textAssign, setTextAssign] = useState<Record<string, string>>({});
  // "keep original letterforms" mode: guide clean satin down the TRACED letter
  // shapes (their type, our stitch quality) instead of re-setting in our font.
  const [textKeepShapes, setTextKeepShapes] = useState(false);
  const [font, setFont] = useState<Font | null>(null);
  // Power tools (per-color stitch style, palette merge/match) stay tucked until
  // asked for, so the first view is calm and most users never need them.
  const [advanced, setAdvanced] = useState(false);
  const [updating, setUpdating] = useState(true); // a trace is in flight
  const [error, setError] = useState<string | null>(null);
  // The live trace result. Re-runs (debounced) whenever the settings change.
  const [result, setResult] = useState<{ colors: ThreadColor[]; objects: EmbObject[] } | null>(null);
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());
  // Per-color stitch style override (by colorId). "auto" = the trace's own
  // fill/line-art classification; otherwise force the whole color one way.
  const [styleById, setStyleById] = useState<Record<string, StitchStyle>>({});
  useEscapeToClose(onClose);
  const dialogRef = useDialogFocus<HTMLDivElement>();

  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  useEffect(() => {
    let alive = true;
    loadImageData(file)
      .then((d) => alive && setImageData(d))
      .catch((e) => {
        logError(`Couldn't load image: ${(e as Error).message}`, (e as Error).stack);
        if (alive) setError((e as Error).message);
      });
    // Vector source: also parse its shapes for the exact-geometry import path.
    if (isSvg) {
      file
        .text()
        .then((txt) => {
          if (alive) setSvgShapes({ shapes: parseSvgShapes(txt) });
        })
        .catch(() => alive && setSvgShapes({ shapes: null }));
    }
    return () => {
      alive = false;
    };
  }, [file, isSvg]);

  const complexity = useMemo(
    () => (imageData ? estimateColorComplexity(imageData) : 0),
    [imageData],
  );
  const looksLikePhoto = complexity > PHOTO_COMPLEXITY;

  // Adaptive default color count, graded to the image's dominant-color count
  // (flat logos land low, busy art/photos higher) instead of a binary 4/8. Once
  // the user nudges the stepper we stop steering.
  useEffect(() => {
    if (!imageData || userSetColors) return;
    setNumColors(suggestColorCount(imageData, MIN_COLORS, MAX_COLORS));
  }, [imageData, userSetColors]);

  // LIVE re-trace: whenever the image or any setting changes, re-digitize after a
  // short debounce so dragging the stepper doesn't trace on every tick. The trace
  // (and optional OCR) runs off the debounce; the preview shows an "updating" veil.
  useEffect(() => {
    if (!imageData) return;
    // A vector import waits for its shapes to finish parsing.
    if (isSvg && !svgShapes) return;
    let alive = true;
    setUpdating(true);
    const handle = setTimeout(async () => {
      try {
        const fit = 0.92;
        const mmPerPx = Math.min(hoop.wMm / imageData.width, hoop.hMm / imageData.height) * fit;
        const offsetX = (hoop.wMm - imageData.width * mmPerPx) / 2;
        const offsetY = (hoop.hMm - imageData.height * mmPerPx) / 2;
        // VECTOR path: import the SVG's shapes exactly (no raster ceiling). Falls
        // back to the raster tracer if the SVG couldn't be parsed.
        const traced =
          isSvg && svgShapes?.shapes
            ? svgShapesToObjects(svgShapes.shapes.shapes, {
                contentW: svgShapes.shapes.contentW,
                contentH: svgShapes.shapes.contentH,
                hoopWmm: hoop.wMm,
                hoopHmm: hoop.hMm,
                maxColors: numColors,
              })
            : imageDataToObjects(imageData, numColors, {
                mmPerPx,
                offsetX,
                offsetY,
                removeBackground,
                detail,
              });
        // Collapse near-duplicate palette entries k-means split off a flat region
        // (anti-alias bands, thin shadow shades) so the body doesn't fragment and
        // thread slots aren't wasted. Area-aware, so distinct colors stay.
        const { colors, objects } = consolidateFringeColors(
          {
            version: 1,
            widthMm: hoop.wMm,
            heightMm: hoop.hMm,
            hoop: { ...hoop },
            colors: traced.colors,
            objects: traced.objects,
          },
          // Fringe cleanup may collapse duplicates, never the user's colour
          // budget — the trace already chose the best numColors clusters.
          numColors,
        );

        let finalObjects = objects;
        if (recognizeText && objects.length > 0) {
          // Re-set recognized words as crisp satin lettering. Degrades to the plain
          // trace if OCR finds nothing or can't load — never worse than before.
          try {
            const [words, font] = await Promise.all([ocrWords(imageData), loadFont(DEFAULT_FONT_ID)]);
            const rec = recognizeTextObjects({
              words,
              mmPerPx,
              offsetXMm: offsetX,
              offsetYMm: offsetY,
              objects,
              colors,
              font,
              fontId: DEFAULT_FONT_ID,
            });
            finalObjects = applyTextRecognition(objects, rec);
          } catch {
            /* OCR failed → keep the plain trace */
          }
        }
        if (!alive) return;
        setResult({ colors, objects: finalObjects });
        setKeptIds(new Set(colors.map((c) => c.id))); // keep all by default each trace
        setStyleById({}); // a fresh trace = fresh colorIds, so clear overrides
        // Offer the text-retype assist for any text-like clusters in the trace.
        setTextClusters(detectTextClusters(finalObjects));
        setTextAssign({}); // fresh trace = fresh cluster ids
        setError(
          objects.length === 0
            ? "No shapes found. Try more colors or turn off background removal."
            : null,
        );
      } catch (e) {
        logError(`Digitize failed: ${(e as Error).message}`, (e as Error).stack);
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setUpdating(false);
      }
    }, RETRACE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [imageData, svgShapes, isSvg, numColors, removeBackground, detail, recognizeText, hoop.wMm, hoop.hMm]);

  // Load the lettering font once — the text-retype assist needs it.
  useEffect(() => {
    let alive = true;
    loadFont(DEFAULT_FONT_ID).then((f) => alive && setFont(f)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const colorById = useMemo(
    () => new Map((result?.colors ?? []).map((c) => [c.id, c] as const)),
    [result],
  );
  // Traced objects with any user-typed text swapped for authored lettering. This
  // is a pure overlay on the trace (no re-trace), so typing updates the preview
  // instantly. Falls back to the plain trace when nothing is typed or the font
  // hasn't loaded.
  const objectsWithText = useMemo(() => {
    if (!result) return [];
    const named = Object.values(textAssign).some((v) => v.trim().length > 0);
    if (!named || !font || textClusters.length === 0) return result.objects;
    const place = textKeepShapes ? placeGuidedText : placeManualText;
    const res = place({
      assignments: textAssign,
      clusters: textClusters,
      objects: result.objects,
      font,
      fontId: DEFAULT_FONT_ID,
    });
    return applyManualText(result.objects, res);
  }, [result, textAssign, textClusters, font, textKeepShapes]);
  const keptObjects = useMemo(
    () =>
      result
        ? objectsWithText
            .filter((o) => keptIds.has(o.colorId))
            .map((o) => styleObject(o, styleById[o.colorId] ?? "auto"))
        : [],
    [result, objectsWithText, keptIds, styleById],
  );

  const setColors = (n: number) => {
    setUserSetColors(true);
    setNumColors(Math.max(MIN_COLORS, Math.min(MAX_COLORS, n)));
  };

  const toggleColor = (id: string) =>
    setKeptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Edit the traced palette in place (no re-trace): recolor swaps a shade,
  // rename labels it. Both flow straight into `result.colors`, so the preview
  // and the applied design pick them up.
  const recolor = (id: string, rgb: [number, number, number]) =>
    setResult((prev) =>
      prev ? { ...prev, colors: prev.colors.map((c) => (c.id === id ? { ...c, rgb } : c)) } : prev,
    );
  const setStyle = (id: string, style: StitchStyle) => setStyleById((prev) => ({ ...prev, [id]: style }));
  const rename = (id: string, name: string) =>
    setResult((prev) =>
      prev
        ? { ...prev, colors: prev.colors.map((c) => (c.id === id ? { ...c, name: name.trim() || undefined } : c)) }
        : prev,
    );

  // Collapse near-duplicate shades (anti-alias bands, JPEG noise) under a ΔE
  // threshold — fewer, cleaner threads without a re-trace.
  const MERGE_DELTA_E = 10;
  const mergeSimilar = () => {
    if (!result) return;
    const merged = mergeSimilarColors(
      { version: 1, widthMm: hoop.wMm, heightMm: hoop.hMm, hoop: { ...hoop }, colors: result.colors, objects: result.objects },
      MERGE_DELTA_E,
    );
    setResult({ colors: merged.colors, objects: merged.objects });
    setKeptIds(new Set(merged.colors.map((c) => c.id)));
  };

  // Snap the traced palette to the nearest real threads (name + code + exact spool
  // rgb), so the design lands ready to order instead of as raw scanned colors.
  const matchToThreads = () => {
    if (!result) return;
    setResult({ ...result, colors: matchColorsToChart(result.colors, THREAD_CHARTS[0]) });
  };

  /** Apply only the kept colors. Filtering by colorId needs no re-trace. */
  function apply() {
    if (!result) return;
    const colors = result.colors.filter((c) => keptIds.has(c.id));
    const objects = objectsWithText
      .filter((o) => keptIds.has(o.colorId))
      .map((o) => styleObject(o, styleById[o.colorId] ?? "auto"));
    if (objects.length === 0) return;
    // Smart cleanup so the import lands with sensible stitch types, safe densities,
    // and color-grouped order — no manual tuning needed to get a good result.
    onApply(
      fixStitches({
        version: 1,
        widthMm: hoop.wMm,
        heightMm: hoop.hMm,
        hoop: { ...hoop },
        colors,
        objects,
      }),
    );
  }

  return (
    // Click-outside closes; keyboard users dismiss with Escape (useEscapeToClose).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="anim-scrim-in fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Turn an image into stitches"
        className="anim-press-in max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-3 shadow-press outline-none sm:p-5"
      >
        <h2 className="mb-3 font-label text-lg font-semibold uppercase tracking-[0.08em] text-navy">
          Turn an image into stitches
        </h2>

        {/* Source image beside the LIVE stitch preview. */}
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <figure className="m-0">
            <figcaption className="mb-1 font-label text-[10px] font-semibold uppercase tracking-wide text-navy/50">
              Your image
            </figcaption>
            <div className="flex h-28 items-center justify-center rounded border border-navy/10 bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2 sm:h-40">
              {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
              <img src={previewUrl} alt="Image to digitize" className="max-h-full max-w-full object-contain" />
            </div>
          </figure>
          <figure className="m-0">
            <figcaption className="mb-1 font-label text-[10px] font-semibold uppercase tracking-wide text-navy/50">
              Stitch preview
            </figcaption>
            <DigitizePreview objects={keptObjects} colorById={colorById} updating={updating} />
          </figure>
        </div>

        {looksLikePhoto && (
          <p className="mb-3 flex gap-1.5 rounded bg-butter-200 px-2 py-1.5 text-[12px] text-navy">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-stamp" aria-hidden />
            <span>
              This looks photographic. Clean illustrations and logos work best — for a detailed
              subject add a few more colors to catch the shading; very busy photos may still come
              out rough.
            </span>
          </p>
        )}

        {/* BASICS — the few controls most designs need, grouped so the dialog
            reads calm and "ready to apply" at a glance. */}
        <fieldset className="mb-4 rounded-sm border-2 border-ink/15 bg-butter-50 p-3">
          <legend className="px-1 font-label text-[10px] font-semibold uppercase tracking-wide text-navy/50">
            Basics
          </legend>

          {/* Colors stepper. */}
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-navy">Colors</span>
            <div className="flex items-center gap-2">
              <StepBtn label="Fewer colors" onClick={() => setColors(numColors - 1)} disabled={numColors <= MIN_COLORS}>
                <Minus size={15} />
              </StepBtn>
              <span className="w-6 text-center text-sm font-semibold tabular-nums text-navy">{numColors}</span>
              <StepBtn label="More colors" onClick={() => setColors(numColors + 1)} disabled={numColors >= MAX_COLORS}>
                <Plus size={15} />
              </StepBtn>
            </div>
          </div>
          <p className="mb-3 text-[11px] text-navy/55">
            More colors catch finer detail and thin parts (and add thread changes); fewer keep it bold
            and simple. Logos look best at 3–5; try 6–8 for a busy photo. The preview updates as you change this.
          </p>

          {/* Detail level — steers trace smoothing, simplification, and despeckling. */}
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-navy">Detail</span>
            <div className="inline-flex overflow-hidden rounded-sm border-2 border-ink/30" role="group" aria-label="Detail level">
              {([["smooth", "Smoother"], ["balanced", "Balanced"], ["detailed", "Detailed"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setDetail(value)}
                  aria-pressed={detail === value}
                  className={`px-3 py-1 font-label text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink ${
                    detail === value ? "bg-ink text-cream" : "bg-cream text-navy/70 hover:bg-butter-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-3 text-[11px] text-navy/55">
            Smoother keeps it bold and drops tiny stray pieces; Detailed catches fine lines and small
            features (more stitches and thread stops). The preview updates as you change this.
          </p>

          <label className="flex items-center gap-2 text-sm text-navy">
            <input type="checkbox" checked={removeBackground} onChange={(e) => setRemoveBackground(e.target.checked)} className="accent-ink" />
            Remove background
          </label>
          <p className="mb-2 ml-6 text-[11px] text-navy/55">
            Turns the flat backdrop transparent so only the subject is stitched.
          </p>

          <label className="flex items-center gap-2 text-sm text-navy">
            <input type="checkbox" checked={recognizeText} onChange={(e) => setRecognizeText(e.target.checked)} className="accent-ink" />
            Recognize text as lettering
          </label>
          <p className="ml-6 text-[11px] text-navy/55">
            Re-sets words in a clean satin font instead of tracing their pixels. Best on clear,
            horizontal logo text; loads a recognizer the first time.
          </p>
        </fieldset>

        {/* Text-retype assist — type what small/stylized/rotated text says and it's
            re-set in crisp satin, the professional move OCR can't do. */}
        {textClusters.length > 0 && (
          <fieldset className="mb-4 rounded-sm border-2 border-ink/15 bg-butter-50 p-3">
            <p className="mb-1 font-label text-[10px] font-semibold uppercase tracking-wide text-navy/50">
              Text found — type what it says for crisp lettering
            </p>
            <p className="mb-2 text-[11px] text-navy/55">
              We spotted {textClusters.length === 1 ? "a text area" : `${textClusters.length} text areas`}.
              Type the exact words so each sews sharp instead of tracing rough pixels. Leave a box
              blank to keep the plain trace.
            </p>
            {/* Two ways to make text crisp: re-set it in our clean font, or keep
                the artwork's own letterforms and lay clean satin down them. */}
            <div className="mb-2 flex rounded-sm border border-ink/15 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setTextKeepShapes(false)}
                className={`flex-1 rounded-[2px] px-2 py-1 font-label uppercase tracking-wide ${!textKeepShapes ? "bg-ink text-cream" : "text-navy/60"}`}
              >
                Clean font
              </button>
              <button
                type="button"
                onClick={() => setTextKeepShapes(true)}
                className={`flex-1 rounded-[2px] px-2 py-1 font-label uppercase tracking-wide ${textKeepShapes ? "bg-ink text-cream" : "text-navy/60"}`}
              >
                Keep original letters
              </button>
            </div>
            <p className="mb-2 text-[11px] text-navy/45">
              {textKeepShapes
                ? "Keeps the logo's exact letterforms and lays clean satin down each stroke — the original type, sewn crisply."
                : "Re-sets the words in a clean satin font. Sharpest, but swaps the original typeface for ours."}
            </p>
            <div className="flex flex-col gap-1.5">
              {textClusters.map((cl, i) => (
                <label key={cl.id} className="flex items-center gap-2 text-sm text-navy">
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink/15 text-[10px] font-semibold text-navy"
                    title={`~${cl.heightMm.toFixed(0)}mm tall${Math.abs(cl.angleDeg) > 20 ? ", angled" : ""}`}
                  >
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={textAssign[cl.id] ?? ""}
                    onChange={(e) => setTextAssign((prev) => ({ ...prev, [cl.id]: e.target.value }))}
                    placeholder={`Text area ${i + 1} (${cl.heightMm.toFixed(0)}mm${Math.abs(cl.angleDeg) > 20 ? ", angled" : ""})`}
                    className="min-w-0 flex-1 rounded-sm border border-ink/20 bg-white px-2 py-1 text-sm text-navy placeholder:text-navy/35"
                  />
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {/* Color list — tap to keep or skip; the preview updates instantly. */}
        {result && result.colors.length > 0 && (
          <div className="mb-4 rounded-sm border-2 border-ink/15 bg-butter-50 p-3">
            <p className="mb-1.5 font-label text-[10px] font-semibold uppercase tracking-wide text-navy/50">
              Colors found — recolor or rename a shade, or skip a stray one
            </p>
            <div className="flex flex-col gap-1">
              {result.colors.map((c) => {
                const kept = keptIds.has(c.id);
                const regions = result.objects.filter((o) => o.colorId === c.id).length;
                const rgbStr = `rgb(${c.rgb.join(",")})`;
                return (
                  <div
                    key={c.id}
                    className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border-2 px-2 py-1.5 text-sm transition ${
                      kept ? "border-ink bg-butter-200 text-navy" : "border-ink/20 bg-cream text-navy/45"
                    }`}
                  >
                    {/* recolor: native picker styled as the swatch */}
                    <input
                      type="color"
                      value={rgbToHex(c.rgb)}
                      onChange={(e) => recolor(c.id, hexToRgb(e.target.value))}
                      aria-label={`Recolor ${c.name ?? rgbStr}`}
                      title="Change this color"
                      className={`h-5 w-5 shrink-0 cursor-pointer rounded-sm border border-navy/30 bg-transparent p-0 ${kept ? "" : "opacity-40"}`}
                    />
                    {/* rename: commit on Enter / blur */}
                    <input
                      type="text"
                      defaultValue={c.name ?? ""}
                      placeholder={rgbStr}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={(e) => rename(c.id, e.target.value)}
                      aria-label={`Rename ${c.name ?? rgbStr}`}
                      className="min-w-0 flex-1 basis-24 truncate rounded-sm bg-transparent px-1 py-0.5 outline-none focus:bg-cream focus:ring-1 focus:ring-ink/40"
                    />
                    <span className="tabular-nums text-[11px] text-navy/50">
                      {regions} region{regions === 1 ? "" : "s"}
                    </span>
                    {/* per-color stitch style (advanced): auto / satin / outline */}
                    {advanced && (
                      <select
                        value={styleById[c.id] ?? "auto"}
                        onChange={(e) => setStyle(c.id, e.target.value as StitchStyle)}
                        aria-label={`Stitch style for ${c.name ?? rgbStr}`}
                        className="shrink-0 appearance-none rounded-sm border border-ink/30 bg-cream px-1.5 py-0.5 text-[11px] text-navy outline-none focus:ring-1 focus:ring-ink/40"
                      >
                        <option value="auto">Auto</option>
                        <option value="satin">Satin</option>
                        <option value="outline">Outline</option>
                      </select>
                    )}
                    <button
                      onClick={() => toggleColor(c.id)}
                      aria-pressed={kept}
                      aria-label={`${c.name ?? rgbStr} — tap to ${kept ? "skip" : "keep"}`}
                      className="flex shrink-0 items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      {kept ? (
                        <Eye size={15} className="text-navy/60" aria-hidden />
                      ) : (
                        <EyeOff size={15} className="text-navy/40" aria-hidden />
                      )}
                      <span className="w-8 font-label text-[10px] font-semibold uppercase tracking-wide">
                        {kept ? "Keep" : "Skip"}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Power tools — per-color stitch style (above) plus palette merge/match
                — stay tucked behind this toggle so the list reads calm by default. */}
            <button
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              className="mt-2 flex items-center gap-1 rounded-sm font-label text-[10px] font-semibold uppercase tracking-wide text-navy/60 transition hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              <ChevronDown size={13} className={`transition-transform ${advanced ? "rotate-180" : ""}`} aria-hidden />
              Advanced options
            </button>

            {advanced && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {result.colors.length > 1 && (
                  <button
                    onClick={mergeSimilar}
                    className="rounded-sm border-2 border-ink/40 px-2.5 py-1 font-label text-[10px] font-semibold uppercase tracking-wide text-navy/70 transition hover:border-ink hover:bg-butter-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  >
                    Merge similar shades
                  </button>
                )}
                <button
                  onClick={matchToThreads}
                  className="rounded-sm border-2 border-ink/40 px-2.5 py-1 font-label text-[10px] font-semibold uppercase tracking-wide text-navy/70 transition hover:border-ink hover:bg-butter-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  Match to thread colors
                </button>
              </div>
            )}
          </div>
        )}

        {hasExistingWork && (
          <p className="mb-3 text-[12px] text-navy/60">
            This replaces your current design (you can undo it with ⌘/Ctrl+Z).
          </p>
        )}

        {error && <p className="mb-3 text-[12px] text-stamp">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-sm border-2 border-ink px-4 py-2 font-label text-xs font-semibold uppercase tracking-wide text-ink hover:bg-butter-200"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={keptObjects.length === 0 || updating}
            className="rounded-sm border-2 border-ink bg-ink px-4 py-2 font-label text-xs font-semibold uppercase tracking-wide text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none disabled:opacity-50"
          >
            Add to design
          </button>
        </div>
      </div>
    </div>
  );
}

/** A square stepper button (icon) for the color count. */
function StepBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-sm border-2 border-ink text-ink hover:bg-butter-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** A live preview of the kept regions sewn by the REAL engine — the same stitches
 *  the canvas and simulator produce (bold bean outlines, satin columns, tatami
 *  fills), drawn with the shared realistic-thread painter so "what you see is what you'll
 *  get". Fits the design to the box and re-renders as colors/styles change. A veil
 *  dims it while a fresh trace is in flight. */
function DigitizePreview({
  objects,
  colorById,
  updating,
}: {
  objects: EmbObject[];
  colorById: Map<string, ThreadColor>;
  updating: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { segs, box } = useMemo(() => {
    const b = pathsBounds(objects.flatMap((o) => o.paths));
    if (!b) return { segs: [], box: null as null | { minX: number; minY: number; w: number; h: number } };
    const pad = 2;
    const box = { minX: b.minX - pad, minY: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
    const design = generateDesign({
      ...createEmptyProject(),
      objects: objects.map((o) => ({ ...o, visible: true })),
    });
    return { segs: designToSegments(design), box };
  }, [objects]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !box) return;
    const draw = () => {
      // getContext returns null with no 2d support, and jsdom throws outright — in
      // either case there's nothing to paint (the kept-object count is still exposed
      // via the data attribute for tests).
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d");
      } catch {
        return;
      }
      if (!ctx) return;
      const cssW = wrap.clientWidth || 1;
      const cssH = wrap.clientHeight || 1;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const scale = Math.min(cssW / box.w, cssH / box.h);
      const offX = (cssW - box.w * scale) / 2;
      const offY = (cssH - box.h * scale) / 2;
      const px = (x: number) => offX + (x - box.minX) * scale;
      const py = (y: number) => offY + (y - box.minY) * scale;
      const threadPx = Math.min(4, Math.max(1.2, scale * 0.42));
      drawStitches(ctx, segs, { colorById, px, py, threadPx, realistic: true });
    };
    draw();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [segs, box, colorById]);

  return (
    <div
      ref={wrapRef}
      data-preview
      data-preview-objects={objects.length}
      className="relative flex h-28 items-center justify-center overflow-hidden rounded border border-navy/10 bg-white sm:h-40"
    >
      {box ? (
        <canvas ref={canvasRef} className="h-full w-full" />
      ) : (
        !updating && <span className="text-[12px] text-navy/40">Nothing to preview</span>
      )}
      {updating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-white/70" aria-live="polite">
          <span className="font-mono text-[11px] text-ink">Updating…</span>
          <div className="h-[3px] w-24 overflow-hidden rounded-full bg-ink/10">
            <div className="anim-indeterminate h-full w-1/3 rounded-full bg-stamp" />
          </div>
        </div>
      )}
    </div>
  );
}
