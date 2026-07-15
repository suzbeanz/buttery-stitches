import {
  MousePointer2,
  Spline,
  X,
  Magnet,
  Grid2x2,
  Hand,
  Pencil,
  Paintbrush,
  Ruler,
  Scissors,
  Slice,
  Compass,
  Eye,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  useEditorStore,
  isPointTool,
  type Tool,
  type RulerUnit,
} from "../store/editorStore";

/**
 * Tool rail — the tools you pick up to draw and edit, grouped Edit
 * (Select · Points · Hand · Measure) · Stitch · Helpers, each with a label, and
 * the stitch tools use custom glyphs that DEPICT the stitch they make. Adding
 * CONTENT (words · image · shapes) lives in the top bar's Insert group, not here,
 * so nothing is duplicated.
 *
 * ONE component, two orientations (same buttons, handlers and aria — only CSS
 * reflows): at lg+ it's the classic left vertical column; below lg it's a
 * horizontal, swipe-scrollable strip pinned above the SimulatorBar, so a phone's
 * canvas isn't crushed by a fixed side column. The Studio grid in App.tsx places
 * it via the col/row-start classes below.
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
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const locked = viewMode === "stitch"; // editing tools are inert in stitch view
  const drawing = isPointTool(tool) && draft.length > 0;

  const lockTip = "Switch to Edit view to use tools";

  return (
    // Below lg: a horizontal overflow-x-auto bottom strip (grid row 2, above the
    // SimulatorBar) that swipes sideways through the kit. At lg+: the vertical
    // left column, overflow-visible (not -auto) so the right-side tooltips
    // aren't clipped — the compact two-column layout fits the kit without it.
    <aside
      aria-label="Drawing tools"
      className="col-start-1 row-start-2 flex min-w-0 flex-row gap-0.5 overflow-x-auto border-t-2 border-ink bg-cream px-1 py-1 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:w-28 lg:flex-col lg:overflow-visible lg:border-r-2 lg:border-t-0 lg:px-0 lg:py-1.5"
    >
      {/* Phones: the Edit/Stitch switch lives HERE (always in reach, first in
          the strip) and the SimulatorBar row disappears in edit view — a whole
          row was spent on this one toggle. At lg+ the switch stays in the
          SimulatorBar as always. */}
      <div className="flex shrink-0 items-center self-center px-1 lg:hidden">
        <div className="flex overflow-hidden rounded-sm border-2 border-ink">
          {([
            { m: "edit" as const, label: "Edit", Icon: Pencil },
            { m: "stitch" as const, label: "Stitch view", Icon: Eye },
          ]).map(({ m, label, Icon }) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              aria-label={label}
              aria-pressed={viewMode === m}
              className={`tap-target grid h-10 w-10 place-items-center ${
                viewMode === m ? "bg-ink text-cream" : "bg-cream text-ink hover:bg-butter-200"
              }`}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      </div>
      {locked && (
        <div className="mx-1.5 w-24 shrink-0 self-center rounded-sm bg-butter-200 px-1 py-1 text-center font-label text-[9px] font-semibold uppercase leading-tight tracking-wide text-ink/70 lg:mb-1 lg:w-auto lg:self-auto">
          Stitch view — tools paused
        </div>
      )}
      <Group label="Edit">
        <ToolBtn id="select" label="Select" shortcut="V" tip="Select & move shapes" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <MousePointer2 size={20} />
        </ToolBtn>
        <ToolBtn id="node" label="Points" shortcut="N" tip="Edit points — reshape a path" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <NodeGlyph />
        </ToolBtn>
        <ToolBtn id="pan" label="Hand" shortcut="H" tip="Pan the canvas" tool={tool} setTool={setTool} locked={false} lockTip={lockTip}>
          <Hand size={20} />
        </ToolBtn>
        <ToolBtn id="measure" label="Measure" shortcut="M" tip="Measure distance & angle" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Ruler size={20} />
        </ToolBtn>
        <ToolBtn id="cut" label="Cut" shortcut="X" tip="Cut a running line in two" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Slice size={20} />
        </ToolBtn>
        <ToolBtn id="direction" label="Direction" shortcut="D" tip="Set a fill's stitch direction" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Compass size={20} />
        </ToolBtn>
      </Group>

      <Rule />
      <Group label="Stitch">
        <ToolBtn id="running" label="Run" shortcut="R" tip="Running stitch — outlines & thin lines" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <RunningGlyph />
        </ToolBtn>
        <ToolBtn id="satin" label="Satin" shortcut="S" tip="Satin column — borders & lettering" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <SatinGlyph />
        </ToolBtn>
        <ToolBtn id="satin2" label="Column" shortcut="C" tip="Two-rail satin (variable width)" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Satin2Glyph />
        </ToolBtn>
        <ToolBtn id="fill" label="Fill" shortcut="F" tip="Fill a solid area" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <FillGlyph />
        </ToolBtn>
        <ToolBtn id="pencil" label="Pencil" shortcut="B" tip="Freehand running line" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Pencil size={20} />
        </ToolBtn>
        <ToolBtn id="brush" label="Brush" shortcut="E" tip="Freehand filled area" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Paintbrush size={20} />
        </ToolBtn>
        <ToolBtn id="applique" label="Appliqué" shortcut="A" tip="Appliqué — fabric patch" tool={tool} setTool={setTool} locked={locked} lockTip={lockTip}>
          <Scissors size={20} />
        </ToolBtn>
        <RailBtn
          label="Curve"
          shortcut="Q"
          tip={locked ? lockTip : "Curved drawing — bends new strokes through their points"}
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

      {/* A first-timer looking for "add a circle" scans this rail and misses
          the Insert group up top — point them there. */}
      <p className="mt-2 hidden px-2 text-center font-body text-[9.5px] leading-snug text-ink/80 lg:block">
        Words, images &amp; shapes live in the <span className="font-semibold text-ink">top bar</span> ↑
      </p>

      {/* Units toggle — pinned to the bottom of the column at lg+, trailing the
          horizontal strip below lg. */}
      <div className="flex shrink-0 items-center px-1 lg:mt-auto lg:block lg:px-2 lg:pt-2">
        <div className="flex w-20 overflow-hidden rounded-sm border-2 border-ink text-[11px] lg:w-auto">
          {(["in", "mm"] as const).map((u) => {
            const unit: RulerUnit = u === "in" ? "inch" : "mm";
            const on = rulerUnit === unit;
            return (
              <button
                key={u}
                onClick={() => setRulerUnit(unit)}
                aria-pressed={on}
                className={`flex-1 py-2 font-label font-semibold uppercase tracking-wide lg:py-1 ${
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
    <div className="shrink-0 px-1.5">
      <div className="mb-0.5 text-center font-label text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/80">
        {label}
      </div>
      {/* Below lg the group lays its buttons in a swipeable row; at lg+ two
          columns so the whole kit fits at a glance without scrolling. */}
      <div className="flex gap-1 lg:grid lg:grid-cols-2">{children}</div>
    </div>
  );
}

function Rule() {
  // Divider follows the rail's orientation: vertical hairline in the horizontal
  // strip, horizontal hairline in the lg+ column.
  return <div className="my-1 shrink-0 border-l border-ink/15 lg:mx-3 lg:my-0.5 lg:border-l-0 lg:border-t" />;
}

/** A tool selector button (icon + label) that sets the active tool. */
function ToolBtn({
  id,
  label,
  tip,
  shortcut,
  tool,
  setTool,
  locked,
  lockTip,
  children,
}: {
  id: Tool;
  label: string;
  tip: string;
  shortcut?: string;
  tool: Tool;
  setTool: (t: Tool) => void;
  locked: boolean;
  lockTip: string;
  children: ReactNode;
}) {
  const on = tool === id && !locked;
  // The shortcut shows as a kbd badge on the button, so keep the tooltip concise.
  return (
    <RailBtn label={label} tip={locked ? lockTip : tip} shortcut={locked ? undefined : shortcut} active={on} disabled={locked} onClick={() => setTool(id)}>
      {children}
    </RailBtn>
  );
}

/** Generic rail button: icon over an Oswald micro-label, ink active state. */
function RailBtn({
  label,
  tip,
  shortcut,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  shortcut?: string;
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
      aria-keyshortcuts={shortcut}
      aria-pressed={active}
      className={`tap-target relative flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm border-2 px-1 py-1.5 transition-[color,background-color,border-color,transform] active:translate-y-px disabled:opacity-40 lg:w-full ${
        active
          ? "border-ink bg-ink text-cream"
          : "border-transparent text-ink hover:border-ink/30 hover:bg-butter-200/60"
      }`}
    >
      {/* Keyboard badge — desktop only; on the touch strip it's just clutter. */}
      {shortcut && (
        <kbd className="pointer-events-none absolute right-0.5 top-0.5 hidden font-label text-[8px] font-semibold leading-none opacity-50 lg:block">
          {shortcut}
        </kbd>
      )}
      {children}
      <span className="hidden font-label text-[9px] font-semibold uppercase tracking-wide lg:block">
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
