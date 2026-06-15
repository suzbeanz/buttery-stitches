import { MousePointer2, Spline, X, Magnet, Crosshair, Type, Image as ImageIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  useEditorStore,
  isDrawTool,
  type Tool,
  type RulerUnit,
} from "../store/editorStore";

/**
 * Left vertical tool rail — the tools you pick up to draw and edit. Grouped
 * Edit (Select · Points) and Stitch (Line · Satin · Fill · Curve), each with a
 * label, and the stitch tools use custom glyphs that DEPICT the stitch they make
 * (Fill = an area filled with rows, not a paint bucket). Adding content
 * (Picture · Words · Shape) lives in the top bar's Insert group, not here, so
 * nothing is duplicated.
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
  const setPendingStart = useEditorStore((s) => s.setPendingStart);
  const viewMode = useEditorStore((s) => s.viewMode);
  const locked = viewMode === "stitch"; // editing tools are inert in stitch view
  const drawing = isDrawTool(tool) && draft.length > 0;

  const lockTip = "Switch to Edit view to use tools";

  return (
    <aside className="flex w-[72px] shrink-0 flex-col gap-1 border-r-2 border-ink bg-cream py-2">
      <Group label="Edit">
        <ToolBtn id="select" label="Select" tip="Click to select; drag to move" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <MousePointer2 size={20} />
        </ToolBtn>
        <ToolBtn id="node" label="Points" tip="Drag a shape's points" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <NodeGlyph />
        </ToolBtn>
      </Group>

      <Rule />
      <Group label="Stitch">
        <ToolBtn id="running" label="Line" tip="Running stitch — click points, double-click to finish" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <RunningGlyph />
        </ToolBtn>
        <ToolBtn id="satin" label="Satin" tip="Satin column — draw a centerline" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <SatinGlyph />
        </ToolBtn>
        <ToolBtn id="fill" label="Fill" tip="Fill an area with stitches — click an outline" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <FillGlyph />
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
      <Group label="Make">
        <RailBtn label="Words" tip="Add lettering" disabled={locked} onClick={() => setPendingStart("text")}>
          <Type size={20} />
        </RailBtn>
        <RailBtn label="Picture" tip="Turn a picture into stitches" disabled={locked} onClick={() => setPendingStart("image")}>
          <ImageIcon size={20} />
        </RailBtn>
      </Group>

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
          label="Guides"
          tip={guidesEnabled ? "Guides on — click to turn off" : "Guides off — click to turn on"}
          active={guidesEnabled}
          onClick={() => toggleGuides()}
        >
          <Crosshair size={20} />
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
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Rule() {
  return <div className="mx-3 my-1 border-t border-ink/15" />;
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
      data-tip-align="start"
      aria-label={label}
      aria-pressed={active}
      className={`flex w-full flex-col items-center gap-0.5 rounded-sm border-2 px-1 py-1.5 transition-colors disabled:opacity-40 ${
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
