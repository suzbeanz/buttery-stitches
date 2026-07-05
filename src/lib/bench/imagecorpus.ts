import type { RasterImage } from "../trace/quantize";

/**
 * SYNTHETIC image corpus for the auto-digitize pipeline — one image per
 * structural class of input users actually feed the digitizer. Each is built
 * programmatically (reproducible, nothing copyrighted) and carries the
 * EXPECTATIONS the pipeline must meet on it. The pipeline gate test runs every
 * one end-to-end (quantize → trace → engine) and asserts the expectations, so
 * a change that fixes one class can't silently break another.
 */

export interface CorpusImage {
  name: string;
  /** why this image is in the corpus / what it stresses. */
  stresses: string;
  image: RasterImage;
  /** color count to request from the pipeline (what the dialog would use). */
  colors: number;
  /** mm per pixel (what the dialog would use for this asset). */
  mmPerPx: number;
  /** inclusive range of FOREGROUND colors that must survive the trace. */
  expectColors: [number, number];
  /** hues (loose RGB predicates) that must each survive as a distinct color. */
  mustKeep?: Array<{ name: string; test: (rgb: [number, number, number]) => boolean }>;
  /** true when the background must NOT survive as an object (removal on). */
  removeBackground: boolean;
  /** max total area (mm²) of background-colored objects allowed to survive. */
  maxBackgroundAreaMm2?: number;
}

type RGBA = [number, number, number, number];

function build(w: number, h: number, paint: (x: number, y: number) => RGBA): RasterImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  return { width: w, height: h, data };
}

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
};

/** Deterministic per-pixel pseudo-noise in [-n, n] (no Math.random — reproducible). */
const noise = (x: number, y: number, n: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (v - Math.floor(v) - 0.5) * 2 * n;
};

const reds = (rgb: [number, number, number]) => rgb[0] > 170 && rgb[1] < 110 && rgb[2] < 110;
const yellows = (rgb: [number, number, number]) => rgb[0] > 170 && rgb[1] > 140 && rgb[2] < 120;
const greens = (rgb: [number, number, number]) => rgb[1] > 110 && rgb[0] < 120 && rgb[2] < 120;
const blues = (rgb: [number, number, number]) => rgb[2] > 140 && rgb[0] < 120;
const darks = (rgb: [number, number, number]) => rgb[0] < 90 && rgb[1] < 90 && rgb[2] < 90;

export function corpusImages(): CorpusImage[] {
  const out: CorpusImage[] = [];

  // 1. Flat few-color logo on an opaque white page — the bread-and-butter input.
  out.push({
    name: "flat-logo",
    stresses: "clean flat regions, opaque background removal, all hues kept",
    colors: 4,
    mmPerPx: 0.4,
    expectColors: [3, 4],
    removeBackground: true,
    maxBackgroundAreaMm2: 30,
    mustKeep: [
      { name: "red", test: reds },
      { name: "green", test: greens },
      { name: "blue", test: blues },
    ],
    image: build(160, 120, (x, y) => {
      if (inEllipse(x, y, 55, 60, 34, 34)) return [210, 40, 40, 255];
      if (x >= 95 && x < 140 && y >= 25 && y < 60) return [40, 150, 60, 255];
      if (x >= 95 && x < 140 && y >= 68 && y < 100) return [40, 70, 200, 255];
      return [255, 255, 255, 255];
    }),
  });

  // 2. Clipart on a white CARD with transparent margins — the downloaded-image layout.
  out.push({
    name: "card-clipart",
    stresses: "card stripping, palette slots not eaten, distinct hues survive",
    colors: 4,
    mmPerPx: 0.4,
    expectColors: [3, 4],
    removeBackground: true,
    maxBackgroundAreaMm2: 30,
    mustKeep: [
      { name: "red", test: reds },
      { name: "yellow", test: yellows },
      { name: "green", test: greens },
    ],
    image: build(200, 100, (x, y) => {
      if (x < 50 || x >= 150) return [0, 0, 0, 0]; // transparent margins
      if (inEllipse(x, y, 100, 70, 40, 18)) return [45, 160, 65, 255];
      if (x >= 72 && x < 78 && y >= 12 && y < 70) return [250, 200, 40, 255];
      if (x >= 78 && x < 108 && y >= 14 && y < 34 && x - 78 < 30 - Math.abs(y - 24) * 2.6)
        return [225, 40, 45, 255];
      return [255, 255, 255, 255]; // the card
    }),
  });

  // 3. Noisy scan/JPEG-ish clipart — per-pixel noise on flat regions.
  out.push({
    name: "noisy-clipart",
    stresses: "compression noise: despeckle without shattering regions",
    colors: 3,
    mmPerPx: 0.4,
    expectColors: [2, 3],
    removeBackground: true,
    mustKeep: [
      { name: "red", test: reds },
      { name: "blue", test: blues },
    ],
    image: build(140, 140, (x, y) => {
      const j = (v: number) => Math.max(0, Math.min(255, Math.round(v + noise(x, y, 14))));
      if (inEllipse(x, y, 70, 60, 40, 32)) return [j(205), j(45), j(45), 255];
      if (x >= 45 && x < 95 && y >= 100 && y < 125) return [j(45), j(70), j(200), 255];
      return [j(250), j(250), j(248), 255];
    }),
  });

  // 4. Line art — a thin-stroke outline drawing (window frame), no solid areas.
  out.push({
    name: "line-art",
    stresses: "thin connected network → centerline stitching, not phantom fills",
    colors: 2,
    mmPerPx: 0.35,
    expectColors: [1, 2],
    removeBackground: true,
    mustKeep: [{ name: "dark", test: darks }],
    image: build(140, 140, (x, y) => {
      const onFrame =
        (x >= 20 && x < 120 && y >= 20 && y < 120 &&
          (x < 26 || x >= 114 || y < 26 || y >= 114)) ||
        (x >= 67 && x < 73 && y >= 20 && y < 120) ||
        (y >= 67 && y < 73 && x >= 20 && x < 120);
      return onFrame ? [30, 30, 34, 255] : [255, 255, 255, 255];
    }),
  });

  // 5. Many-color badge — 6 distinct hues + background; thread-change pressure.
  out.push({
    name: "many-color",
    stresses: "6 distinct hues all survive; sane object/thread-change counts",
    colors: 6,
    mmPerPx: 0.4,
    expectColors: [5, 6],
    removeBackground: true,
    mustKeep: [
      { name: "red", test: reds },
      { name: "green", test: greens },
      { name: "blue", test: blues },
      { name: "yellow", test: yellows },
    ],
    image: build(180, 120, (x, y) => {
      const cells: RGBA[] = [
        [210, 40, 40, 255],
        [40, 150, 60, 255],
        [40, 70, 200, 255],
        [245, 195, 40, 255],
        [140, 60, 170, 255],
        [35, 35, 40, 255],
      ];
      const col = Math.floor((x - 20) / 47);
      const row = Math.floor((y - 20) / 42);
      if (x >= 20 && x < 161 && y >= 20 && y < 104 && col >= 0 && col < 3 && row >= 0 && row < 2) {
        // rounded cells with a white gutter between them
        const cx = 20 + col * 47 + 21;
        const cy = 20 + row * 42 + 19;
        if (inEllipse(x, y, cx, cy, 19, 17)) return cells[row * 3 + col];
      }
      return [255, 255, 255, 255];
    }),
  });

  // 6. Tiny high-contrast features on a big field — an eye/hole must survive.
  out.push({
    name: "tiny-features",
    stresses: "small dark features on a dominant field survive quantize + trace + engine",
    colors: 3,
    mmPerPx: 0.4,
    expectColors: [2, 3],
    removeBackground: true,
    mustKeep: [
      { name: "field", test: (rgb) => rgb[0] > 170 && rgb[1] > 120 && rgb[1] < 200 },
      { name: "dark features", test: darks },
    ],
    image: build(160, 120, (x, y) => {
      if (inEllipse(x, y, 80, 60, 60, 44)) {
        if (inEllipse(x, y, 60, 50, 6, 8)) return [25, 22, 20, 255]; // eye
        if (inEllipse(x, y, 100, 50, 6, 8)) return [25, 22, 20, 255]; // eye
        if (inEllipse(x, y, 80, 80, 10, 6)) return [25, 22, 20, 255]; // mouth
        return [225, 170, 120, 255]; // the face
      }
      return [252, 252, 252, 255];
    }),
  });

  // 7. Subject running off the image border — background slot must survive.
  out.push({
    name: "border-touching",
    stresses: "subject touches the border; background keeps its palette slot",
    colors: 3,
    mmPerPx: 0.4,
    expectColors: [2, 3],
    removeBackground: true,
    mustKeep: [
      { name: "green", test: greens },
      { name: "red", test: reds },
    ],
    image: build(160, 100, (x, y) => {
      if (inEllipse(x, y, 80, 100, 95, 45)) return [45, 160, 65, 255]; // hill off 3 edges
      if (inEllipse(x, y, 80, 30, 16, 16)) return [210, 40, 40, 255]; // sun
      return [255, 255, 255, 255];
    }),
  });

  // 8. Soft gradient blob — the photo-ish stress; must quantize to sane bands,
  // not shatter into confetti.
  out.push({
    name: "gradient-blob",
    stresses: "smooth shading: bands consolidate instead of shattering",
    colors: 4,
    mmPerPx: 0.4,
    expectColors: [2, 4],
    removeBackground: true,
    image: build(140, 140, (x, y) => {
      if (!inEllipse(x, y, 70, 70, 52, 52)) return [255, 255, 255, 255];
      const d = Math.hypot(x - 55, y - 55) / 74; // off-center highlight
      const t = Math.max(0, Math.min(1, d));
      return [Math.round(215 - 140 * t), Math.round(70 - 30 * t), Math.round(60 - 25 * t), 255];
    }),
  });

  return out;
}
