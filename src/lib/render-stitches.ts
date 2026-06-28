import type { ThreadColor } from "../types/project";
import type { RenderSegment } from "./engine/render";

/** Shade an [r,g,b] triple by a factor and return a CSS rgb() string. */
export function shadeRgb(rgb: number[], f: number): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(rgb[0])},${ch(rgb[1])},${ch(rgb[2])})`;
}

/** Deterministic fraction in [-1, 1] from an integer key — reproducible jitter,
 *  no randomness (a given design renders identically every time). */
function jitterAt(k: number): number {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Stroke a single "fiber" of a stitch run: the same polyline, but each vertex is
 * nudged a little along the LOCAL normal by a deterministic per-vertex amount, so
 * the strand visibly wanders off-center like a real twisted filament.
 */
function fiberStrand(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  px: (x: number) => number,
  py: (y: number) => number,
  amp: number,
  seed: number,
  stroke: string,
  alpha: number,
  width: number,
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const j0 = amp * jitterAt(i + seed);
    const j1 = amp * jitterAt(i + 1 + seed);
    ctx.moveTo(px(a.x) + nx * j0, py(a.y) + ny * j0);
    ctx.lineTo(px(b.x) + nx * j1, py(b.y) + ny * j1);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.stroke();
}

export interface DrawStitchesOptions {
  colorById: Map<string, ThreadColor>;
  /** World→screen transforms (mm to px), including any pan/zoom offset. */
  px: (x: number) => number;
  py: (y: number) => number;
  /** Thread thickness in px at the current zoom. */
  threadPx: number;
  /** Realistic lit/fuzzy thread vs. a flat single stroke. */
  realistic: boolean;
}

/**
 * Paint assembled stitch segments onto a 2D canvas context — the single source of
 * truth for how a stitch-out LOOKS, shared by the editor's live simulator and the
 * digitize dialog's preview so the two always match. Each stitch is a round-capped
 * capsule (overlapping capsules read as solid satin/tatami); in realistic mode each
 * thread is a shaded, lit tube with a downy fuzz halo and two wandering fibers.
 *
 * Works on any `CanvasRenderingContext2D` (the Konva simulator passes its layer's
 * underlying native context; the dialog passes its own offscreen/visible canvas).
 */
export function drawStitches(
  ctx: CanvasRenderingContext2D,
  segs: RenderSegment[],
  { colorById, px, py, threadPx, realistic }: DrawStitchesOptions,
): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // In realistic mode the lit core is offset toward an upper-left light source.
  const od = realistic ? -threadPx * 0.16 : 0;
  for (const seg of segs) {
    if (seg.points.length < 2) continue;
    const c = colorById.get(seg.colorId);
    const rgb = c ? c.rgb : [136, 136, 136];
    const path = (dx: number, dy: number) => {
      ctx.beginPath();
      for (let i = 1; i < seg.points.length; i++) {
        ctx.moveTo(px(seg.points[i - 1].x) + dx, py(seg.points[i - 1].y) + dy);
        ctx.lineTo(px(seg.points[i].x) + dx, py(seg.points[i].y) + dy);
      }
    };
    if (seg.underlay) {
      path(0, 0);
      ctx.strokeStyle = shadeRgb(rgb, 1);
      ctx.lineWidth = 0.6;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
    } else if (realistic) {
      // FUZZ HALO: a soft, wider, low-alpha pass gives each thread a downy edge.
      path(0, 0);
      ctx.strokeStyle = shadeRgb(rgb, 0.82);
      ctx.lineWidth = threadPx * 1.42;
      ctx.globalAlpha = 0.22;
      ctx.stroke();
      // body (shaded sides)
      path(0, 0);
      ctx.strokeStyle = shadeRgb(rgb, 0.72);
      ctx.lineWidth = threadPx;
      ctx.globalAlpha = 1;
      ctx.stroke();
      // lit core, offset toward the light
      path(od, od);
      ctx.strokeStyle = shadeRgb(rgb, 1.16);
      ctx.lineWidth = threadPx * 0.5;
      ctx.globalAlpha = 0.92;
      ctx.stroke();
      // FIBER STRANDS: two thin lines wandering off the centerline, one lit, one
      // in shadow — the twisted, multi-filament look of real thread.
      fiberStrand(ctx, seg.points, px, py, threadPx * 0.22, 11, shadeRgb(rgb, 1.34), 0.42, threadPx * 0.16);
      fiberStrand(ctx, seg.points, px, py, threadPx * 0.2, 41, shadeRgb(rgb, 0.86), 0.42, threadPx * 0.16);
    } else {
      path(0, 0);
      ctx.strokeStyle = shadeRgb(rgb, 1);
      ctx.lineWidth = threadPx;
      ctx.globalAlpha = 0.95;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
