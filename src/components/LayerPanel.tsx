import { useMemo, useState, type MouseEvent } from "react";
import {
  GripVertical,
  Eye,
  EyeOff,
  Trash2,
  Pencil,
  PaintBucket,
  AlignJustify,
  Minus,
  ListOrdered,
  ChevronUp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { toast } from "../store/toastStore";
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
  const sortByColor = useProjectStore((s) => s.sortByColor);

  // Thread-change economy: how many color BLOCKS the current order sews vs the
  // minimum possible (one per distinct color). When they differ, offer the fix.
  const { colorBlocks, distinctColors } = useMemo(() => {
    let blocks = 0;
    let prev: string | null = null;
    const seen = new Set<string>();
    for (const o of objects) {
      if (o.colorId !== prev) {
        blocks++;
        prev = o.colorId;
      }
      seen.add(o.colorId);
    }
    return { colorBlocks: blocks, distinctColors: seen.size };
  }, [objects]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // The row currently hovered during a drag — drives the insertion line that
  // shows WHERE the dragged row will land (above it when dragging up, below when
  // dragging down).
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Anchor for Shift-range selection (the last plainly/⌘-clicked row).
  const [anchor, setAnchor] = useState<number | null>(null);
  // Inline rename: double-click a name to edit it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };
  const commitRename = () => {
    if (editingId) {
      const n = draftName.trim();
      if (n) updateObject(editingId, { name: n });
    }
    setEditingId(null);
  };
  const colorById = useMemo(
    () => new Map<string, ThreadColor>(colors.map((c) => [c.id, c])),
    [colors],
  );

  // Standard list selection: click = just this row, ⌘/Ctrl-click = toggle this
  // row in/out, Shift-click = the contiguous range from the anchor.
  const onRowClick = (e: MouseEvent, id: string, index: number) => {
    if (e.shiftKey && anchor !== null) {
      const lo = Math.min(anchor, index);
      const hi = Math.max(anchor, index);
      setSelection(objects.slice(lo, hi + 1).map((o) => o.id));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
      setSelection(next);
      setAnchor(index);
      return;
    }
    setSelection([id]);
    setAnchor(index);
  };

  return (
    <aside
      aria-label="Layers and stitch order"
      className="flex h-full w-60 shrink-0 flex-col border-r border-navy/25 bg-butter-100"
    >
      <div className="flex items-center gap-1.5 border-b border-ink/20 px-3 py-2.5 font-label text-xs font-semibold uppercase tracking-[0.18em] text-ink-deep">
        <ListOrdered size={14} className="text-ink-deep" aria-hidden /> Stitch Order
        {colorBlocks > distinctColors && (
          <button
            onClick={() => {
              sortByColor();
              toast("Re-sequenced — same-color objects now sew together", "success");
            }}
            data-tip={`Sew each color once (${colorBlocks} thread changes → ${distinctColors})`}
            data-tip-side="bottom"
            className="ml-auto rounded-sm border border-ink/40 px-1.5 py-0.5 font-label text-[9px] font-semibold uppercase tracking-[0.08em] text-ink/80 hover:bg-butter-200"
          >
            Sort by color
          </button>
        )}
      </div>

      {objects.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <ListOrdered size={22} className="text-ink/25" aria-hidden />
          <p className="font-body text-sm text-navy/80">
            Nothing stitched yet. Pick a tool and draw, or bring in an image.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {objects.map((o, index) => {
            const color = colorById.get(o.colorId);
            const selected = selectedIds.includes(o.id);
            const dropping = dragIndex !== null && dragIndex !== index && overIndex === index;
            const lineAbove = dropping && (dragIndex as number) > index;
            const lineBelow = dropping && (dragIndex as number) < index;
            return (
              <li
                key={o.id}
                draggable={editingId !== o.id}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overIndex !== index) setOverIndex(index);
                }}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== index) {
                    reorderObjects(dragIndex, index);
                  }
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                // Reset even when the drop lands outside any row, so the dragged
                // row doesn't stay dimmed.
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={`group relative flex items-center gap-2 px-2 py-1.5 text-sm transition-colors duration-150 ${
                  selected ? "bg-butter-300" : "hover:bg-butter-200/70"
                } ${dragIndex === index ? "opacity-50" : ""}`}
              >
                {(lineAbove || lineBelow) && (
                  <span
                    data-drop-indicator
                    className={`pointer-events-none absolute inset-x-1 h-0.5 rounded bg-ink ${lineAbove ? "top-0" : "bottom-0"}`}
                  />
                )}
                <GripVertical
                  size={14}
                  className="shrink-0 cursor-grab text-navy/30"
                  aria-hidden
                />
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-sm border border-navy/30"
                  style={{
                    backgroundColor: color ? `rgb(${color.rgb.join(",")})` : "#888",
                  }}
                />
                {(() => {
                  const Icon = TYPE_ICON[o.type];
                  return <Icon size={13} className="shrink-0 text-navy/60" aria-hidden />;
                })()}
                {editingId === o.id ? (
                  <input
                    autoFocus
                    value={draftName}
                    aria-label="Layer name"
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") setEditingId(null);
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="input min-w-0 flex-1 px-1 py-0.5 text-sm"
                  />
                ) : (
                  <button
                    onClick={(e) => onRowClick(e, o.id, index)}
                    onDoubleClick={() => startRename(o.id, o.name)}
                    title={`${o.name} (${o.type}) — double-click to rename`}
                    className="min-w-0 flex-1 truncate text-left text-navy"
                  >
                    {o.name}
                  </button>
                )}
                <button
                  data-tip={o.visible ? "Hide" : "Show"}
                  aria-label={o.visible ? "Hide" : "Show"}
                  onClick={() => updateObject(o.id, { visible: !o.visible })}
                  className="tap-target grid h-8 w-8 shrink-0 place-items-center rounded text-navy/70 hover:bg-butter-300/60 hover:text-navy"
                >
                  {o.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                {/* Secondary actions reveal on hover/keyboard-focus as an OVERLAY
                    anchored right, with the row background — a flex sibling ate the
                    240px row and left the name ~6px. The name keeps its full width
                    and truncates under the overlay. group-focus-within (not
                    focus-within on this hidden span — display:none is unfocusable,
                    so that selector could never fire) reveals them for keyboard
                    users tabbing to the eye button. Coarse pointers have no hover:
                    they keep the always-on cluster, same overlay treatment. */}
                <span
                  className={`absolute inset-y-0 right-9 hidden shrink-0 items-center pl-1 group-hover:flex group-focus-within:flex [@media(pointer:coarse)]:flex ${
                    selected
                      ? "bg-butter-300 shadow-[-10px_0_8px_-4px_rgba(238,213,133,0.95)]"
                      : "bg-butter-200 shadow-[-10px_0_8px_-4px_rgba(243,232,188,0.95)]"
                  }`}
                >
                  {/* Touch has no double-click, so rename also has an explicit
                      button (it doubles as a discoverable affordance on desktop). */}
                  <button
                    data-tip="Rename"
                    aria-label="Rename"
                    onClick={() => startRename(o.id, o.name)}
                    className="tap-target grid h-8 w-6 place-items-center rounded text-navy/55 hover:bg-butter-300/60 hover:text-navy"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    data-tip="Move up (stitch earlier)"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => moveOrder([o.id], "earlier")}
                    className="tap-target grid h-8 w-6 place-items-center rounded text-navy/55 hover:bg-butter-300/60 hover:text-navy disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    data-tip="Move down (stitch later)"
                    aria-label="Move down"
                    disabled={index === objects.length - 1}
                    onClick={() => moveOrder([o.id], "later")}
                    className="tap-target grid h-8 w-6 place-items-center rounded text-navy/55 hover:bg-butter-300/60 hover:text-navy disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <ChevronDown size={15} />
                  </button>
                  <button
                    data-tip="Delete"
                    aria-label="Delete"
                    onClick={() => removeObjects([o.id])}
                    className="tap-target grid h-8 w-8 place-items-center rounded text-ink/45 hover:bg-stamp/10 hover:text-stamp"
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
