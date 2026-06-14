import { useState } from "react";
import { useProjectStore } from "../store/projectStore";
import type { ThreadColor } from "../types/project";

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

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const colorById = new Map<string, ThreadColor>(colors.map((c) => [c.id, c]));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-navy/15 bg-butter-100">
      <div className="border-b border-navy/15 px-3 py-2 font-butter text-sm font-semibold text-navy">
        Stitch Order
      </div>

      {objects.length === 0 ? (
        <div className="px-3 py-6 text-sm text-navy/60">
          No objects yet. Pick a tool and draw, or import an image.
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto py-1">
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
                className={`group flex items-center gap-2 px-2 py-1.5 text-sm ${
                  selected ? "bg-butter-300" : "hover:bg-butter-200/70"
                } ${dragIndex === index ? "opacity-50" : ""}`}
              >
                <span className="cursor-grab select-none text-navy/30">⠿</span>
                <button
                  onClick={() => setSelection([o.id])}
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
                  <span className="flex-1 truncate text-navy">{o.name}</span>
                  <span className="text-[10px] uppercase text-navy/50">
                    {o.type}
                  </span>
                </button>
                <button
                  title={o.visible ? "Hide" : "Show"}
                  onClick={() => updateObject(o.id, { visible: !o.visible })}
                  className="px-1 text-navy/60 hover:text-navy"
                >
                  {o.visible ? "👁" : "—"}
                </button>
                <button
                  title="Delete"
                  onClick={() => removeObjects([o.id])}
                  className="px-1 text-navy/40 opacity-0 hover:text-red-600 group-hover:opacity-100"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
