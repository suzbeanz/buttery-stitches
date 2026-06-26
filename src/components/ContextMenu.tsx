import { useEffect } from "react";
import {
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  Group as GroupIcon,
  Ungroup,
  Combine,
  Split,
  Magnet,
  Spline,
  EyeOff,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  type LucideIcon,
} from "lucide-react";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { cloneObject } from "../lib/objects";
import { splitRegionComponents } from "../lib/regions";
import { toast } from "../store/toastStore";
import { clampMenu } from "./contextMenuLayout";

/** Paste/duplicate offset (mm) so copies don't land exactly on the original. */
const OFFSET_MM = 3;

type Item =
  | "sep"
  | {
      label: string;
      icon: LucideIcon;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      run: () => void;
    };

/**
 * Right-click menu for the canvas. Operates on the current selection, wiring the
 * existing store actions (so behaviour matches the keyboard shortcuts) with
 * context-sensitive enablement that mirrors the Arrange tab's guards.
 */
export default function ContextMenu({
  x,
  y,
  onClose,
}: {
  x: number;
  y: number;
  onClose: () => void;
}) {
  const objects = useProjectStore((s) => s.project.objects);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const clipboard = useEditorStore((s) => s.clipboard);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sel = objects.filter((o) => selectedIds.includes(o.id));
  const n = sel.length;
  const fills = sel.filter((o) => o.type === "fill");
  const anyGrouped = sel.some((o) => o.groupId);
  const canMerge = fills.length >= 2 && n === fills.length && new Set(fills.map((o) => o.colorId)).size === 1;
  const splitTarget = n === 1 && sel[0].type === "fill" ? sel[0] : null;
  const canSplit = !!splitTarget && splitRegionComponents(splitTarget.paths).length > 1;
  const canWeld = !!splitTarget && objects.some((o) => o.id !== splitTarget.id && o.type === "fill");

  const ps = useProjectStore.getState();
  const wrap = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const items: Item[] = [
    {
      label: "Duplicate",
      icon: CopyPlus,
      shortcut: "⌘D",
      disabled: n === 0,
      run: wrap(() => {
        ps.addObjects(sel.map((o) => cloneObject(o, OFFSET_MM, OFFSET_MM)));
        toast(`Duplicated ${n} object${n > 1 ? "s" : ""}`, "success");
      }),
    },
    {
      label: "Copy",
      icon: Copy,
      shortcut: "⌘C",
      disabled: n === 0,
      run: wrap(() => useEditorStore.getState().setClipboard(sel.map((o) => cloneObject(o)))),
    },
    {
      label: "Paste",
      icon: ClipboardPaste,
      shortcut: "⌘V",
      disabled: clipboard.length === 0,
      run: wrap(() => ps.addObjects(clipboard.map((o) => cloneObject(o, OFFSET_MM, OFFSET_MM)))),
    },
    "sep",
    { label: "Bring forward", icon: ArrowUp, shortcut: "]", disabled: n === 0, run: wrap(() => ps.moveOrder(selectedIds, "later")) },
    { label: "Send backward", icon: ArrowDown, shortcut: "[", disabled: n === 0, run: wrap(() => ps.moveOrder(selectedIds, "earlier")) },
    { label: "Bring to front", icon: ChevronsUp, disabled: n === 0, run: wrap(() => ps.moveOrder(selectedIds, "last")) },
    { label: "Send to back", icon: ChevronsDown, disabled: n === 0, run: wrap(() => ps.moveOrder(selectedIds, "first")) },
    "sep",
    { label: "Group", icon: GroupIcon, shortcut: "⌘G", disabled: n < 2, run: wrap(() => { ps.groupObjects(selectedIds); toast(`Grouped ${n} objects`, "success"); }) },
    { label: "Ungroup", icon: Ungroup, shortcut: "⌘⇧G", disabled: !anyGrouped, run: wrap(() => { ps.ungroupObjects(selectedIds); toast("Ungrouped", "info"); }) },
    "sep",
    { label: "Merge regions", icon: Combine, disabled: !canMerge, run: wrap(() => { ps.mergeObjects(selectedIds); toast(`Merged ${n} regions`, "success"); }) },
    { label: "Split into pieces", icon: Split, disabled: !canSplit, run: wrap(() => { if (splitTarget) { const c = splitRegionComponents(splitTarget.paths).length; ps.splitRegion(splitTarget.id); toast(`Split into ${c} regions`, "success"); } }) },
    { label: "Weld to neighbors", icon: Magnet, disabled: !canWeld, run: wrap(() => { if (splitTarget) { ps.weldObject(splitTarget.id); toast("Welded edge to neighbors", "success"); } }) },
    { label: "Smooth", icon: Spline, disabled: n === 0, run: wrap(() => ps.smoothObjects(selectedIds)) },
    "sep",
    { label: "Hide", icon: EyeOff, disabled: n === 0, run: wrap(() => { sel.forEach((o) => ps.updateObject(o.id, { visible: false })); }) },
    { label: "Delete", icon: Trash2, shortcut: "⌫", disabled: n === 0, danger: true, run: wrap(() => ps.removeObjects(selectedIds)) },
  ];

  // Clamp so the menu stays on-screen near every edge (the container also scrolls
  // via max-height below as a backstop on short screens).
  const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  const { left, top, maxHeight } = clampMenu(x, y, items.length, window.innerWidth, window.innerHeight, coarse);

  return (
    <>
      {/* Click/right-click anywhere else dismisses. */}
      <div
        aria-hidden
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        aria-label="Object actions"
        className="anim-press-in fixed z-50 w-52 overflow-y-auto rounded-sm border-2 border-ink bg-cream p-1 shadow-press"
        style={{ left, top, maxHeight }}
      >
        {items.map((it, i) =>
          it === "sep" ? (
            <div key={`s${i}`} className="my-1 border-t border-ink/15" />
          ) : (
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              onClick={it.run}
              className={`flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm [@media(pointer:coarse)]:py-2.5 disabled:opacity-30 ${
                it.danger ? "text-stamp hover:bg-stamp/10" : "text-navy hover:bg-butter-200"
              } disabled:hover:bg-transparent`}
            >
              <it.icon size={15} className="shrink-0" aria-hidden />
              <span className="flex-1">{it.label}</span>
              {it.shortcut && <span className="font-mono text-[10px] text-navy/40">{it.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </>
  );
}
