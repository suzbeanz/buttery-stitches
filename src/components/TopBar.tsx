import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  FilePlus2,
  FolderOpen,
  Save,
  ClipboardList,
  Undo2,
  Redo2,
  HelpCircle,
  PanelLeft,
  PanelRight,
  Shapes,
  Type,
  Image as ImageIcon,
  Square,
  Circle,
  Triangle,
  Star,
  Heart,
  Minus,
  Wand2,
  Import as ImportIcon,
  BadgeCheck,
  Check,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore, useTemporalStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { downloadProject, loadProjectFromFile } from "../lib/embproj";
import { buildWorksheet, worksheetHtml } from "../lib/worksheet";
import { fixStitchesWithReport, type CleanupReport } from "../lib/fix";
import { type ShapeKind } from "../lib/shapes";
import { cloneObject } from "../lib/objects";
import { newId } from "../lib/id";
import type { Project } from "../types/project";
import type { SaveStatus } from "../App";
import { toast } from "../store/toastStore";
import { importDesignBytes, EMB_FORMATS, type EmbFormat } from "../lib/export";
import { buildImportedObjects } from "../lib/embImport";
import ExportMenu from "./ExportMenu";
import DesignCheck from "./DesignCheck";

/** Shapes offered in the insert menu, with their icon and default params. */
const SHAPES: { kind: ShapeKind; label: string; Icon: LucideIcon }[] = [
  { kind: "rectangle", label: "Rectangle", Icon: Square },
  { kind: "roundedRect", label: "Rounded", Icon: Square },
  { kind: "ellipse", label: "Circle", Icon: Circle },
  { kind: "triangle", label: "Triangle", Icon: Triangle },
  { kind: "star", label: "Star", Icon: Star },
  { kind: "heart", label: "Heart", Icon: Heart },
  { kind: "line", label: "Line", Icon: Minus },
];

// Lazy-loaded: pulls in imagetracerjs only when the user imports an image.
const AutoDigitizeDialog = lazy(() => import("./AutoDigitizeDialog"));
// Lazy-loaded: pulls in opentype.js + bundled fonts only when adding text.
const TextDialog = lazy(() => import("./TextDialog"));
import type { AddTextResult } from "./TextDialog";
import ErrorBoundary from "./ErrorBoundary";

/** Turn a clean-up report into a plain-language summary for the toast. */
function cleanupMessage(r: CleanupReport): string {
  const parts: string[] = [];
  if (r.reordered) parts.push("regrouped by color");
  if (r.fillStylesSet) parts.push(`set ${r.fillStylesSet} fill style${r.fillStylesSet > 1 ? "s" : ""}`);
  if (r.densityFixed) parts.push(`fixed ${r.densityFixed} densit${r.densityFixed > 1 ? "ies" : "y"}`);
  if (r.underlayEnabled) parts.push(`added underlay to ${r.underlayEnabled}`);
  if (r.seamsTrapped) parts.push(`trapped ${r.seamsTrapped} seam${r.seamsTrapped > 1 ? "s" : ""}`);
  return parts.length ? `Cleaned up — ${parts.join(", ")}.` : "Already tidy — nothing to change.";
}

/**
 * Top bar: new / open / save / import image / export plus undo / redo. Kept
 * deliberately flat and obvious.
 */
export default function TopBar({
  onHelp,
  onHome,
  saveStatus = "idle",
}: {
  onHelp: () => void;
  onHome?: () => void;
  saveStatus?: SaveStatus;
}) {
  const project = useProjectStore((s) => s.project);
  const newProject = useProjectStore((s) => s.newProject);
  const setProject = useProjectStore((s) => s.setProject);
  const addObject = useProjectStore((s) => s.addObject);
  const addObjects = useProjectStore((s) => s.addObjects);
  const addColor = useProjectStore((s) => s.addColor);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [showText, setShowText] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  const [showMore, setShowMore] = useState(false);
  useEffect(() => {
    if (!showShapes && !showMore) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowShapes(false);
        setShowMore(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showShapes, showMore]);
  const [showCheck, setShowCheck] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const activeColorId = useEditorStore((s) => s.activeColorId);

  const updateObject = useProjectStore((s) => s.updateObject);
  const layersOpen = useEditorStore((s) => s.layersOpen);
  const propertiesOpen = useEditorStore((s) => s.propertiesOpen);
  const toggleLayers = useEditorStore((s) => s.toggleLayers);
  const toggleProperties = useEditorStore((s) => s.toggleProperties);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const pendingStart = useEditorStore((s) => s.pendingStart);
  const setPendingStart = useEditorStore((s) => s.setPendingStart);
  const setShapeKind = useEditorStore((s) => s.setShapeKind);
  const setTool = useEditorStore((s) => s.setTool);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  // Adding or editing a design only makes sense on the working surface, so any
  // such action drops the user back into Edit view if they were in Stitch view.
  const goEdit = () => setViewMode("edit");
  const editingTextObject = editingTextId
    ? project.objects.find((o) => o.id === editingTextId && o.text)
    : undefined;

  // If exactly one open path (a running line) is selected, offer it as a baseline
  // the new text can follow.
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const followPath =
    selectedIds.length === 1
      ? project.objects.find(
          (o) => o.id === selectedIds[0] && o.type === "running" && (o.paths[0]?.length ?? 0) >= 2,
        )?.paths[0]
      : undefined;

  // useShallow so the top bar re-renders only when these four fields actually
  // change, not on every entry pushed to the undo history.
  const { undo, redo, pastStates, futureStates } = useTemporalStore(
    useShallow((t) => ({
      undo: t.undo,
      redo: t.redo,
      pastStates: t.pastStates,
      futureStates: t.futureStates,
    })),
  );

  async function onOpenFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const loaded = await loadProjectFromFile(file);
      setProject(loaded);
      // Loading a document is a fresh start; clear undo history.
      useProjectStore.temporal.getState().clear();
      toast("Project opened", "success");
    } catch (err) {
      toast(`Couldn't open that file — ${(err as Error).message}`, "error");
    }
  }

  // Import (merge) another saved design into the current one — combine projects
  // without replacing what you have. Colors are remapped to fresh ids so they
  // never collide; objects are cloned with new ids and kept where they were.
  // Import an existing embroidery file (.pes/.dst/.jef/.exp/.vp3) as raw stitches
  // added to the design — preserved exactly, not re-digitized.
  async function importStitchFile(file: File, fmt: EmbFormat) {
    try {
      toast("Reading design… (first import loads the stitch engine)", "info");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const plan = await importDesignBytes(bytes, fmt);
      const { colors, objects } = buildImportedObjects(plan, file.name.replace(/\.[^.]+$/, ""));
      if (objects.length === 0) {
        toast("No stitches found in that file.", "info");
        return;
      }
      colors.forEach(addColor);
      addObjects(objects);
      toast(`Imported ${objects.length} stitch run${objects.length === 1 ? "" : "s"}`, "success");
      goEdit();
    } catch (err) {
      toast(`Couldn't import that file — ${(err as Error).message}`, "error");
    }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if ((EMB_FORMATS as readonly string[]).includes(ext)) {
      await importStitchFile(file, ext as EmbFormat);
      return;
    }
    try {
      const loaded = await loadProjectFromFile(file);
      const colorMap = new Map<string, string>();
      for (const c of loaded.colors) {
        const fresh = { ...c, id: newId("color") };
        colorMap.set(c.id, fresh.id);
        addColor(fresh);
      }
      const fallback = activeColorId ?? project.colors[0]?.id ?? "";
      const objs = loaded.objects.map((o) => {
        const clone = cloneObject(o);
        clone.colorId = colorMap.get(o.colorId) ?? fallback;
        return clone;
      });
      if (objs.length) addObjects(objs);
      toast(`Imported ${objs.length} object${objs.length === 1 ? "" : "s"}`, "success");
      goEdit();
    } catch (err) {
      toast(`Couldn't import that file — ${(err as Error).message}`, "error");
    }
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setImageFile(file);
  }

  function applyDigitized(p: Project) {
    // Tracked (not cleared) so an accidental replace can be undone.
    setProject(p);
    setImageFile(null);
    goEdit();
    // Walk the user through each freshly-traced region (confirm type, keep/skip).
    // Guarded against an empty trace inside startReview. Runs after setProject so
    // the ids already exist in the project.
    useEditorStore.getState().startReview(p.objects.map((o) => o.id));
  }

  // The empty-state quick-start buttons set this; open the matching flow.
  useEffect(() => {
    if (pendingStart === "text") setShowText(true);
    else if (pendingStart === "image") imageInput.current?.click();
    if (pendingStart) setPendingStart(null);
  }, [pendingStart, setPendingStart]);

  function applyText({ object, newColor }: AddTextResult) {
    // Adds to the existing design (does not replace it).
    if (newColor) addColor(newColor);
    addObject(object);
    goEdit();
  }

  function applyTextEdit({ object, newColor }: AddTextResult) {
    if (newColor) addColor(newColor);
    updateObject(object.id, {
      paths: object.paths,
      text: object.text,
      name: object.name,
      colorId: object.colorId,
    });
    setEditingTextId(null);
    goEdit();
  }

  // Pick a shape, then drag it out on the canvas (the more flexible interaction
  // that used to live in the tool rail — now the single home for shapes).
  function pickShape(kind: ShapeKind) {
    goEdit();
    setShapeKind(kind);
    setTool("shape");
    setShowShapes(false);
  }

  function saveCopy() {
    downloadProject(project);
    toast("Project saved to your downloads", "success");
  }

  function openWorksheet() {
    const ws = buildWorksheet(project);
    if (ws.totalStitches === 0) {
      toast("Add a design first — there's nothing to print yet.", "info");
      return;
    }
    const html = worksheetHtml(ws, "Buttery Stitches");
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <header className="relative z-30 flex flex-wrap items-center gap-1 border-b border-navy-dark bg-navy px-2 py-2 text-butter-100 shadow-press">
      <BarButton
        label={layersOpen ? "Hide layers" : "Show layers"}
        onClick={toggleLayers}
        active={layersOpen}
        align="start"
      >
        <PanelLeft size={18} />
      </BarButton>

      <button
        onClick={onHome}
        data-tip="Home"
        data-tip-side="bottom"
        aria-label="Home"
        className="mx-1.5 flex shrink-0 select-none items-center gap-2 rounded px-1 hover:opacity-80"
      >
        {/* Butter-stick mark — high contrast on the press-blue bar. */}
        <svg width="34" height="22" viewBox="0 0 40 26" fill="none" aria-hidden className="shrink-0">
          <rect x="1.5" y="4" width="37" height="18" rx="3" fill="#F1DE8B" stroke="#102A57" strokeWidth="1.6" />
          <line x1="14" y1="4" x2="14" y2="22" stroke="#102A57" strokeWidth="1.2" />
          <line x1="26" y1="4" x2="26" y2="22" stroke="#102A57" strokeWidth="1.2" />
        </svg>
        <span className="wordmark hidden text-xl uppercase leading-none text-butter-200 sm:inline">
          Buttery&nbsp;Stitches
        </span>
      </button>

      {/* File group — inline on wide screens; tucked into the "More" menu on narrow. */}
      <div className="hidden items-center gap-1 lg:flex">
        <BarButton label="New" onClick={() => newProject()}>
          <FilePlus2 size={18} />
        </BarButton>
        <BarButton label="Open" onClick={() => fileInput.current?.click()}>
          <FolderOpen size={18} />
        </BarButton>
        <BarButton label="Import & add a design (.embproj, .pes, .dst, .jef, .exp, .vp3)" onClick={() => importInput.current?.click()}>
          <ImportIcon size={18} />
        </BarButton>
        <BarButton
          label="Save a copy to your downloads (.embproj). Your work also auto-saves to this browser."
          onClick={saveCopy}
        >
          <Save size={18} />
        </BarButton>
      </div>

      {/* Quiet autosave reassurance — appears only while saving / just-saved. */}
      {saveStatus !== "idle" && (
        <span
          className="flex shrink-0 items-center gap-1 pl-0.5 pr-1 text-[11px] text-navy/55"
          aria-live="polite"
          title="Your work auto-saves to this browser"
        >
          {saveStatus === "saving" ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy/40" />
              Saving…
            </>
          ) : (
            <>
              <Check size={12} className="text-ink-deep" />
              Saved
            </>
          )}
        </span>
      )}

      <div className="mx-1.5 h-5 w-px shrink-0 bg-butter-200/20" />

      {/* Insert group — the single home for adding content (words, image, shapes). */}
      <BarButton label="Add words" onClick={() => setPendingStart("text")}>
        <Type size={18} />
      </BarButton>
      <BarButton label="Turn an image into stitches" onClick={() => setPendingStart("image")}>
        <ImageIcon size={18} />
      </BarButton>
      <div className="relative">
        <BarButton
          label="Add a shape — pick one, then drag it out"
          onClick={() => setShowShapes((v) => !v)}
          active={showShapes}
          popup
        >
          <Shapes size={18} />
        </BarButton>
        {showShapes && (
          <>
            {/* Presentational backdrop — dismiss is a mouse convenience; keyboard closes via the toggle button. */}
            <div aria-hidden className="fixed inset-0 z-20" onClick={() => setShowShapes(false)} />
            <div className="anim-press-in absolute left-0 z-30 mt-1 grid w-44 max-w-[calc(100vw-1rem)] grid-cols-3 gap-1 rounded-sm border-2 border-ink bg-cream p-1.5 text-navy shadow-press">
              {SHAPES.map(({ kind, label, Icon }) => (
                <button
                  key={kind}
                  onClick={() => pickShape(kind)}
                  className="flex flex-col items-center gap-1 rounded-sm px-1 py-2 text-[11px] hover:bg-butter-200"
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <ExportMenu open={exportOpen} onOpenChange={setExportOpen} />
      <BarButton
        label="Clean up the stitching — fix densities, fill styles, order & seams"
        onClick={() => {
          const { project: cleaned, report } = fixStitchesWithReport(project);
          setProject(cleaned);
          // Most fixes are invisible in edit view (params/order), so jump to the
          // stitch preview where the result actually shows.
          setViewMode("stitch");
          toast(cleanupMessage(report), "success");
        }}
      >
        <Wand2 size={18} />
      </BarButton>
      {/* Check + Print — inline on wide screens; in the "More" menu on narrow. */}
      <div className="hidden items-center gap-1 lg:flex">
        <BarButton label="Check design — is it ready to stitch?" onClick={() => setShowCheck(true)}>
          <BadgeCheck size={18} />
        </BarButton>
        <BarButton label="Print thread list" onClick={openWorksheet}>
          <ClipboardList size={18} />
        </BarButton>
      </div>

      {/* Overflow menu — only on narrow screens, so the bar stays one row. */}
      <div className="relative lg:hidden">
        <BarButton label="More actions" onClick={() => setShowMore((v) => !v)} active={showMore} popup>
          <MoreHorizontal size={18} />
        </BarButton>
        {showMore && (
          <>
            <div aria-hidden className="fixed inset-0 z-20" onClick={() => setShowMore(false)} />
            <div className="anim-press-in absolute left-0 z-30 mt-1 flex w-52 flex-col gap-0.5 rounded-sm border-2 border-ink bg-cream p-1.5 text-navy shadow-press">
              <MoreItem icon={FilePlus2} label="New" onClick={() => { newProject(); setShowMore(false); }} />
              <MoreItem icon={FolderOpen} label="Open…" onClick={() => { fileInput.current?.click(); setShowMore(false); }} />
              <MoreItem icon={ImportIcon} label="Import & add…" onClick={() => { importInput.current?.click(); setShowMore(false); }} />
              <MoreItem icon={Save} label="Save a copy" onClick={() => { saveCopy(); setShowMore(false); }} />
              <div className="my-0.5 h-px bg-ink/15" />
              <MoreItem icon={BadgeCheck} label="Check design" onClick={() => { setShowCheck(true); setShowMore(false); }} />
              <MoreItem icon={ClipboardList} label="Print thread list" onClick={() => { openWorksheet(); setShowMore(false); }} />
            </div>
          </>
        )}
      </div>

      <div className="mx-1.5 h-5 w-px shrink-0 bg-butter-200/20" />

      <BarButton
        label={pastStates.length ? `Undo (${pastStates.length})` : "Undo"}
        onClick={() => undo()}
        disabled={pastStates.length === 0}
      >
        <Undo2 size={18} />
      </BarButton>
      <BarButton
        label={futureStates.length ? `Redo (${futureStates.length})` : "Redo"}
        onClick={() => redo()}
        disabled={futureStates.length === 0}
      >
        <Redo2 size={18} />
      </BarButton>

      {/* Push the end controls right on wide screens; on narrow the bar wraps
          tidily with everything left-aligned instead of stranding them. */}
      <div className="hidden flex-1 lg:block" />

      <span className="hidden shrink-0 px-1 text-xs text-butter-200/70 sm:inline">
        {project.objects.length} object
        {project.objects.length === 1 ? "" : "s"}
      </span>

      <BarButton label="Keyboard shortcuts" onClick={onHelp} align="end">
        <HelpCircle size={18} />
      </BarButton>
      <BarButton
        label={propertiesOpen ? "Hide properties" : "Show properties"}
        onClick={toggleProperties}
        active={propertiesOpen}
        align="end"
      >
        <PanelRight size={18} />
      </BarButton>

      <input
        ref={fileInput}
        type="file"
        accept=".embproj,application/json"
        aria-label="Open a project file"
        className="hidden"
        onChange={onOpenFile}
      />
      <input
        ref={importInput}
        type="file"
        accept=".embproj,.pes,.dst,.jef,.exp,.vp3,application/json"
        aria-label="Import a design file"
        className="hidden"
        onChange={onImportFile}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        aria-label="Choose an image to digitize"
        className="hidden"
        onChange={onPickImage}
      />

      {showCheck && (
        <DesignCheck
          onClose={() => setShowCheck(false)}
          onExport={() => {
            setShowCheck(false);
            setExportOpen(true);
          }}
        />
      )}

      {imageFile && (
        // Own boundary: a dialog crash (e.g. a pathological trace input) must not
        // take down the editor behind it.
        <ErrorBoundary>
          <Suspense fallback={null}>
            <AutoDigitizeDialog
              file={imageFile}
              hoop={project.hoop}
              hasExistingWork={project.objects.length > 0}
              onApply={applyDigitized}
              onClose={() => setImageFile(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {showText && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <TextDialog
              hoop={project.hoop}
              colors={project.colors}
              followPath={followPath}
              onAdd={applyText}
              onClose={() => setShowText(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {editingTextObject && (
        <Suspense fallback={null}>
          <TextDialog
            hoop={project.hoop}
            colors={project.colors}
            editObject={editingTextObject}
            onAdd={applyTextEdit}
            onClose={() => setEditingTextId(null)}
          />
        </Suspense>
      )}
    </header>
  );
}

/** A labeled row in the narrow-screen "More" overflow menu. */
function MoreItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-butter-200"
    >
      <Icon size={16} className="shrink-0" />
      {label}
    </button>
  );
}

function BarButton({
  children,
  label,
  onClick,
  disabled,
  active,
  align,
  popup,
}: {
  children: React.ReactNode;
  /** accessible name + tooltip for the icon button. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  /** anchor the tooltip to a side so corner buttons don't run off-screen. */
  align?: "start" | "end";
  /** This button opens a popover/menu: announce haspopup + expanded instead of
   *  pressed (a menu trigger is not a toggle-state button to AT). */
  popup?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-tip={label}
      data-tip-align={align}
      aria-label={label}
      aria-pressed={popup ? undefined : active}
      aria-haspopup={popup ? "menu" : undefined}
      aria-expanded={popup ? active : undefined}
      className={`tap-target grid h-9 w-9 shrink-0 place-items-center rounded-lg text-butter-100 transition-transform hover:bg-butter-200/15 active:translate-y-px active:bg-butter-200/25 disabled:cursor-not-allowed disabled:text-butter-200/40 disabled:hover:bg-transparent ${
        active ? "bg-butter-200/15 text-butter-200" : ""
      }`}
    >
      {children}
    </button>
  );
}
