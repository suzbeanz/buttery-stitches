import { useEffect, useMemo, useRef, useState } from "react";
import { PenLine, RotateCcw, Trash2 } from "lucide-react";
import type { Path, Point } from "../types/project";
import { useProjectStore } from "../store/projectStore";
import { autoCenterlines, nearestStrokePoint, tidyStroke } from "../lib/strokes";
import { pathsBounds } from "../lib/geometry";
import { generateObjectRuns } from "../lib/engine";
import { useEscapeToClose, useDialogFocus } from "./useEscapeToClose";
import { toast } from "../store/toastStore";
import { saveGlyphStrokes, normalizeStrokes } from "../lib/text/strokeLibrary";
import { splitComponents } from "../lib/engine/classify";

/**
 * HAND-AUTHORING for satin strokes: the deliberate, per-stroke control a
 * hand digitizer has. The object's outline is shown with its stroke
 * centerlines — auto-derived as the starting point — and every stroke can be
 * dragged point by point, deleted, or drawn fresh. The engine snaps authored
 * strokes to the true outline, so they only need to run roughly down the
 * middle of each stroke at the right angle. Live preview sews the result.
 */
export default function StrokeEditorDialog({
  objectId,
  onClose,
}: {
  objectId: string;
  onClose: () => void;
}) {
  const object = useProjectStore((s) => s.project.objects.find((o) => o.id === objectId));
  const updateObject = useProjectStore((s) => s.updateObject);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  useEscapeToClose(onClose);

  const [strokes, setStrokes] = useState<Path[]>(() =>
    object?.satinCenterlines?.length ? object.satinCenterlines.map((s) => [...s]) : autoCenterlines(object?.paths ?? []),
  );
  const [mode, setMode] = useState<"adjust" | "draw">("adjust");
  const [activeStroke, setActiveStroke] = useState<number | null>(null);
  const [draft, setDraft] = useState<Path>([]);
  const [preview, setPreview] = useState(true);
  const [saveToFont, setSaveToFont] = useState(false);
  const isText = !!object?.text?.fontId && !!object?.text?.content;
  const drag = useRef<{ stroke: number; point: number } | null>(null);

  const box = useMemo(() => pathsBounds(object?.paths ?? []), [object]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const CSS_W = 520, CSS_H = 380, PAD = 14;
  const view = useMemo(() => {
    if (!box) return null;
    const scale = Math.min((CSS_W - 2 * PAD) / (box.maxX - box.minX), (CSS_H - 2 * PAD) / (box.maxY - box.minY));
    return {
      scale,
      toPx: (p: Point) => ({
        x: PAD + (p.x - box.minX) * scale + (CSS_W - 2 * PAD - (box.maxX - box.minX) * scale) / 2,
        y: PAD + (p.y - box.minY) * scale + (CSS_H - 2 * PAD - (box.maxY - box.minY) * scale) / 2,
      }),
      toMm: (x: number, y: number): Point => ({
        x: box.minX + (x - PAD - (CSS_W - 2 * PAD - (box.maxX - box.minX) * scale) / 2) / scale,
        y: box.minY + (y - PAD - (CSS_H - 2 * PAD - (box.maxY - box.minY) * scale) / 2) / scale,
      }),
    };
  }, [box]);

  // Debounced preview stitches for the candidate strokes.
  const [previewRuns, setPreviewRuns] = useState<Point[][]>([]);
  useEffect(() => {
    if (!object || !preview) return;
    const t = setTimeout(() => {
      try {
        const runs = generateObjectRuns({ ...object, satinCenterlines: strokes });
        setPreviewRuns(runs.filter((r) => !r.underlay).map((r) => r.pts));
      } catch {
        setPreviewRuns([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [object, strokes, preview]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || !object) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CSS_W * dpr;
    canvas.height = CSS_H * dpr;
    canvas.style.width = `${CSS_W}px`;
    canvas.style.height = `${CSS_H}px`;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#1b2a4a";
    ctx.fillRect(0, 0, CSS_W, CSS_H);
    // Region fill, faint.
    ctx.fillStyle = "rgba(150,170,220,0.18)";
    ctx.strokeStyle = "rgba(150,170,220,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const ring of object.paths) {
      ring.forEach((p, i) => {
        const q = view.toPx(p);
        if (i === 0) ctx!.moveTo(q.x, q.y);
        else ctx!.lineTo(q.x, q.y);
      });
      ctx.closePath();
    }
    ctx.fill("evenodd");
    ctx.stroke();
    // Preview stitches under the strokes.
    if (preview) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.6;
      for (const run of previewRuns) {
        ctx.beginPath();
        run.forEach((p, i) => {
          const q = view.toPx(p);
          if (i === 0) ctx!.moveTo(q.x, q.y);
          else ctx!.lineTo(q.x, q.y);
        });
        ctx.stroke();
      }
    }
    // Strokes with point handles.
    strokes.forEach((st, si) => {
      const active = si === activeStroke;
      ctx!.strokeStyle = active ? "#ffd34d" : "#ff4d6d";
      ctx!.lineWidth = active ? 2.5 : 2;
      ctx!.beginPath();
      st.forEach((p, i) => {
        const q = view.toPx(p);
        if (i === 0) ctx!.moveTo(q.x, q.y);
        else ctx!.lineTo(q.x, q.y);
      });
      ctx!.stroke();
      for (const p of st) {
        const q = view.toPx(p);
        ctx!.fillStyle = active ? "#ffd34d" : "#ff8fa3";
        ctx!.beginPath();
        ctx!.arc(q.x, q.y, active ? 4 : 3, 0, Math.PI * 2);
        ctx!.fill();
      }
    });
    // Draft stroke being drawn.
    if (draft.length) {
      ctx.strokeStyle = "#4dd0ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      draft.forEach((p, i) => {
        const q = view.toPx(p);
        if (i === 0) ctx!.moveTo(q.x, q.y);
        else ctx!.lineTo(q.x, q.y);
      });
      ctx.stroke();
    }
  }, [object, strokes, draft, activeStroke, view, preview, previewRuns]);

  if (!object || !box || !view) return null;

  const pointerMm = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return view.toMm(e.clientX - r.left, e.clientY - r.top);
  };
  const grabRadius = 10 / view.scale;

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
        aria-label="Edit satin strokes"
        className="anim-press-in max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-sm border-[2.5px] border-ink bg-cream p-5 shadow-press outline-none"
      >
        <h2 className="mb-1 flex items-center gap-2 font-label text-lg font-semibold uppercase tracking-[0.08em] text-navy">
          <PenLine size={18} /> Edit satin strokes
        </h2>
        <p className="mb-3 font-body text-[13px] leading-snug text-navy/75">
          Each red line is one satin stroke — drag its points to steer the stitching,
          draw new strokes, or delete bad ones. Strokes only need to run roughly down
          the middle; the stitches snap to the real outline.
        </p>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Editing mode" className="flex overflow-hidden rounded-sm border-2 border-ink text-xs">
            {([
              { id: "adjust" as const, label: "Adjust" },
              { id: "draw" as const, label: "Draw stroke" },
            ]).map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                aria-selected={mode === id}
                onClick={() => {
                  setMode(id);
                  setDraft([]);
                }}
                className={`px-2.5 py-1 font-label font-semibold uppercase tracking-wide ${
                  mode === id ? "bg-ink text-cream" : "bg-cream text-ink hover:bg-butter-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              if (activeStroke === null) return;
              setStrokes((s) => s.filter((_, i) => i !== activeStroke));
              setActiveStroke(null);
            }}
            disabled={activeStroke === null}
            className="flex items-center gap-1 rounded-sm border border-ink/40 px-2 py-1 font-label text-[11px] font-semibold uppercase tracking-wide text-ink/80 hover:bg-butter-200 disabled:opacity-40"
          >
            <Trash2 size={12} /> Delete stroke
          </button>
          <button
            onClick={() => {
              setStrokes(autoCenterlines(object.paths));
              setActiveStroke(null);
            }}
            className="flex items-center gap-1 rounded-sm border border-ink/40 px-2 py-1 font-label text-[11px] font-semibold uppercase tracking-wide text-ink/80 hover:bg-butter-200"
          >
            <RotateCcw size={12} /> Reset to auto
          </button>
          <label className="ml-auto flex items-center gap-1.5 font-body text-xs text-navy">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
            Stitch preview
          </label>
          {isText && (
            <label
              className="flex w-full items-center gap-1.5 font-body text-xs text-navy"
              data-tip="Store each letter's strokes with the font, so every future use of that letter sews your version"
            >
              <input type="checkbox" checked={saveToFont} onChange={(e) => setSaveToFont(e.target.checked)} />
              Also save per-letter to this font (applies to all future text)
            </label>
          )}
        </div>

        <canvas
          ref={canvasRef}
          data-strokes={strokes.length}
          aria-label="Stroke editing canvas"
          className="touch-none rounded-sm border-2 border-ink/30"
          onPointerDown={(e) => {
            const mm = pointerMm(e);
            if (mode === "draw") {
              setDraft((d) => [...d, mm]);
              return;
            }
            const hit = nearestStrokePoint(strokes, mm, grabRadius);
            if (hit) {
              drag.current = hit;
              setActiveStroke(hit.stroke);
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            } else {
              setActiveStroke(null);
            }
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const mm = pointerMm(e);
            setStrokes((s) =>
              s.map((st, si) =>
                si === drag.current!.stroke
                  ? st.map((p, pi) => (pi === drag.current!.point ? mm : p))
                  : st,
              ),
            );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onDoubleClick={() => {
            if (mode === "draw" && draft.length >= 2) {
              setStrokes((s) => [...s, tidyStroke(draft)]);
              setDraft([]);
            }
          }}
        />
        {mode === "draw" && (
          <p className="mt-1 font-body text-xs text-navy/60">
            Click to place points along the middle of a stroke; double-click to finish it.
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-sm border-2 border-ink bg-cream px-3 py-1.5 font-label text-sm font-semibold uppercase tracking-[0.1em] text-ink hover:bg-butter-100"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              updateObject(object.id, { satinCenterlines: strokes.length ? strokes : undefined });
              if (saveToFont && isText) {
                // Split strokes per glyph COMPONENT (each letter is one
                // component of the text region), key by the typed character
                // at the same index, and store bbox-normalized — the exact
                // frame the layout maps authored strokes from.
                const comps = splitComponents(object.paths);
                const chars = Array.from(object.text!.content.replace(/\s/g, ""));
                const mid = (st: Path) => st[Math.floor(st.length / 2)];
                const inBox = (p: Point, b: { minX: number; minY: number; maxX: number; maxY: number }) =>
                  p.x >= b.minX - 0.5 && p.x <= b.maxX + 0.5 && p.y >= b.minY - 0.5 && p.y <= b.maxY + 0.5;
                const saved: string[] = [];
                comps.forEach((comp, ci) => {
                  const ch = chars[ci];
                  if (!ch) return;
                  const b = pathsBounds(comp);
                  if (!b) return;
                  const mine = strokes.filter((st) => st.length >= 2 && inBox(mid(st), b));
                  if (!mine.length) return;
                  void saveGlyphStrokes(object.text!.fontId, ch, normalizeStrokes(mine, b));
                  saved.push(ch);
                });
                if (saved.length) toast(`Saved strokes for ${saved.join(" ")} to the font`, "success");
              }
              toast(`Saved ${strokes.length} authored stroke${strokes.length === 1 ? "" : "s"}`, "success");
              onClose();
            }}
            className="rounded-sm border-2 border-ink bg-ink px-3 py-1.5 font-label text-sm font-semibold uppercase tracking-[0.1em] text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
          >
            Save strokes
          </button>
        </div>
      </div>
    </div>
  );
}
