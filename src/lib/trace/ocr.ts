/**
 * Optical character recognition for the auto-digitizer, used by Stage 2 lettering
 * to find words in a logo so they can be re-set as crisp satin font type instead
 * of traced from their jagged pixels. A thin async wrapper over tesseract.js,
 * which is loaded LAZILY (dynamic import) so the ~2 MB OCR engine and its language
 * model never weigh down the main bundle — they're fetched only when a user opts
 * into text recognition. Returns the plain {@link OcrWord} shape the pure
 * placement core consumes; all the embroidery logic stays testable without a
 * browser or the WASM engine.
 */
import type { OcrWord } from "./textRecognize";

/** Draw ImageData onto a fresh canvas — tesseract accepts a canvas, not raw
 *  ImageData. (Auto-digitize already holds the upload as ImageData.) */
function toCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Recognize words in a raster. Lazily spins up a tesseract worker, runs English
 * recognition with word boxes enabled, flattens the block→paragraph→line→word
 * tree to a flat word list, and always tears the worker down. On any failure
 * (model fetch blocked offline, worker error) it resolves to `[]` so text
 * recognition degrades to "no words found" rather than breaking the digitize.
 */
export async function ocrWords(image: ImageData): Promise<OcrWord[]> {
  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng");
    const canvas = toCanvas(image);
    // `blocks: true` is required for the word tree; the default output is text-only.
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const w of line.words) {
            words.push({
              text: w.text,
              confidence: w.confidence,
              bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
            });
          }
        }
      }
    }
    return words;
  } catch {
    return [];
  } finally {
    if (worker) await worker.terminate();
  }
}
