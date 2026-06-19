import {
  MousePointer2,
  Spline,
  X,
  Magnet,
  Grid2x2,
  Hand,
  Pencil,
  Paintbrush,
  PaintBucket,
  Ruler,
  Scissors,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  useEditorStore,
  isPointTool,
  type Tool,
  type RulerUnit,
} from "../store/editorStore";

/**
 * Left vertical tool rail — the tools you pick up to draw and edit, grouped Edit
 * (Select · Points · Hand · Measure) · Stitch · Helpers, each with a label, and
 * the stitch tools use custom glyphs that DEPICT the stitch they make. Adding
 * CONTENT (words · image · shapes) lives in the top bar's Insert group, not here,
 * so nothing is duplicated.
 */
export default function ToolRail() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const draft = useEditorStore((s) => s.draft);
  const clearDraft = useEditorStore((s) => s.clearDraft);
  const rulerUnit = useEditorStore((s) => s.rulerUnit);
  const setRulerUnit = useEditorStore((s) => s.setRulerUnit);
  const smooth = useEditorStore((s) => s.smooth);
  const toggleSmooth = useEditorStore((s) => s.toggleSmooth);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const guidesEnabled = useEditorStore((s) => s.guidesEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const toggleGuides = useEditorStore((s) => s.toggleGuides);
  const viewMode = useEditorStore((s) => s.viewMode);
  const locked = viewMode === "stitch"; // editing tools are inert in stitch view
  const drawing = isPointTool(tool) && draft.length > 0;

  const lockTip = "Switch to Edit view to use tools";

  return (
    // overflow-visible (not -auto): a vertical scroll container forces the cross
    // axis to clip, which hid the right-side tooltips inside the rail and flashed a
    // horizontal scrollbar. The compact two-column layout fits the kit without it.
    <aside className="flex w-28 shrink-0 flex-col gap-0.5 overflow-visible border-r-2 border-ink bg-cream py-1.5">
      <Group label="Edit">
        <ToolBtn id="select" label="Select" tip="Click to select; drag to move" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <MousePointer2 size={20} />
        </ToolBtn>
        <ToolBtn id="node" label="Points" tip="Edit points — drag to move · click outline to add · Del to remove · C = corner/curve · double-click to toggle" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <NodeGlyph />
        </ToolBtn>
        <ToolBtn id="pan" label="Hand" tip="Hand — drag to move the canvas (or hold middle mouse)" tool={tool} setTool={setTool} locked={false} lockTip={lockTip}>
          <Hand size={20} />
        </ToolBtn>
        <ToolBtn id="measure" label="Measure" tip="Measure — drag to read a distance and angle" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Ruler size={20} />
        </ToolBtn>
      </Group>

      <Rule />
      <Group label="Stitch">
        <ToolBtn id="running" label="Run" tip="Running stitch — click points, double-click to finish" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <RunningGlyph />
        </ToolBtn>
        <ToolBtn id="satin" label="Satin" tip="Satin column — draw a centerline" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <SatinGlyph />
        </ToolBtn>
        <ToolBtn id="satin2" label="Column" tip="Two-rail satin — draw edge A, then edge B (variable width)" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Satin2Glyph />
        </ToolBtn>
        <ToolBtn id="fill" label="Fill" tip="Fill an area with stitches — click an outline" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <FillGlyph />
        </ToolBtn>
        <ToolBtn id="pencil" label="Pencil" tip="Pencil — draw a freehand running stitch" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Pencil size={20} />
        </ToolBtn>
        <ToolBtn id="brush" label="Brush" tip="Brush — draw a freehand filled area" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Paintbrush size={20} />
        </ToolBtn>
        <ToolBtn id="bucket" label="Bucket" tip="Paint bucket — click an enclosed area to fill it" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <PaintBucket size={20} />
        </ToolBtn>
        <ToolBtn id="applique" label="Appliqué" tip="Appliqué — draw a shape: placement run → stop → tackdown → stop → satin cover" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Scissors size={20} />
        </ToolBtn>
        <RailBtn
          label="Curve"
          tip={locked ? lockTip : "Smooth points into a curve (Line / Satin / Fill)"}
          active={smooth && !locked}
          disabled={locked}
          onClick={() => toggleSmooth()}
        >
          <Spline size={20} />
        </RailBtn>
      </Group>

      {drawing && (
        <>
          <Rule />
          <Group label="Drawing">
            <RailBtn label="Cancel" tip="Cancel (Esc)" onClick={() => clearDraft()}>
              <X size={20} />
            </RailBtn>
          </Group>
        </>
      )}

      <Rule />
      <Group label="Helpers">
        <RailBtn
          label="Snap"
          tip={snapEnabled ? "Snapping on — click to turn off" : "Snapping off — click to turn on"}
          active={snapEnabled}
          onClick={() => toggleSnap()}
        >
          <Magnet size={20} />
        </RailBtn>
        <RailBtn
          label="Grid"
          tip={guidesEnabled ? "Gridlines on — click to turn off" : "Gridlines off — click to turn on"}
          active={guidesEnabled}
          onClick={() => toggleGuides()}
        >
          <Grid2x2 size={20} />
        </RailBtn>
      </Group>

      {/* Units toggle pinned to the bottom. */}
      <div className="mt-auto px-2 pt-2">
        <div className="flex overflow-hidden rounded-sm border-2 border-ink text-[11px]">
          {(["in", "mm"] as const).map((u) => {
            const unit: RulerUnit = u === "in" ? "inch" : "mm";
            const on = rulerUnit === unit;
            return (
              <button
                key={u}
                onClick={() => setRulerUnit(unit)}
                aria-pressed={on}
                className={`flex-1 py-1 font-label font-semibold uppercase tracking-wide ${
                  on ? "bg-ink text-cream" : "bg-cream text-ink hover:bg-butter-200"
                }`}
              >
                {u}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-1.5">
      <div className="mb-0.5 text-center font-label text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/45">
        {label}
      </div>
      {/* Two columns so the whole kit fits at a glance without scrolling. */}
      <div className="grid grid-cols-2 gap-1">{children}</div>
    </div>
  );
}

function Rule() {
  return <div className="mx-3 my-0.5 border-t border-ink/15" />;
}

/** A tool selector button (icon + label) that sets the active tool. */
function ToolBtn({
  id,
  label,
  tip,
  tool,
  setTool,
  locked,
  lockTip,
  children,
}: {
  id: Tool;
  label: string;
  tip: string;
  tool: Tool;
  setTool: (t: Tool) => void;
  locked: boolean;
  lockTip: string;
  children: ReactNode;
}) {
  const on = tool === id && !locked;
  return (
    <RailBtn label={label} tip={locked ? lockTip : tip} active={on} disabled={locked} onClick={() => setTool(id)}>
      {children}
    </RailBtn>
  );
}

/** Generic rail button: icon over an Oswald micro-label, ink active state. */
function RailBtn({
  label,
  tip,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
      data-tip-side="right"
      aria-label={label}
      aria-pressed={active}
      className={`tap-target flex w-full flex-col items-center gap-0.5 rounded-sm border-2 px-1 py-1.5 transition-[color,background-color,border-color,transform] active:translate-y-px disabled:opacity-40 ${
        active
          ? "border-ink bg-ink text-cream"
          : "border-transparent text-ink hover:border-ink/30 hover:bg-butter-200/60"
      }`}
    >
      {children}
      <span className="font-label text-[9px] font-semibold uppercase tracking-wide">
        {label}
      </span>
    </button>
  );
}

// --- custom stitch glyphs (currentColor, 2px) ------------------------------
function NodeGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 17 L12 6 L20 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2" y="15" width="4" height="4" fill="currentColor" />
      <rect x="10" y="4" width="4" height="4" fill="currentColor" />
      <rect x="18" y="13" width="4" height="4" fill="currentColor" />
    </svg>
  );
}
function RunningGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3" />
      <circle cx="3" cy="12" r="1.4" fill="currentColor" />
      <circle cx="21" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}
function SatinGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="7" y1="3" x2="7" y2="21" />
      <line x1="17" y1="3" x2="17" y2="21" />
      <line x1="7" y1="6" x2="17" y2="6" />
      <line x1="7" y1="10" x2="17" y2="10" />
      <line x1="7" y1="14" x2="17" y2="14" />
      <line x1="7" y1="18" x2="17" y2="18" />
    </svg>
  );
}
function Satin2Glyph() {
  // Two tapering rails with the column filled between — depicts variable-width satin.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 3 C 4 9, 9 15, 7 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 3 C 19 9, 14 15, 18 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="5.4" y1="6" x2="16.4" y2="6" stroke="currentColor" strokeWidth="1" opacity="0.8" />
      <line x1="7.6" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1" opacity="0.8" />
      <line x1="6.6" y1="18" x2="17.4" y2="18" stroke="currentColor" strokeWidth="1" opacity="0.8" />
    </svg>
  );
}
function FillGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <line x1="6" y1="9" x2="18" y2="9" stroke="currentColor" strokeWidth="1.3" />
      <line x1="6" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth="1.3" />
      <line x1="6" y1="15" x2="18" y2="15" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
