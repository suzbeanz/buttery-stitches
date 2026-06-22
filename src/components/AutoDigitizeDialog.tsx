import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Minus, Plus } from "lucide-react";
import type { EmbObject, Hoop, Project, ThreadColor } from "../types/project";
import { loadImageData } from "../lib/image";
import { imageDataToObjects, estimateColorComplexity, suggestColorCount } from "../lib/trace";
import { ocrWords } from "../lib/trace/ocr";
import { recognizeTextObjects, applyTextRecognition } from "../lib/trace/textRecognize";
import { loadFont, DEFAULT_FONT_ID } from "../lib/text/fonts";
import { fixStitches } from "../lib/fix";
import { pathsBounds } from "../lib/geometry";
import { ringsToSvgPath } from "../lib/svgPath";
import { useEscapeToClose, useDialogFocus } from "./useEscapeToClose";

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
  const [updating, setUpdating] = useState(true); // a trace is in flight
  const [error, setError] = useState<string | null>(null);
  // The live trace result. Re-runs (debounced) whenever the settings change.
  const [result, setResult] = useState<{ colors: ThreadColor[]; objects: EmbObject[] } | null>(null);
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
    let alive = true;
    setUpdating(true);
    const handle = setTimeout(async () => {
      try {
        const fit = 0.92;
        const mmPerPx = Math.min(hoop.wMm / imageData.width, hoop.hMm / imageData.height) * fit;
        const offsetX = (hoop.wMm - imageData.width * mmPerPx) / 2;
        const offsetY = (hoop.hMm - imageData.height * mmPerPx) / 2;
        const { colors, objects } = imageDataToObjects(imageData, numColors, {
          mmPerPx,
          offsetX,
          offsetY,
          removeBackground,
        });

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
        setError(
          objects.length === 0
            ? "No shapes found. Try more colors or turn off background removal."
            : null,
        );
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setUpdating(false);
      }
    }, RETRACE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [imageData, numColors, removeBackground, recognizeText, hoop.wMm, hoop.hMm]);

  const colorById = useMemo(
    () => new Map((result?.colors ?? []).map((c) => [c.id, c] as const)),
    [result],
  );
  const keptObjects = useMemo(
    () => (result ? result.objects.filter((o) => keptIds.has(o.colorId)) : []),
    [result, keptIds],
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

  /** Apply only the kept colors. Filtering by colorId needs no re-trace. */
  function apply() {
    if (!result) return;
    const colors = result.colors.filter((c) => keptIds.has(c.id));
    const objects = result.objects.filter((o) => keptIds.has(o.colorId));
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
        className="anim-press-in max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-4 shadow-press outline-none"
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
            <div className="flex h-40 items-center justify-center rounded border border-navy/10 bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
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

        <label className="mb-2 flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={removeBackground} onChange={(e) => setRemoveBackground(e.target.checked)} className="accent-ink" />
          Remove background
        </label>

        <label className="mb-1 flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={recognizeText} onChange={(e) => setRecognizeText(e.target.checked)} className="accent-ink" />
          Recognize text as lettering
        </label>
        <p className="mb-4 ml-6 text-[11px] text-navy/55">
          Re-sets words in a clean satin font instead of tracing their pixels. Best on clear,
          horizontal logo text; loads a recognizer the first time.
        </p>

        {/* Color list — tap to keep or skip; the preview updates instantly. */}
        {result && result.colors.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 font-label text-[10px] font-semibold uppercase tracking-wide text-navy/50">
              Colors found — tap to drop an unwanted background or stray shade
            </p>
            <div className="flex flex-col gap-1">
              {result.colors.map((c) => {
                const kept = keptIds.has(c.id);
                const regions = result.objects.filter((o) => o.colorId === c.id).length;
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
                    {kept ? (
                      <Eye size={15} className="text-navy/60" aria-hidden />
                    ) : (
                      <EyeOff size={15} className="text-navy/40" aria-hidden />
                    )}
                    <span className="w-8 font-label text-[10px] font-semibold uppercase tracking-wide">
                      {kept ? "Keep" : "Skip"}
                    </span>
                  </button>
                );
              })}
            </div>
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
      className="grid h-7 w-7 place-items-center rounded-sm border-2 border-ink text-ink hover:bg-butter-200 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** A small SVG preview of the kept traced regions, colored by thread (even-odd so
 *  holes/counters show). Fits the design to the box; updates as colors are toggled.
 *  A veil dims it while a fresh trace is in flight. */
function DigitizePreview({
  objects,
  colorById,
  updating,
}: {
  objects: EmbObject[];
  colorById: Map<string, ThreadColor>;
  updating: boolean;
}) {
  const box = useMemo(() => {
    const b = pathsBounds(objects.flatMap((o) => o.paths));
    if (!b) return null;
    const pad = 2;
    return { minX: b.minX - pad, minY: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
  }, [objects]);

  return (
    <div className="relative flex h-40 items-center justify-center rounded border border-navy/10 bg-white">
      {box ? (
        <svg data-preview viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`} className="max-h-full max-w-full" preserveAspectRatio="xMidYMid meet">
          {objects.map((o) => {
            const c = colorById.get(o.colorId);
            return <path key={o.id} d={ringsToSvgPath(o.paths)} fill={c ? `rgb(${c.rgb.join(",")})` : "#888"} fillRule="evenodd" />;
          })}
        </svg>
      ) : (
        !updating && <span className="text-[12px] text-navy/40">Nothing to preview</span>
      )}
      {updating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-white/70">
          <span className="font-mono text-[11px] text-ink">Updating…</span>
          <div className="h-[3px] w-24 overflow-hidden rounded-full bg-ink/10">
            <div className="anim-indeterminate h-full w-1/3 rounded-full bg-stamp" />
          </div>
        </div>
      )}
    </div>
  );
}
