import { useEffect, useMemo, useState } from "react";
import type { Hoop, Project } from "../types/project";
import { loadImageData } from "../lib/image";
import { imageDataToObjects, estimateColorComplexity } from "../lib/trace";
import { fixStitches } from "../lib/fix";
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
  const [numColors, setNumColors] = useState(6);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  function digitize() {
    if (!imageData) return;
    setBusy(true);
    setError(null);
    // Let the spinner paint before the synchronous trace runs.
    setTimeout(() => {
      try {
        const fit = 0.92;
        const mmPerPx =
          Math.min(hoop.wMm / imageData.width, hoop.hMm / imageData.height) * fit;
        const designW = imageData.width * mmPerPx;
        const designH = imageData.height * mmPerPx;

        const { colors, objects } = imageDataToObjects(imageData, numColors, {
          mmPerPx,
          offsetX: (hoop.wMm - designW) / 2,
          offsetY: (hoop.hMm - designH) / 2,
          removeBackground,
        });

        if (objects.length === 0) {
          setError("No shapes found. Try more colors or turn off background removal.");
          setBusy(false);
          return;
        }

        // Run the smart cleanup so the import lands with sensible stitch types
        // (satin for thin strokes, tatami for broad areas), safe densities, and
        // color-grouped order — no manual tuning needed to get a good result.
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
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    }, 30);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Turn a picture into stitches"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-navy/20 bg-cream p-4 shadow-2xl outline-none"
      >
        <h2 className="mb-3 font-label uppercase tracking-[0.08em] text-lg font-semibold text-navy">
          Turn a picture into stitches
        </h2>

        <div className="mb-3 flex justify-center rounded border border-navy/10 bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
          {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
          <img
            src={previewUrl}
            alt="Image to digitize"
            className="max-h-48 max-w-full object-contain"
          />
        </div>

        {looksLikePhoto && (
          <p className="mb-3 rounded bg-butter-200 px-2 py-1.5 text-[12px] text-navy">
            ⚠️ This looks like a photo. Buttery Stitches is built for logos and line
            art — expect a rough result, and try fewer colors.
          </p>
        )}

        <label className="mb-3 block text-sm text-navy">
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
            onChange={(e) => setNumColors(Number(e.target.value))}
            className="w-full cursor-pointer accent-navy"
          />
        </label>

        <label className="mb-4 flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={removeBackground}
            onChange={(e) => setRemoveBackground(e.target.checked)}
          />
          Remove background (drops the largest color area)
        </label>

        {hasExistingWork && (
          <p className="mb-3 text-[12px] text-navy/60">
            This replaces your current design (you can undo it with ⌘/Ctrl+Z).
          </p>
        )}

        {error && <p className="mb-3 text-[12px] text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-navy hover:bg-butter-200"
          >
            Cancel
          </button>
          <button
            onClick={digitize}
            disabled={!imageData || busy}
            className="rounded bg-navy px-3 py-1.5 text-sm text-butter-200 hover:bg-navy-light disabled:opacity-50"
          >
            {busy ? "Digitizing…" : "Digitize"}
          </button>
        </div>
      </div>
    </div>
  );
}
