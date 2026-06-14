import { useEffect, useState } from "react";
import TopBar from "./components/TopBar";
import LayerPanel from "./components/LayerPanel";
import ToolStrip from "./components/ToolStrip";
import CanvasStage from "./components/CanvasStage";
import SimulatorBar from "./components/SimulatorBar";
import PropertiesPanel from "./components/PropertiesPanel";
import HelpOverlay from "./components/HelpOverlay";
import { useProjectStore } from "./store/projectStore";
import { useEditorStore, type Tool } from "./store/editorStore";
import { cloneObject } from "./lib/objects";
import { downloadProject } from "./lib/embproj";

/** How far (mm) a pasted or duplicated object is offset so it doesn't hide the original. */
const PASTE_OFFSET_MM = 3;

/**
 * Three-region editor shell (Section 8):
 *   Left   — object / layer panel (stitch order)
 *   Center — tool strip + canvas + stitch simulator
 *   Right  — design settings, selection properties, threads
 * Top bar spans the full width. Global keyboard shortcuts live here.
 */
export default function App() {
  // Keep the "active draw color" pointed at a real color in the project.
  const colors = useProjectStore((s) => s.project.colors);
  const activeColorId = useEditorStore((s) => s.activeColorId);
  const setActiveColorId = useEditorStore((s) => s.setActiveColorId);
  useEffect(() => {
    if (!colors.find((c) => c.id === activeColorId)) {
      setActiveColorId(colors[0]?.id ?? null);
    }
  }, [colors, activeColorId, setActiveColorId]);

  const [showHelp, setShowHelp] = useState(false);
  useGlobalShortcuts(setShowHelp);

  return (
    <div className="flex h-full flex-col bg-cream text-navy">
      <TopBar onHelp={() => setShowHelp((v) => !v)} />
      <div className="flex min-h-0 flex-1">
        <LayerPanel />
        <div className="flex min-w-0 flex-1 flex-col">
          <ToolStrip />
          <CanvasStage />
          <SimulatorBar />
        </div>
        <PropertiesPanel />
      </div>
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  n: "node",
  r: "running",
  s: "satin",
  f: "fill",
};

/** Editor-wide keyboard shortcuts (see HelpOverlay for the full list). */
function useGlobalShortcuts(setShowHelp: (fn: (v: boolean) => boolean) => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;

      const editor = useEditorStore.getState();
      const mod = e.metaKey || e.ctrlKey;

      // Save
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        downloadProject(useProjectStore.getState().project);
        return;
      }
      // Undo / redo
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const t = useProjectStore.temporal.getState();
        if (e.shiftKey) t.redo();
        else t.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useProjectStore.temporal.getState().redo();
        return;
      }
      // Copy selected objects to the clipboard (deep copies).
      if (mod && e.key.toLowerCase() === "c") {
        const ps = useProjectStore.getState();
        const sel = ps.project.objects.filter((o) =>
          ps.selectedIds.includes(o.id),
        );
        if (sel.length) {
          e.preventDefault();
          useEditorStore.getState().setClipboard(sel.map((o) => cloneObject(o)));
        }
        return;
      }
      // Paste the clipboard, offset slightly so the copies are visible.
      if (mod && e.key.toLowerCase() === "v") {
        const clip = useEditorStore.getState().clipboard;
        if (clip.length) {
          e.preventDefault();
          useProjectStore
            .getState()
            .addObjects(
              clip.map((o) => cloneObject(o, PASTE_OFFSET_MM, PASTE_OFFSET_MM)),
            );
        }
        return;
      }
      // Duplicate selection in place (one undo step).
      if (mod && e.key.toLowerCase() === "d") {
        const ps = useProjectStore.getState();
        const sel = ps.project.objects.filter((o) =>
          ps.selectedIds.includes(o.id),
        );
        if (sel.length) {
          e.preventDefault();
          ps.addObjects(
            sel.map((o) => cloneObject(o, PASTE_OFFSET_MM, PASTE_OFFSET_MM)),
          );
        }
        return;
      }
      if (mod) return; // leave other Ctrl/Cmd combos to the browser

      // Help
      if (e.key === "?") {
        setShowHelp((v) => !v);
        return;
      }
      // Toggle stitch / edit view
      if (e.key.toLowerCase() === "p") {
        editor.setViewMode(editor.viewMode === "stitch" ? "edit" : "stitch");
        return;
      }
      // Play / pause (only meaningful in stitch view)
      if (e.key === " " && editor.viewMode === "stitch") {
        e.preventDefault();
        if (editor.simTotal > 0) {
          if (editor.simIndex >= editor.simTotal) editor.setSimIndex(0);
          editor.setSimPlaying(!editor.simPlaying);
        }
        return;
      }
      // Tool selection (edit view only)
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool && editor.viewMode === "edit") editor.setTool(tool);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowHelp]);
}
