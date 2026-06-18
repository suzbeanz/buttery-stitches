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
  Import as ImportIcon,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore, useTemporalStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { downloadProject, loadProjectFromFile } from "../lib/embproj";
import { buildWorksheet, worksheetHtml } from "../lib/worksheet";
import { fixStitches } from "../lib/fix";
import { makeShapeObject, type ShapeKind } from "../lib/shapes";
import { cloneObject } from "../lib/objects";
import { newId } from "../lib/id";
import type { Project } from "../types/project";
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
  const addObjects = useProjectStore((s) => s.addObjects);
  const addColor = useProjectStore((s) => s.addColor);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [showText, setShowText] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
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
        label="Save"
        onClick={() => {
          downloadProject(project);
          toast("Project saved to your downloads", "success");
        }}
      >
        <Save size={18} />
      </BarButton>

      <div className="mx-1.5 h-5 w-px shrink-0 bg-butter-200/20" />

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
            {/* Presentational backdrop — dismiss is a mouse convenience; keyboard closes via the toggle button. */}
            <div aria-hidden className="fixed inset-0 z-20" onClick={() => setShowShapes(false)} />
            <div className="anim-press-in absolute left-0 z-30 mt-1 grid w-44 grid-cols-3 gap-1 rounded-sm border-2 border-ink bg-cream p-1.5 text-navy shadow-press">
              {SHAPES.map(({ kind, label, Icon }) => (
                <button
                  key={kind}
                  onClick={() => insertShape(kind)}
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

      <ExportMenu />
      <BarButton label="Check design — is it ready to stitch?" onClick={() => setShowCheck(true)}>
        <BadgeCheck size={18} />
      </BarButton>
      <BarButton
        label="Clean up the stitching"
        onClick={() => {
          setProject(fixStitches(project));
          toast("Stitching cleaned up", "success");
        }}
      >
        <Wand2 size={18} />
      </BarButton>
      <BarButton label="Print thread list" onClick={openWorksheet}>
        <ClipboardList size={18} />
      </BarButton>

      <div className="mx-1.5 h-5 w-px shrink-0 bg-butter-200/20" />

      <BarButton label="Undo" onClick={() => undo()} disabled={pastStates.length === 0}>
        <Undo2 size={18} />
      </BarButton>
      <BarButton label="Redo" onClick={() => redo()} disabled={futureStates.length === 0}>
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
        className="hidden"
        onChange={onOpenFile}
      />
      <input
        ref={importInput}
        type="file"
        accept=".embproj,.pes,.dst,.jef,.exp,.vp3,application/json"
        className="hidden"
        onChange={onImportFile}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />

      {showCheck && <DesignCheck onClose={() => setShowCheck(false)} />}

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
            followPath={followPath}
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
      className={`tap-target grid h-9 w-9 shrink-0 place-items-center rounded-lg text-butter-100 transition-transform hover:bg-butter-200/15 active:translate-y-px active:bg-butter-200/25 disabled:cursor-not-allowed disabled:text-butter-200/40 disabled:hover:bg-transparent ${
        active ? "bg-butter-200/15 text-butter-200" : ""
      }`}
    >
      {children}
    </button>
  );
}
