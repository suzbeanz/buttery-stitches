import { useEffect, useMemo, useRef, useState } from "react";
import type { Font } from "opentype.js";
import { Type } from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { FONTS, DEFAULT_FONT_ID, loadFont } from "../lib/text/fonts";
import { listCustomFonts, type CustomFontMeta } from "../lib/text/customFonts";
import { retypeToBox, suggestVertical, suggestEmboldenMm } from "../lib/text/retype";
import { pathsBounds } from "../lib/geometry";
import { generateDesign } from "../lib/engine";
import { designToSegments } from "../lib/engine/render";
import { drawStitches } from "../lib/render-stitches";
import { createEmptyProject } from "../lib/project";
import { useEscapeToClose, useDialogFocus } from "./useEscapeToClose";
import { toast } from "../store/toastStore";

/**
 * RE-SET AS TEXT: replace the selected traced lettering with authored type
 * fitted to its exact footprint. Traced letterforms come out eroded and
 * ragged — no stitch engine makes bad geometry look good; setting the words
 * in a real font is the professional fix, and this dialog is that operation
 * on any selection.
 */
export default function RetypeTextDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const replaceObjects = useProjectStore((s) => s.replaceObjects);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  useEscapeToClose(onClose);

  const selected = useMemo(
    () => project.objects.filter((o) => selectedIds.includes(o.id)),
    [project.objects, selectedIds],
  );
  const box = useMemo(() => {
    const b = pathsBounds(selected.flatMap((o) => o.paths));
    return b ? { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY } : null;
  }, [selected]);

  const [text, setText] = useState("");
  const [fontId, setFontId] = useState(DEFAULT_FONT_ID);
  const [font, setFont] = useState<Font | null>(null);
  // User-imported faces (a purchased embroidery font, a brand face) join the
  // picker — loadFont already resolves `user-…` ids from the browser store.
  const [customFonts, setCustomFonts] = useState<CustomFontMeta[]>([]);
  useEffect(() => {
    let alive = true;
    listCustomFonts().then((f) => alive && setCustomFonts(f)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [vertical, setVertical] = useState(() => (box ? suggestVertical(box) : false));
  const [weight, setWeight] = useState<0 | 0.1 | 0.2>(() =>
    box && suggestEmboldenMm(box, vertical) > 0 ? 0.1 : 0,
  );
  const [spacing, setSpacing] = useState(0);

  useEffect(() => {
    let alive = true;
    loadFont(fontId).then((f) => alive && setFont(f)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [fontId]);

  const candidate = useMemo(() => {
    if (!font || !box || !text.trim() || !selected.length) return null;
    return retypeToBox({
      text: text.trim(),
      font,
      box,
      vertical,
      letterSpacingMm: spacing,
      emboldenMm: weight,
      colorId: selected[0].colorId,
      baseParams: selected[0].params,
    });
  }, [font, box, text, vertical, spacing, weight, selected]);

  // Live stitch preview of the candidate, same pattern as auto-digitize.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candidate) return;
    const b = pathsBounds(candidate.paths);
    if (!b) return;
    const design = generateDesign({
      ...createEmptyProject(),
      colors: project.colors,
      objects: [{ ...candidate, visible: true }],
    });
    const segs = designToSegments(design);
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;
    const cssW = 360, cssH = 200;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#20335c";
    ctx.fillRect(0, 0, cssW, cssH);
    const pad = 8;
    const scale = Math.min((cssW - pad * 2) / (b.maxX - b.minX), (cssH - pad * 2) / (b.maxY - b.minY));
    const ox = (cssW - (b.maxX - b.minX) * scale) / 2;
    const oy = (cssH - (b.maxY - b.minY) * scale) / 2;
    const colorById = new Map(project.colors.map((c) => [c.id, c]));
    drawStitches(ctx, segs, {
      colorById,
      px: (x: number) => ox + (x - b.minX) * scale,
      py: (y: number) => oy + (y - b.minY) * scale,
      threadPx: Math.max(1.2, 0.4 * scale),
      realistic: true,
    });
  }, [candidate, project.colors]);

  const stitchable = !!candidate && candidate.paths.length > 0;
  return (
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
        aria-label="Re-set as text"
        className="anim-press-in max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-5 shadow-press outline-none"
      >
        <h2 className="mb-1 flex items-center gap-2 font-label text-lg font-semibold uppercase tracking-[0.08em] text-navy">
          <Type size={18} /> Re-set as text
        </h2>
        <p className="mb-4 font-body text-[13px] leading-snug text-navy/75">
          Replace the selected traced lettering with clean type, fitted to the same
          spot. Traced letters sew ragged — real fonts sew crisp.
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block font-label text-xs font-semibold uppercase tracking-wide text-navy/70">
            The words
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What do the traced letters say?"
            autoFocus
            className="w-full rounded-sm border-2 border-ink bg-white px-2 py-1.5 font-body text-sm text-ink outline-none focus:border-butter-500"
          />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block font-label text-xs font-semibold uppercase tracking-wide text-navy/70">
              Font
            </span>
            <select
              value={fontId}
              onChange={(e) => setFontId(e.target.value)}
              className="w-full rounded-sm border-2 border-ink bg-white px-2 py-1.5 font-body text-sm text-ink"
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
          <label className="block">
            <span className="mb-1 block font-label text-xs font-semibold uppercase tracking-wide text-navy/70">
              Weight
            </span>
            <select
              value={String(weight)}
              onChange={(e) => setWeight(Number(e.target.value) as 0 | 0.1 | 0.2)}
              className="w-full rounded-sm border-2 border-ink bg-white px-2 py-1.5 font-body text-sm text-ink"
            >
              <option value="0">Normal</option>
              <option value="0.1">Bolder (small text)</option>
              <option value="0.2">Boldest</option>
            </select>
          </label>
        </div>

        <div className="mb-3 flex items-center gap-4">
          <label className="flex items-center gap-2 font-body text-sm text-navy">
            <input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} />
            Vertical (reads downward)
          </label>
          <label className="flex items-center gap-2 font-body text-sm text-navy">
            Spacing
            <input
              type="range"
              min={-0.5}
              max={2}
              step={0.1}
              value={spacing}
              onChange={(e) => setSpacing(Number(e.target.value))}
              aria-label="Letter spacing (mm)"
            />
          </label>
        </div>

        <div className="mb-4 grid place-items-center rounded-sm border-2 border-ink/20 bg-navy/90 py-2">
          {stitchable ? (
            <canvas ref={canvasRef} aria-label="Stitch preview of the re-set text" />
          ) : (
            <div className="px-4 py-10 font-body text-sm text-cream/70">
              Type the words to preview their stitches.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-sm border-2 border-ink bg-cream px-3 py-1.5 font-label text-sm font-semibold uppercase tracking-[0.1em] text-ink hover:bg-butter-100"
          >
            Cancel
          </button>
          <button
            disabled={!stitchable}
            onClick={() => {
              if (!candidate) return;
              replaceObjects(selectedIds, [candidate]);
              toast(`Re-set ${selected.length} traced object${selected.length > 1 ? "s" : ""} as “${text.trim()}”`, "success");
              onClose();
            }}
            className="rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-sm font-semibold uppercase tracking-[0.1em] text-cream shadow-press-sm transition-transform enabled:hover:bg-ink-deep enabled:active:translate-y-[2px] enabled:active:shadow-none disabled:opacity-40"
          >
            Replace
          </button>
        </div>
      </div>
    </div>
  );
}
