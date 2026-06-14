import { lazy, Suspense, useRef, useState } from "react";
import { useProjectStore, useTemporalStore } from "../store/projectStore";
import { downloadProject, loadProjectFromFile } from "../lib/embproj";
import { buildWorksheet, worksheetHtml } from "../lib/worksheet";
import type { Project } from "../types/project";
import ExportMenu from "./ExportMenu";

// Lazy-loaded: pulls in imagetracerjs only when the user imports an image.
const AutoDigitizeDialog = lazy(() => import("./AutoDigitizeDialog"));
// Lazy-loaded: pulls in opentype.js + bundled fonts only when adding text.
const TextDialog = lazy(() => import("./TextDialog"));
import type { AddTextResult } from "./TextDialog";

/**
 * Top bar: new / open / save / import image / export plus undo / redo. Kept
 * deliberately flat and obvious.
 */
export default function TopBar({ onHelp }: { onHelp: () => void }) {
  const project = useProjectStore((s) => s.project);
  const newProject = useProjectStore((s) => s.newProject);
  const setProject = useProjectStore((s) => s.setProject);
  const addObject = useProjectStore((s) => s.addObject);
  const addColor = useProjectStore((s) => s.addColor);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [showText, setShowText] = useState(false);

  const { undo, redo, pastStates, futureStates } = useTemporalStore((t) => ({
    undo: t.undo,
    redo: t.redo,
    pastStates: t.pastStates,
    futureStates: t.futureStates,
  }));

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
  }

  function applyText({ object, newColor }: AddTextResult) {
    // Adds to the existing design (does not replace it).
    if (newColor) addColor(newColor);
    addObject(object);
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
    <header className="flex items-center gap-1 border-b border-navy-dark bg-navy px-3 py-2 text-butter-100 shadow-butter">
      <span className="mr-3 flex select-none items-baseline gap-1.5">
        <span aria-hidden className="text-lg">🧈</span>
        <span className="wordmark text-lg text-butter-200">Buttery Stitches</span>
        <span className="ml-1 hidden text-[11px] italic text-butter-100/50 sm:inline">
          stitch something sweet
        </span>
      </span>

      <BarButton onClick={() => newProject()}>New</BarButton>
      <BarButton onClick={() => fileInput.current?.click()}>Open</BarButton>
      <BarButton onClick={() => downloadProject(project)}>Save</BarButton>

      <div className="mx-2 h-5 w-px bg-butter-200/20" />

      <BarButton onClick={() => imageInput.current?.click()}>
        Import image
      </BarButton>
      <BarButton onClick={() => setShowText(true)}>Add text</BarButton>
      <ExportMenu />
      <BarButton onClick={openWorksheet}>Worksheet</BarButton>

      <div className="mx-2 h-5 w-px bg-butter-200/20" />

      <BarButton onClick={() => undo()} disabled={pastStates.length === 0}>
        Undo
      </BarButton>
      <BarButton onClick={() => redo()} disabled={futureStates.length === 0}>
        Redo
      </BarButton>

      <div className="flex-1" />

      <span className="text-xs text-butter-200/70">
        {project.objects.length} object
        {project.objects.length === 1 ? "" : "s"}
      </span>

      <button
        onClick={onHelp}
        title="Keyboard shortcuts (?)"
        className="ml-2 h-6 w-6 rounded-full border border-butter-200/30 text-sm text-butter-100 hover:bg-butter-200/15"
      >
        ?
      </button>

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
    </header>
  );
}

function BarButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded px-2.5 py-1 text-sm text-butter-100 hover:bg-butter-200/15 disabled:cursor-not-allowed disabled:text-butter-200/40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
