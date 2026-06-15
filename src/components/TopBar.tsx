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
  Square,
  Circle,
  Triangle,
  Star,
  Heart,
  Minus,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore, useTemporalStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { downloadProject, loadProjectFromFile } from "../lib/embproj";
import { buildWorksheet, worksheetHtml } from "../lib/worksheet";
import { fixStitches } from "../lib/fix";
import { makeShapeObject, type ShapeKind } from "../lib/shapes";
import type { Project } from "../types/project";
import ExportMenu from "./ExportMenu";

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

/**
 * Top bar: new / open / save / import image / export plus undo / redo. Kept
 * deliberately flat and obvious.
 */
export default function TopBar({
  onHelp,
  onHome,
}: {
  onHelp: () => void;
  onHome?: () => void;
}) {
  const project = useProjectStore((s) => s.project);
  const newProject = useProjectStore((s) => s.newProject);
  const setProject = useProjectStore((s) => s.setProject);
  const addObject = useProjectStore((s) => s.addObject);
  const addColor = useProjectStore((s) => s.addColor);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [showText, setShowText] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
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
  const setViewMode = useEditorStore((s) => s.setViewMode);
  // Adding or editing a design only makes sense on the working surface, so any
  // such action drops the user back into Edit view if they were in Stitch view.
  const goEdit = () => setViewMode("edit");
  const editingTextObject = editingTextId
    ? project.objects.find((o) => o.id === editingTextId && o.text)
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
    } catch (err) {
      alert(`Could not open project:\n${(err as Error).message}`);
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

  function insertShape(kind: ShapeKind) {
    goEdit();
    const colorId = activeColorId ?? project.colors[0]?.id;
    if (!colorId) return;
    const center = { x: project.hoop.wMm / 2, y: project.hoop.hMm / 2 };
    addObject(
      makeShapeObject(
        kind,
        { center, width: 30, height: 30, radius: 6, points: 5, outerR: 18, innerR: 9, length: 40 },
        colorId,
      ),
    );
    setShowShapes(false);
  }

  function openWorksheet() {
    const ws = buildWorksheet(project);
    if (ws.totalStitches === 0) {
      alert("Nothing to print yet — add a design first.");
      return;
    }
    const html = worksheetHtml(ws, "Buttery Stitches");
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <header className="relative z-30 flex flex-wrap items-center gap-0.5 border-b border-navy-dark bg-navy px-2 py-2 text-butter-100 shadow-butter">
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
        className="mx-1.5 flex select-none items-center gap-2 rounded px-1 hover:opacity-80"
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

      <BarButton label="New" onClick={() => newProject()}>
        <FilePlus2 size={18} />
      </BarButton>
      <BarButton label="Open" onClick={() => fileInput.current?.click()}>
        <FolderOpen size={18} />
      </BarButton>
      <BarButton label="Save" onClick={() => downloadProject(project)}>
        <Save size={18} />
      </BarButton>

      <div className="mx-1.5 h-5 w-px bg-butter-200/20" />

      <div className="relative">
        <BarButton
          label="Add shape"
          onClick={() => setShowShapes((v) => !v)}
          active={showShapes}
        >
          <Shapes size={18} />
        </BarButton>
        {showShapes && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowShapes(false)} />
            <div className="absolute left-0 z-30 mt-1 grid w-44 grid-cols-3 gap-1 rounded-md border border-navy/20 bg-cream p-1.5 text-navy shadow-butter">
              {SHAPES.map(({ kind, label, Icon }) => (
                <button
                  key={kind}
                  onClick={() => insertShape(kind)}
                  className="flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] hover:bg-butter-200"
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <ExportMenu />
      <BarButton
        label="Clean up the stitching"
        onClick={() => setProject(fixStitches(project))}
      >
        <Wand2 size={18} />
      </BarButton>
      <BarButton label="Print thread list" onClick={openWorksheet}>
        <ClipboardList size={18} />
      </BarButton>

      <div className="mx-1.5 h-5 w-px bg-butter-200/20" />

      <BarButton label="Undo" onClick={() => undo()} disabled={pastStates.length === 0}>
        <Undo2 size={18} />
      </BarButton>
      <BarButton label="Redo" onClick={() => redo()} disabled={futureStates.length === 0}>
        <Redo2 size={18} />
      </BarButton>

      <div className="flex-1" />

      <span className="px-1 text-xs text-butter-200/70">
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
        className="hidden"
        onChange={onOpenFile}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />

      {imageFile && (
        <Suspense fallback={null}>
          <AutoDigitizeDialog
            file={imageFile}
            hoop={project.hoop}
            hasExistingWork={project.objects.length > 0}
            onApply={applyDigitized}
            onClose={() => setImageFile(null)}
          />
        </Suspense>
      )}

      {showText && (
        <Suspense fallback={null}>
          <TextDialog
            hoop={project.hoop}
            colors={project.colors}
            onAdd={applyText}
            onClose={() => setShowText(false)}
          />
        </Suspense>
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

function BarButton({
  children,
  label,
  onClick,
  disabled,
  active,
  align,
}: {
  children: React.ReactNode;
  /** accessible name + tooltip for the icon button. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  /** anchor the tooltip to a side so corner buttons don't run off-screen. */
  align?: "start" | "end";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-tip={label}
      data-tip-align={align}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-9 w-9 place-items-center rounded-lg text-butter-100 hover:bg-butter-200/15 disabled:cursor-not-allowed disabled:text-butter-200/40 disabled:hover:bg-transparent ${
        active ? "bg-butter-200/15 text-butter-200" : ""
      }`}
    >
      {children}
    </button>
  );
}
