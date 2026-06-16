import { useMemo, useState } from "react";
import {
  GripVertical,
  Eye,
  EyeOff,
  Trash2,
  PaintBucket,
  AlignJustify,
  Minus,
  ListOrdered,
  ChevronUp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import type { StitchType, ThreadColor } from "../types/project";

/** Small glyph for each stitch type, matching the tool strip's icons. */
const TYPE_ICON: Record<StitchType, LucideIcon> = {
  fill: PaintBucket,
  satin: AlignJustify,
  running: Minus,
};

/**
 * Left panel: one row per object, top-to-bottom = stitch order. Drag a row to
 * reorder (which reorders the stitch sequence), toggle visibility, or delete.
 */
export default function LayerPanel() {
  const objects = useProjectStore((s) => s.project.objects);
  const colors = useProjectStore((s) => s.project.colors);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const setSelection = useProjectStore((s) => s.setSelection);
  const updateObject = useProjectStore((s) => s.updateObject);
  const removeObjects = useProjectStore((s) => s.removeObjects);
  const reorderObjects = useProjectStore((s) => s.reorderObjects);
  const moveOrder = useProjectStore((s) => s.moveOrder);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const colorById = useMemo(
    () => new Map<string, ThreadColor>(colors.map((c) => [c.id, c])),
    [colors],
  );

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-navy/25 bg-butter-100">
      <div className="flex items-center gap-1.5 border-b border-ink/20 px-3 py-2.5 font-label text-xs font-semibold uppercase tracking-[0.18em] text-ink-deep">
        <ListOrdered size={14} className="text-ink-deep" aria-hidden /> Stitch Order
      </div>

      {objects.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <ListOrdered size={22} className="text-ink/25" aria-hidden />
          <p className="font-body text-sm text-navy/60">
            Nothing stitched yet. Pick a tool and draw, or bring in an image.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {objects.map((o, index) => {
            const color = colorById.get(o.colorId);
            const selected = selectedIds.includes(o.id);
            return (
              <li
                key={o.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== index) {
                    reorderObjects(dragIndex, index);
                  }
                  setDragIndex(null);
                }}
                className={`group flex items-center gap-2 px-2 py-1.5 text-sm transition-colors duration-150 ${
                  selected ? "bg-butter-300" : "hover:bg-butter-200/70"
                } ${dragIndex === index ? "opacity-50" : ""}`}
              >
                <GripVertical
                  size={14}
                  className="shrink-0 cursor-grab text-navy/30"
                  aria-hidden
                />
                <button
                  onClick={() => setSelection([o.id])}
                  title={o.type}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border border-navy/30"
                    style={{
                      backgroundColor: color
                        ? `rgb(${color.rgb.join(",")})`
                        : "#888",
                    }}
                  />
                  {(() => {
                    const Icon = TYPE_ICON[o.type];
                    return <Icon size={13} className="shrink-0 text-navy/60" aria-hidden />;
                  })()}
                  <span className="flex-1 truncate text-navy">{o.name}</span>
                </button>
                <button
                  data-tip="Move up (stitch earlier)"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => moveOrder([o.id], "earlier")}
                  className="grid h-8 w-7 place-items-center rounded text-navy/55 hover:bg-butter-300/60 hover:text-navy disabled:opacity-25 disabled:hover:bg-transparent"
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  data-tip="Move down (stitch later)"
                  aria-label="Move down"
                  disabled={index === objects.length - 1}
                  onClick={() => moveOrder([o.id], "later")}
                  className="grid h-8 w-7 place-items-center rounded text-navy/55 hover:bg-butter-300/60 hover:text-navy disabled:opacity-25 disabled:hover:bg-transparent"
                >
                  <ChevronDown size={15} />
                </button>
                <button
                  data-tip={o.visible ? "Hide" : "Show"}
                  aria-label={o.visible ? "Hide" : "Show"}
                  onClick={() => updateObject(o.id, { visible: !o.visible })}
                  className="grid h-8 w-8 place-items-center rounded text-navy/70 hover:bg-butter-300/60 hover:text-navy"
                >
                  {o.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button
                  data-tip="Delete"
                  aria-label="Delete"
                  onClick={() => removeObjects([o.id])}
                  className="grid h-8 w-8 place-items-center rounded text-ink/45 opacity-0 hover:bg-stamp/10 hover:text-stamp group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
