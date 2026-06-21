import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { EmbObject, Hoop, Project, ThreadColor } from "../types/project";
import { loadImageData } from "../lib/image";
import { imageDataToObjects, estimateColorComplexity } from "../lib/trace";
import { ocrWords } from "../lib/trace/ocr";
import { recognizeTextObjects, applyTextRecognition } from "../lib/trace/textRecognize";
import { loadFont, DEFAULT_FONT_ID } from "../lib/text/fonts";
import { fixStitches } from "../lib/fix";
import { pathsBounds } from "../lib/geometry";
import { ringsToSvgPath } from "../lib/svgPath";
import { useEscapeToClose, useDialogFocus } from "./useEscapeToClose";

/**
 * Auto-digitize dialog: preview the image, choose the color count and a couple
 * of options, and convert it to a stitch design. Best for clean logos and line
 * art — photos are warned about and digitize roughly (an explicit v1 non-goal).
 */

/** Above this estimated color count, the image is probably a photo. */
const PHOTO_COMPLEXITY = 160;

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
  const [numColors, setNumColors] = useState(4);
  const [userSetColors, setUserSetColors] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [recognizeText, setRecognizeText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"trace" | "text">("trace");
  const [error, setError] = useState<string | null>(null);
  // After tracing we pause on a review step: show the detected colors so the user
  // picks which to keep before the design lands. null = still on the options step.
  const [detected, setDetected] = useState<{ colors: ThreadColor[]; objects: EmbObject[] } | null>(null);
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());
  useEscapeToClose(onClose);
  const dialogRef = useDialogFocus<HTMLDivElement>();

  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  useEffect(() => {
    let alive = true;
    loadImageData(file)
      .then((d) => alive && setImageData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [file]);

  const complexity = useMemo(
    () => (imageData ? estimateColorComplexity(imageData) : 0),
    [imageData],
  );
  const looksLikePhoto = complexity > PHOTO_COMPLEXITY;

  // Adaptive default color count. Flat, limited-palette artwork (a logo, an
  // illustration — what this tool is FOR) wants few colors: more just posterizes
  // smooth shading into bands whose jagged boundaries shatter into hundreds of
  // tiny regions. Photos need more to read. The user can override; once they do,
  // we stop steering.
  useEffect(() => {
    if (!imageData || userSetColors) return;
    setNumColors(looksLikePhoto ? 8 : 4);
  }, [imageData, looksLikePhoto, userSetColors]);

  const colorById = useMemo(
    () => new Map((detected?.colors ?? []).map((c) => [c.id, c] as const)),
    [detected],
  );
  const keptObjects = useMemo(
    () => (detected ? detected.objects.filter((o) => keptIds.has(o.colorId)) : []),
    [detected, keptIds],
  );

  async function digitize() {
    if (!imageData) return;
    setBusy(true);
    setPhase("trace");
    setError(null);
    // Yield once so the spinner paints before the synchronous trace runs.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const fit = 0.92;
      const mmPerPx =
        Math.min(hoop.wMm / imageData.width, hoop.hMm / imageData.height) * fit;
      const designW = imageData.width * mmPerPx;
      const designH = imageData.height * mmPerPx;
      const offsetX = (hoop.wMm - designW) / 2;
      const offsetY = (hoop.hMm - designH) / 2;

      const { colors, objects } = imageDataToObjects(imageData, numColors, {
        mmPerPx,
        offsetX,
        offsetY,
        removeBackground,
      });

      if (objects.length === 0) {
        setError("No shapes found. Try more colors or turn off background removal.");
        setBusy(false);
        return;
      }

      // Optional: recognize words and re-set them as crisp satin FONT lettering,
      // replacing the rough traced glyphs. Degrades to the plain trace if OCR finds
      // nothing or its engine can't load — the design is never worse than before.
      let finalObjects = objects;
      if (recognizeText) {
        setPhase("text");
        try {
          const [words, font] = await Promise.all([
            ocrWords(imageData),
            loadFont(DEFAULT_FONT_ID),
          ]);
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

      // Pause on the review step: keep every detected color by default and let the
      // user drop any they don't want before the design lands on the canvas.
      setDetected({ colors, objects: finalObjects });
      setKeptIds(new Set(colors.map((c) => c.id)));
      setBusy(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  /** Apply only the kept colors. Filtering by colorId needs no re-trace. */
  function apply() {
    if (!detected) return;
    const colors = detected.colors.filter((c) => keptIds.has(c.id));
    const objects = detected.objects.filter((o) => keptIds.has(o.colorId));
    if (objects.length === 0) return;
    // Run the smart cleanup so the import lands with sensible stitch types (satin
    // for thin strokes, tatami for broad areas), safe densities, and color-grouped
    // order — no manual tuning needed to get a good result.
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

  const toggleColor = (id: string) =>
    setKeptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        aria-label="Turn an image into stitches"
        className="anim-press-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-4 shadow-press outline-none"
      >
        <h2 className="mb-3 font-label uppercase tracking-[0.08em] text-lg font-semibold text-navy">
          {detected ? "Choose colors" : "Turn an image into stitches"}
        </h2>

        {!detected && (
          <>
            <div className="mb-3 flex justify-center rounded border border-navy/10 bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
              {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
              <img
                src={previewUrl}
                alt="Image to digitize"
                className="max-h-48 max-w-full object-contain"
              />
            </div>

            {looksLikePhoto && (
              <p className="mb-3 flex gap-1.5 rounded bg-butter-200 px-2 py-1.5 text-[12px] text-navy">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-stamp" aria-hidden />
                <span>
                  This looks photographic. Clean illustrations and logos work best — for
                  a detailed subject (like a pet portrait) add a few more colors to catch
                  the eyes and shading; very busy photos may still come out rough.
                </span>
              </p>
            )}

            <label className="mb-1 block text-sm text-navy">
              <div className="mb-1 flex justify-between">
                <span>Colors</span>
                <span className="tabular-nums text-navy/60">{numColors}</span>
              </div>
              <input
                type="range"
                aria-label="Number of colors"
                min={2}
                max={12}
                value={numColors}
                onChange={(e) => {
                  setUserSetColors(true);
                  setNumColors(Number(e.target.value));
                }}
                className="w-full cursor-pointer accent-ink"
              />
            </label>
            <p className="mb-3 text-[11px] text-navy/55">
              More colors capture more detail (eyes, nose, shading) and add thread
              changes; fewer keep it simple and bold. Clean logos and illustrations
              look best at 3–5; try 6–8 for a busy photo.
            </p>

            <label className="mb-2 flex items-center gap-2 text-sm text-navy">
              <input
                type="checkbox"
                checked={removeBackground}
                onChange={(e) => setRemoveBackground(e.target.checked)}
                className="accent-ink"
              />
              Remove background
            </label>

            <label className="mb-1 flex items-center gap-2 text-sm text-navy">
              <input
                type="checkbox"
                checked={recognizeText}
                onChange={(e) => setRecognizeText(e.target.checked)}
                className="accent-ink"
              />
              Recognize text as lettering
            </label>
            <p className="mb-4 ml-6 text-[11px] text-navy/55">
              Re-sets words in a clean satin font instead of tracing their pixels. Best
              on clear, horizontal logo text; loads a recognizer the first time.
            </p>
          </>
        )}

        {detected && (
          <>
            <p className="mb-2 text-[12px] text-navy/70">
              Here's what we found. Tap a color to drop it — handy for an unwanted
              background or stray shade. The preview shows what you'll add.
            </p>
            <DigitizePreview objects={keptObjects} colorById={colorById} />
            <div className="mb-3 flex flex-col gap-1">
              {detected.colors.map((c) => {
                const kept = keptIds.has(c.id);
                const regions = detected.objects.filter((o) => o.colorId === c.id).length;
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleColor(c.id)}
                    aria-pressed={kept}
                    className={`flex items-center gap-2 rounded-sm border-2 px-3 py-1.5 text-left text-sm transition ${
                      kept ? "border-ink bg-butter-200 text-navy" : "border-ink/20 bg-cream text-navy/45"
                    }`}
                  >
                    <span
                      className={`h-4 w-4 shrink-0 rounded-sm border border-navy/30 ${kept ? "" : "opacity-40"}`}
                      style={{ backgroundColor: `rgb(${c.rgb.join(",")})` }}
                    />
                    <span className="flex-1 truncate">{c.name ?? `rgb(${c.rgb.join(",")})`}</span>
                    <span className="tabular-nums text-[11px] text-navy/50">
                      {regions} region{regions === 1 ? "" : "s"}
                    </span>
                    <span className="font-label text-[10px] font-semibold uppercase tracking-wide">
                      {kept ? "Keep" : "Skip"}
                    </span>
                  </button>
                );
              })}
            </div>

            {hasExistingWork && (
              <p className="mb-3 text-[12px] text-navy/60">
                This replaces your current design (you can undo it with ⌘/Ctrl+Z).
              </p>
            )}
          </>
        )}

        {busy && (
          <div className="mb-3">
            <p className="font-mono text-[11px] text-ink">
              {phase === "text" ? "Recognizing text…" : "Tracing your image…"}
            </p>
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-ink/10">
              <div className="anim-indeterminate h-full w-1/3 rounded-full bg-stamp" />
            </div>
          </div>
        )}

        {error && <p className="mb-3 text-[12px] text-stamp">{error}</p>}

        <div className="flex justify-end gap-2">
          {detected ? (
            <>
              <button
                onClick={() => {
                  setDetected(null);
                  setError(null);
                }}
                className="rounded-sm border-2 border-ink px-4 py-2 font-label text-xs font-semibold uppercase tracking-wide text-ink hover:bg-butter-200"
              >
                Back
              </button>
              <button
                onClick={apply}
                disabled={keptObjects.length === 0}
                className="rounded-sm border-2 border-ink bg-ink px-4 py-2 font-label text-xs font-semibold uppercase tracking-wide text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none disabled:opacity-50"
              >
                Add to design
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-sm border-2 border-ink px-4 py-2 font-label text-xs font-semibold uppercase tracking-wide text-ink hover:bg-butter-200"
              >
                Cancel
              </button>
              <button
                onClick={() => void digitize()}
                disabled={!imageData || busy}
                className="rounded-sm border-2 border-ink bg-ink px-4 py-2 font-label text-xs font-semibold uppercase tracking-wide text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none disabled:opacity-50"
              >
                {busy ? "Digitizing…" : "Digitize"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A small SVG preview of the kept traced regions, colored by thread (even-odd so
 *  holes/counters show). Fits the design to the box; updates as colors are toggled. */
function DigitizePreview({
  objects,
  colorById,
}: {
  objects: EmbObject[];
  colorById: Map<string, ThreadColor>;
}) {
  const box = useMemo(() => {
    const b = pathsBounds(objects.flatMap((o) => o.paths));
    if (!b) return null;
    const pad = 2;
    return { minX: b.minX - pad, minY: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
  }, [objects]);

  return (
    <div className="mb-3 flex h-40 items-center justify-center rounded border border-navy/10 bg-white">
      {box ? (
        <svg
          viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
          className="max-h-full max-w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {objects.map((o) => {
            const c = colorById.get(o.colorId);
            return (
              <path
                key={o.id}
                d={ringsToSvgPath(o.paths)}
                fill={c ? `rgb(${c.rgb.join(",")})` : "#888"}
                fillRule="evenodd"
              />
            );
          })}
        </svg>
      ) : (
        <span className="text-[12px] text-navy/40">Nothing to preview</span>
      )}
    </div>
  );
}
