import { useEffect, useState } from "react";
import TopBar from "./components/TopBar";
import LayerPanel from "./components/LayerPanel";
import ToolRail from "./components/ToolRail";
import CanvasStage from "./components/CanvasStage";
import ErrorBoundary from "./components/ErrorBoundary";
import SimulatorBar from "./components/SimulatorBar";
import ReviewBar from "./components/ReviewBar";
import PropertiesPanel from "./components/PropertiesPanel";
import HelpOverlay from "./components/HelpOverlay";
import Home from "./components/Home";
import Toaster from "./components/Toaster";
import { useProjectStore } from "./store/projectStore";
import { useEditorStore, type Tool } from "./store/editorStore";
import { cloneObject } from "./lib/objects";
import { downloadProject } from "./lib/embproj";
import { loadAutosave, saveAutosave } from "./lib/autosave";
import { toast } from "./store/toastStore";

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
/** Quiet save-state shown in the top bar so the user trusts autosave is working. */
export type SaveStatus = "idle" | "saving" | "saved";

function useAutosave(): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("idle");
  useEffect(() => {
    // Restore once at startup (before any edits), then keep saving on change.
    const saved = loadAutosave();
    if (saved) {
      useProjectStore.getState().setProject(saved);
      useProjectStore.temporal.getState().clear(); // a restore isn't an undo step
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const unsub = useProjectStore.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      // An edit landed → "saving"; after the debounce write, "saved" briefly, then
      // fade. Gives the quiet reassurance that work is protected, without nagging.
      setStatus("saving");
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveAutosave(useProjectStore.getState().project);
        setStatus("saved");
        clearTimeout(clear);
        clear = setTimeout(() => setStatus("idle"), 1600);
      }, 800);
    });
    return () => {
      clearTimeout(timer);
      clearTimeout(clear);
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

  return status;
}

export default function App() {
  const saveStatus = useAutosave();
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
      {onApp ? <Studio onHome={() => go(false)} saveStatus={saveStatus} /> : <Home onStart={() => go(true)} />}
      <Toaster />
    </>
  );
}

function Studio({ onHome, saveStatus }: { onHome: () => void; saveStatus: SaveStatus }) {
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

  // One-time touch hint: long-press is the stand-in for right-click. Surface it
  // the first time there's an object to act on, so the gesture is discoverable
  // (a finger has no hover tooltip to lean on). Shown once per browser.
  const objectCount = useProjectStore((s) => s.project.objects.length);
  useEffect(() => {
    if (objectCount === 0) return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    try {
      if (localStorage.getItem("bs-longpress-hint") === "seen") return;
      localStorage.setItem("bs-longpress-hint", "seen");
    } catch {
      return; // storage blocked (private mode) — skip rather than nag every load
    }
    toast("Tip: press and hold an object for more actions — copy, delete, group…", "info");
  }, [objectCount]);

  const overlay = "absolute inset-y-0 z-40 shadow-press";

  return (
    <div className="flex h-full flex-col bg-paper text-navy">
      <TopBar onHelp={() => setShowHelp((v) => !v)} onHome={onHome} saveStatus={saveStatus} />
      {/* Studio body — one grid, two arrangements (pure CSS, same DOM):
            • below lg: a single column of rows — canvas (1fr) / ToolRail strip /
              SimulatorBar — so the tools become a bottom toolbar and the canvas
              gets the full phone width;
            • at lg+: columns — [layers] [ToolRail] [canvas+simulator] [properties]
              — the classic desktop shell, with the rail and side panels spanning
              both rows (i.e. running beside the simulator, exactly as before).
          Each child pins itself with col/row-start classes; the ToolRail carries
          its own (see ToolRail.tsx). */}
      <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto_auto] overflow-hidden lg:grid-cols-[auto_auto_minmax(0,1fr)_auto] lg:grid-rows-[minmax(0,1fr)_auto]">
        {layersOpen && (
          <div className={isNarrow ? `${overlay} anim-drawer-l left-0` : "col-start-1 row-span-2 row-start-1 min-h-0"}>
            <LayerPanel />
          </div>
        )}

        <ToolRail />

        <div className="relative col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col lg:col-start-3">
          {/* Own boundary: a canvas render error must not blank the panels/topbar —
              the project state survives and the fallback offers reload/report. */}
          <ErrorBoundary>
            <CanvasStage />
          </ErrorBoundary>
          <ReviewBar />
        </div>
        <div className="col-start-1 row-start-3 min-w-0 lg:col-start-3 lg:row-start-2">
          <SimulatorBar />
        </div>

        {propertiesOpen && (
          <div className={isNarrow ? `${overlay} anim-drawer-r right-0` : "col-start-4 row-span-2 row-start-1 min-h-0"}>
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
// Below this, the side panels become overlay drawers. 1279 (not 1023): at
// 1024-1279px the fixed chrome (layers 240 + rail + properties 256) left a
// ~416px canvas — the worst screen in the app. Panels overlay there instead.
const NARROW_QUERY = "(max-width: 1279px)";
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

// Every tool has a key (discoverable as a badge on its rail button).
const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  n: "node",
  h: "pan",
  m: "measure",
  x: "cut",
  d: "direction",
  r: "running",
  s: "satin",
  c: "satin2", // Column; in the Points tool, C toggles corner↔curve instead
  f: "fill",
  b: "pencil",
  e: "brush",
  a: "applique",
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
          toast(`Duplicated ${sel.length} object${sel.length > 1 ? "s" : ""}`, "success");
        }
        return;
      }
      // Group / ungroup the selection.
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        const ps = useProjectStore.getState();
        if (e.shiftKey) {
          ps.ungroupObjects(ps.selectedIds);
          toast("Ungrouped", "info");
        } else if (ps.selectedIds.length > 1) {
          ps.groupObjects(ps.selectedIds);
          toast(`Grouped ${ps.selectedIds.length} objects`, "success");
        }
        return;
      }
      // Select every object.
      if (mod && e.key.toLowerCase() === "a") {
        const ps = useProjectStore.getState();
        if (ps.project.objects.length) {
          e.preventDefault();
          ps.setSelection(ps.project.objects.map((o) => o.id));
        }
        return;
      }
      // Zoom (⌘/Ctrl +/−/0). The viewport lives in CanvasStage; signal it via a
      // window event so the keys work no matter where focus is.
      if (mod && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")) {
        e.preventDefault();
        const detail = e.key === "0" ? "fit" : e.key === "-" ? "out" : "in";
        window.dispatchEvent(new CustomEvent("bs:zoom", { detail }));
        return;
      }
      if (mod) return; // leave other Ctrl/Cmd combos to the browser

      // Nudge the selection (arrow = 1 mm, ⇧+arrow = 5 mm, ⌥+arrow = 0.25 mm fine)
      // — precise placement without dragging; one undo step via moveObjects.
      if (e.key.startsWith("Arrow") && editor.viewMode === "edit") {
        const ps = useProjectStore.getState();
        if (ps.selectedIds.length) {
          e.preventDefault();
          const step = e.altKey ? 0.25 : e.shiftKey ? 5 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          if (dx || dy) ps.moveObjects(ps.selectedIds, dx, dy);
        }
        return;
      }

      // Re-order the selection in the stitch sequence ( [ = earlier, ] = later ).
      // Edit view only — stitch view is read-only, and reordering there changed
      // the design invisibly behind the simulation.
      if ((e.key === "[" || e.key === "]") && editor.viewMode === "edit") {
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
      // Curve toggle — bends new strokes through their points.
      if (e.key.toLowerCase() === "q" && editor.viewMode === "edit") {
        editor.toggleSmooth();
        return;
      }
      // Tool selection. The hand (pan) works in either view (you pan the
      // simulator too); the rest are edit-view tools. In the Points tool, C
      // stays the corner↔curve toggle (handled by the canvas), not Column.
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool === "pan") {
        editor.setTool("pan");
        return;
      }
      if (tool === "satin2" && editor.tool === "node") return;
      if (tool && editor.viewMode === "edit") editor.setTool(tool);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowHelp]);
}
