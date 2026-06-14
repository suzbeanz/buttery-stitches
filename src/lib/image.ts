/**
 * Browser image helpers. Loading happens entirely client-side via a canvas —
 * the uploaded image never leaves the machine.
 */

/**
 * Decode an image File and return its pixels as ImageData, downscaled so the
 * longest side is at most `maxDim` (keeps tracing fast and memory sane).
 */
export async function loadImageData(file: File, maxDim = 512): Promise<ImageData> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode that image."));
      el.src = url;
    });

    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}
