import {
  MousePointer2,
  PenTool,
  Minus,
  AlignJustify,
  PaintBucket,
  Spline,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEditorStore,
  isDrawTool,
  type Tool,
  type RulerUnit,
} from "../store/editorStore";

/**
 * Horizontal tool strip above the canvas: pick the active tool, toggle ruler
 * units, and (while drawing) finish or cancel the in-progress shape. Manual
 * digitizing is first-class — every tool here works without auto-digitize.
 */

const TOOLS: { id: Tool; label: string; hint: string; Icon: LucideIcon }[] = [
  { id: "select", label: "Select", hint: "Click to select; drag to move; handles to scale/rotate", Icon: MousePointer2 },
  { id: "node", label: "Node", hint: "Select an object, then drag its vertices", Icon: PenTool },
  { id: "running", label: "Running", hint: "Click to place points; double-click to finish", Icon: Minus },
  { id: "satin", label: "Satin", hint: "Draw a centerline; double-click to finish", Icon: AlignJustify },
  { id: "fill", label: "Fill", hint: "Click a polygon outline; double-click to finish", Icon: PaintBucket },
];

export default function ToolStrip() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const draft = useEditorStore((s) => s.draft);
  const clearDraft = useEditorStore((s) => s.clearDraft);
  const rulerUnit = useEditorStore((s) => s.rulerUnit);
  const setRulerUnit = useEditorStore((s) => s.setRulerUnit);
  const smooth = useEditorStore((s) => s.smooth);
  const toggleSmooth = useEditorStore((s) => s.toggleSmooth);

  const viewMode = useEditorStore((s) => s.viewMode);
  const active = TOOLS.find((t) => t.id === tool)!;
  const drawing = isDrawTool(tool);
  const locked = viewMode === "stitch"; // editing tools are inert in stitch view

  return (
    <div className="flex items-center gap-1 border-b border-navy/15 bg-butter-100 px-2 py-1.5">
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          data-tip={locked ? "Switch to Edit view to use tools" : label}
          aria-label={label}
          aria-pressed={tool === id && !locked}
          onClick={() => setTool(id)}
          disabled={locked}
          className={`grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:opacity-40 ${
            tool === id && !locked
              ? "bg-navy text-butter-200"
              : "text-navy hover:bg-butter-300/60 disabled:hover:bg-transparent"
          }`}
        >
          <Icon size={17} />
        </button>
      ))}

      <div className="mx-1 h-5 w-px bg-navy/15" />

      {/* Curve / smooth toggle — applies to the running, satin and fill tools. */}
      <button
        data-tip={
          locked
            ? "Switch to Edit view to use tools"
            : "Smooth points into a curve (use with Running / Satin / Fill)"
        }
        aria-label="Curve"
        aria-pressed={smooth && !locked}
        onClick={() => toggleSmooth()}
        disabled={locked}
        className={`grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:opacity-40 ${
          smooth && !locked
            ? "bg-navy text-butter-200"
            : "text-navy hover:bg-butter-300/60 disabled:hover:bg-transparent"
        }`}
      >
        <Spline size={17} />
      </button>

      <div className="mx-1 h-5 w-px bg-navy/15" />

      {/* Ruler unit toggle */}
      <div className="flex overflow-hidden rounded-lg border border-navy/20 text-xs">
        {(["inch", "mm"] as RulerUnit[]).map((u) => (
          <button
            key={u}
            onClick={() => setRulerUnit(u)}
            className={`px-2 py-1 ${
              rulerUnit === u
                ? "bg-navy text-butter-200"
                : "bg-butter-50 text-navy hover:bg-butter-200"
            }`}
          >
            {u}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <span className="hidden text-xs text-navy/60 md:inline">{active.hint}</span>

      {drawing && draft.length > 0 && (
        <button
          onClick={() => clearDraft()}
          data-tip="Cancel (Esc)"
          aria-label="Cancel"
          className="ml-1 grid h-8 w-8 place-items-center rounded-lg text-navy hover:bg-butter-300/60"
        >
          <X size={17} />
        </button>
      )}
    </div>
  );
}
