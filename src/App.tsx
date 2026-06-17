import { useEffect, useState } from "react";
import TopBar from "./components/TopBar";
import LayerPanel from "./components/LayerPanel";
import ToolRail from "./components/ToolRail";
import CanvasStage from "./components/CanvasStage";
import SimulatorBar from "./components/SimulatorBar";
import PropertiesPanel from "./components/PropertiesPanel";
import HelpOverlay from "./components/HelpOverlay";
import Home from "./components/Home";
import Toaster from "./components/Toaster";
import { useProjectStore } from "./store/projectStore";
import { useEditorStore, type Tool } from "./store/editorStore";
import { cloneObject } from "./lib/objects";
import { downloadProject } from "./lib/embproj";
import { loadAutosave, saveAutosave } from "./lib/autosave";

/** How far (mm) a pasted or duplicated object is offset so it doesn't hide the original. */
const PASTE_OFFSET_MM = 3;

/**
 * Three-region editor shell (Section 8):
 *   Left   — object / layer panel (stitch order)
 *   Center — tool strip + canvas + stitch simulator
 *   Right  — design settings, selection properties, threads
 * Top bar spans the full width. Global keyboard shortcuts live here.
 */
// Path-based routing so the homepage lives at "/" and the studio at "/app":
// the URL is the single source of truth, so reloading "/" stays on the
// homepage and "/app" deep-links straight into the editor (a 404.html fallback
// on the static host serves this SPA for the deep path). BASE_URL is honored so
// it also works when the app is hosted under a sub-path.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, ""); // "" when served at root
const APP_PATH = `${BASE}/app`;
const HOME_PATH = `${BASE}/`;

/** Is the current location the studio route? (tolerant of a trailing slash) */
function isAppRoute(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/+$/, "") === APP_PATH;
}

/**
 * Persist the design to the device and pick it back up on reload/crash/deploy, so
 * work is never lost — and so a stale-deploy chunk error can self-heal by
 * reloading to the fresh build without losing anything.
 */
function useAutosave(): void {
  useEffect(() => {
    // Restore once at startup (before any edits), then keep saving on change.
    const saved = loadAutosave();
    if (saved) {
      useProjectStore.getState().setProject(saved);
      useProjectStore.temporal.getState().clear(); // a restore isn't an undo step
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useProjectStore.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      clearTimeout(timer);
      timer = setTimeout(() => saveAutosave(useProjectStore.getState().project), 800);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  // Self-heal a stale-deploy chunk error: a tab opened before a deploy fails to
  // fetch a renamed lazy chunk. Save and reload to the fresh build (no work lost
  // thanks to autosave); guard against a reload loop.
  useEffect(() => {
    const onPreloadError = (e: Event) => {
      const KEY = "bs:lastReload";
      const now = Date.now();
      if (now - Number(sessionStorage.getItem(KEY) || 0) < 8000) return;
      e.preventDefault();
      try {
        sessionStorage.setItem(KEY, String(now));
      } catch {
        /* ignore */
      }
      saveAutosave(useProjectStore.getState().project);
      window.location.reload();
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);
}

export default function App() {
  useAutosave();
  const [onApp, setOnApp] = useState<boolean>(isAppRoute);

  // Keep React in sync with browser back/forward navigation.
  useEffect(() => {
    const sync = () => setOnApp(isAppRoute());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const go = (app: boolean) => {
    const path = app ? APP_PATH : HOME_PATH;
    if (window.location.pathname.replace(/\/+$/, "") !== path.replace(/\/+$/, "")) {
      window.history.pushState({}, "", path);
    }
    setOnApp(app);
    window.scrollTo(0, 0);
  };

  return (
    <>
      {onApp ? <Studio onHome={() => go(false)} /> : <Home onStart={() => go(true)} />}
      <Toaster />
    </>
  );
}

function Studio({ onHome }: { onHome: () => void }) {
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
  // HelpOverlay dismisses itself on Escape or an outside click (so keyboard users
  // can Tab through it first) — it must NOT close on any keydown.

  // Collapsible side panels: on narrow screens they slide over the canvas
  // (so it's never squeezed) and default to closed; on wide screens they sit
  // inline. The top bar's panel toggles flip the same store state.
  const layersOpen = useEditorStore((s) => s.layersOpen);
  const propertiesOpen = useEditorStore((s) => s.propertiesOpen);
  const setLayersOpen = useEditorStore((s) => s.setLayersOpen);
  const setPropertiesOpen = useEditorStore((s) => s.setPropertiesOpen);
  const isNarrow = useIsNarrow();
  useEffect(() => {
    setLayersOpen(!isNarrow);
    setPropertiesOpen(!isNarrow);
  }, [isNarrow, setLayersOpen, setPropertiesOpen]);

  const overlay = "absolute inset-y-0 z-40 shadow-press";

  return (
    <div className="flex h-full flex-col bg-paper text-navy">
      <TopBar onHelp={() => setShowHelp((v) => !v)} onHome={onHome} />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {layersOpen && (
          <div className={isNarrow ? `${overlay} anim-drawer-l left-0` : "contents"}>
            <LayerPanel />
          </div>
        )}

        <ToolRail />

        <div className="flex min-w-0 flex-1 flex-col">
          <CanvasStage />
          <SimulatorBar />
        </div>

        {propertiesOpen && (
          <div className={isNarrow ? `${overlay} anim-drawer-r right-0` : "contents"}>
            <PropertiesPanel />
          </div>
        )}

        {isNarrow && (layersOpen || propertiesOpen) && (
          // Presentational scrim — tap to close the open drawer; keyboard users
          // close it with the same top-bar toggle that opened it.
          <div
            aria-hidden
            className="anim-scrim-in absolute inset-0 z-30 bg-navy/20"
            onClick={() => {
              setLayersOpen(false);
              setPropertiesOpen(false);
            }}
          />
        )}
      </div>
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

/** True when the viewport is narrow enough that side panels should overlay.
 *  Initialized synchronously from the media query so the very first paint is
 *  correct — otherwise a phone briefly renders both panels inline and crushes
 *  the canvas to nothing before the effect can correct it. */
const NARROW_QUERY = "(max-width: 1023px)";
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(NARROW_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  n: "node",
  h: "pan",
  m: "measure",
  r: "running",
  s: "satin",
  f: "fill",
  b: "pencil",
};

/** Editor-wide keyboard shortcuts (see HelpOverlay for the full list). */
function useGlobalShortcuts(setShowHelp: (fn: (v: boolean) => boolean) => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      // Don't let editor shortcuts (tool keys, Space, p, …) leak through an open
      // modal — they'd silently change tools/view behind the dialog.
      if (document.querySelector('[aria-modal="true"]')) return;

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
      // Group / ungroup the selection.
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        const ps = useProjectStore.getState();
        if (e.shiftKey) ps.ungroupObjects(ps.selectedIds);
        else ps.groupObjects(ps.selectedIds);
        return;
      }
      if (mod) return; // leave other Ctrl/Cmd combos to the browser

      // Re-order the selection in the stitch sequence ( [ = earlier, ] = later ).
      if (e.key === "[" || e.key === "]") {
        const ps = useProjectStore.getState();
        if (ps.selectedIds.length) {
          ps.moveOrder(ps.selectedIds, e.key === "[" ? "earlier" : "later");
        }
        return;
      }

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
      // Tool selection. The hand (pan) works in either view (you pan the
      // simulator too); the rest are edit-view tools.
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool === "pan") {
        editor.setTool("pan");
        return;
      }
      if (tool && editor.viewMode === "edit") editor.setTool(tool);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowHelp]);
}
