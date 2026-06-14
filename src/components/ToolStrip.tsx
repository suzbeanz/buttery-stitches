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

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click to select; drag to move; handles to scale/rotate" },
  { id: "node", label: "Node", hint: "Select an object, then drag its vertices" },
  { id: "running", label: "Running", hint: "Click to place points; double-click to finish" },
  { id: "satin", label: "Satin", hint: "Draw a centerline; double-click to finish" },
  { id: "fill", label: "Fill", hint: "Click a polygon outline; double-click to finish" },
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
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={locked ? "Switch to Edit view to use tools" : t.hint}
          onClick={() => setTool(t.id)}
          disabled={locked}
          className={`rounded px-2.5 py-1 text-sm transition-colors disabled:opacity-40 ${
            tool === t.id && !locked
              ? "bg-navy text-butter-200"
              : "text-navy hover:bg-butter-300/60 disabled:hover:bg-transparent"
          }`}
        >
          {t.label}
        </button>
      ))}

      <div className="mx-2 h-5 w-px bg-navy/15" />

      {/* Curve / smooth toggle — applies to the running, satin and fill tools. */}
      <button
        title={
          locked
            ? "Switch to Edit view to use tools"
            : "Smooth placed points into a curve while drawing"
        }
        aria-pressed={smooth && !locked}
        onClick={() => toggleSmooth()}
        disabled={locked}
        className={`rounded px-2.5 py-1 text-sm transition-colors disabled:opacity-40 ${
          smooth && !locked
            ? "bg-navy text-butter-200"
            : "text-navy hover:bg-butter-300/60 disabled:hover:bg-transparent"
        }`}
      >
        Curve
      </button>

      <div className="mx-2 h-5 w-px bg-navy/15" />

      {/* Ruler unit toggle */}
      <div className="flex overflow-hidden rounded border border-navy/20 text-xs">
        {(["mm", "inch"] as RulerUnit[]).map((u) => (
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

      {drawing ? (
        <>
          <span className="mr-2 text-xs text-navy/70">{active.hint}</span>
          {draft.length > 0 && (
            <button
              onClick={() => clearDraft()}
              className="rounded px-2 py-1 text-xs text-navy hover:bg-butter-300/60"
            >
              Cancel (Esc)
            </button>
          )}
        </>
      ) : (
        <span className="mr-1 text-xs text-navy/60">{active.hint}</span>
      )}
    </div>
  );
}
