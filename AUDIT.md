# Buttery Stitches — Repository Audit

Scope: a free, fully client-side browser embroidery studio (React 18 + TypeScript + Vite, Konva canvas, Pyodide/WASM running pyembroidery for some file I/O, plus an auto-digitizer). No backend. This is an **audit only** — no code was changed.

Method: read the build config, CI, docs, and mapped the major modules (engine/digitizer, native + Pyodide export, import, canvas/render, stores, trace/OCR), then ran targeted static analysis and dependency/security checks. Line references are to the state audited (commit `fe77898`).

---

## Executive summary — top 5 issues

1. **File import and several export formats are very likely broken in production by the CSP.** The deployed meta-CSP `connect-src` allows only `'self'`/jsdelivr, but `micropip.install("pyembroidery")` downloads the wheel from `files.pythonhosted.org`/`pypi.org`. The native TS writers cover DST + PES v1, so this only bites the *Python* path — but that path is **every import** and exports of **JEF/EXP/VP3/PES v6/appliqué-STOP** designs. It works in dev (CSP unenforced) and fails on GitHub Pages. **HIGH / functional.** (`index.html:28` vs `src/lib/pyodide/loader.ts:93-96`, `src/lib/export/index.ts:283-300`)

2. **Pyodide runs on the main thread — multi-second UI freeze, no cancellation.** The runtime is injected as a `<script>` and every `runPythonAsync` executes on the main thread; a first export/import freezes the tab (download + WASM compile + install), and a large design blocks during encode. There is no worker and no abort. **HIGH / perf-UX.** (`src/lib/pyodide/loader.ts:45-68,81-109`, `src/lib/export/index.ts:227-249`)

3. **The binary-I/O boundary is the biggest test blind spot.** There are **no committed real third-party `.pes/.dst` fixtures**; the round-trip test decodes only bytes the app itself produced (a bug shared by encoder+decoder is invisible); the actual import decode runs only under Pyodide, which vitest (`environment: "node"`) never loads; and no test feeds malformed/truncated bytes to the importer. **HIGH / correctness+testing.** (`roundtrip.test.ts`, `embImport.test.ts`, `vite.config.ts:67`)

4. **The canvas core editor is pointer-only for authoring and reshaping.** A keyboard-only user can select via the Layer panel and nudge/reorder/delete existing objects, but cannot draw/create, node-edit, or scale/rotate — all of which require pointer drags. **HIGH / accessibility.** (`src/components/CanvasStage.tsx` draw/transform handlers; selection only via `LayerPanel.tsx:174-181`)

5. **Playback and re-render cost blow up on large (50k+) designs.** The simulator re-segments the whole design O(n) and re-strokes it (with ~4 realistic-render passes + per-vertex trig) every animation frame; and `ObjectShape` is un-memoized so *every* object re-renders on each cursor move while drawing. **MEDIUM–HIGH / perf.** (`src/lib/engine/render.ts:17-39`, `src/lib/render-stitches.ts:101-123`, `src/components/CanvasStage.tsx:1962,1267-1305`)

Honorable mention (correctness): the jam-safety min-spacing floor (0.3 mm) is enforced in the mm domain **before** the 1/10 mm export rounding, so a pair hugging the floor can land ~0.2 mm apart in the actual file, with no post-rounding re-check.

---

## 1. Correctness & data integrity

**1.1 — Machine-safety floor enforced before unit rounding. MEDIUM.** `enforceMinSpacing` (floor `MIN_PENETRATION_SPACING = 0.3`) runs on the assembled mm stream (`src/lib/engine/index.ts:1515,1593,1602-1620`) — good, that's the final internal stream. But `planFromDesign` then rounds each coordinate independently with `mmToTenths = Math.round(mm*10)` (`src/lib/export/index.ts:81-83`, `src/lib/units.ts:11-13`). Independent ±0.05 mm rounding can shrink a 0.3 mm pair to 0.2 mm (2 tenths) in the file — below `validate.ts`'s own `minStitch: 0.25` danger floor (`src/lib/engine/validate.ts:11`). No test re-checks spacing on the decoded bytes. **Fix:** re-run `collapseCoincident`/`enforceMinSpacing` in the tenths domain inside `splitPlanForFormat`, or assert min-spacing on decoded bytes in `roundtrip.test.ts`. *(Long-move handling is correct: `capStitchLength` caps at 5 mm and `splitPlanForFormat` subdivides both stitches and jumps below `MAX_STITCH_TENTHS`, so >12.7 mm can't silently become a jump — `src/lib/export/index.ts:120-166`.)*

**1.2 — Oracle validation narrower than the "byte-identical" claims. MEDIUM.** `pes.ts`/`dst.ts` comments say "byte-for-byte" (`pes.ts:18-21`, `dst.ts:14`), but the oracle scripts gate only on `functionalMatch` (STITCH penetrations + thread RGBs), treating `bytesMatch` as informational and ignoring jumps/thumbnails (`scripts/oracle-pes.mjs`, `oracle-dst.mjs`). The ~5 hand-built oracle plans also **bypass `planFromDesign`/`anchorBlocks`/rounding** and never test palette edge cases (duplicate RGB across blocks, >64 unique colors → `buildUniquePalette` break at `pes.ts:117` and the `>=255` throw at `pes.ts:774`, and the `set()`-ordering assumption flagged at `pes.ts:99-108`). Import is not oracle-checked at all. **Fix:** add oracle cases that run end-to-end through `planFromProject`, cover duplicate/overflow palettes, and soften the comments to "functionally equivalent (stitches + colors)."

**1.3 — Unit conversion is consistent. OK/LOW.** `units.ts` (`TENTHS_PER_MM=10`) is the single source; DST Y-flip is localized (`dst.ts:119`). Only nit: `embImport.ts:30` hardcodes `x / 10` instead of `tenthsToMm` (same value, bypasses the helper).

**1.4 — `moveObjects` desyncs `nodes` from `paths`. MEDIUM (state).** `src/store/projectStore.ts:208-227` translates `paths` and `satinCenterlines` but not `o.nodes`. Node-backed objects (running/shapes carry `nodes?`, `types/project.ts:129`) are kept in sync everywhere else (`smoothOne`, `splitObject`, the node-drag `translateNodes` at `CanvasStage.tsx:2120`), but a select-tool drag → `moveObjects` (`CanvasStage.tsx:1300`) leaves nodes at the old location; switching to the node tool then renders handles in the wrong place and editing snaps geometry back. **Fix:** translate `o.nodes` with the existing `translateNodes` in `moveObjects`.

**1.5 — Undo/redo integrity. OK.** `zundo` partializes only `project` with reference-equality dedup (`projectStore.ts:424-428`); mutations are immutable spreads with `return s` no-op guards; reorders copy arrays; selection is transient and reconciled outside history. `designCache` keyed by project reference is safe (pure function of an immutable project). No mutation-across-snapshots or history bypass found.

---

## 2. Pyodide / WASM bridge

**2.1 — Main-thread execution, no cancellation. HIGH.** See exec-summary #2. **Fix:** move Pyodide to a Web Worker (the plan JSON + result bytes are already a clean serializable boundary), add abort/timeout. This also removes `wasm-unsafe-eval` pressure from the document scope.

**2.2 — CSP blocks `micropip` PyPI fetch. HIGH.** See exec-summary #1. Under the enforced CSP the friendly error (`export/index.ts:307-319`, matches `"micropip"`) would always fire "couldn't download the export engine." **Fix:** self-host the pyembroidery wheel and `micropip.install` from a `'self'`/jsdelivr URL, **or** add `https://pypi.org https://files.pythonhosted.org` to `connect-src`; then verify import actually works on the deployed site (the `e2e/csp.spec.ts` check would catch this if the Python path were exercised e2e — it currently isn't).

**2.3 — pyembroidery is installed unpinned. MEDIUM.** `micropip.install("pyembroidery")` has no `==version` (`loader.ts:93-96`), while the native writers target pyembroidery **1.5.1** semantics (`pes.ts:15`) and the derisk/oracle scripts pin 1.5.1. A PyPI release could shift the Python-path output and diverge from the native path. **Fix:** pin `pyembroidery==1.5.1`.

**2.4 — Serialization overhead at the boundary. MEDIUM.** The whole plan is `JSON.stringify`→`json.loads`→`EmbPattern`; results re-serialize (export copies via `.toJs()`; import builds a JSON string of every run then `JSON.parse`s — `export/index.ts:234-242,296`). 2–4 O(n) passes over stitch data plus the main-thread block; arrays are always copied, never transferred. **Fix (with 2.1):** compact binary transfer (e.g. Int32 deltas) instead of JSON.

**2.5 — PyProxy `.destroy()` not in `finally`. LOW.** `export/index.ts:238-244` skips `destroy()` if `toJs()` throws. **Fix:** `try { return result.toJs(); } finally { result.destroy(); }`. *(No globals-growth leak: `globals.set` overwrites single slots each call — `export/index.ts:234-236,291-292` — and `embroidery.py` runs once.)*

**2.6 — Load strategy is otherwise good. INFO.** Lazy on first Python-path use; promise nulled on failure for retry; runtime version pinned + overridable `indexURL` for self-hosting/offline; native DST/PES-v1 skip Pyodide entirely. Caveat: **import always needs Pyodide** (no native reader), so on mobile/offline import is unavailable while most exports work — worth a UI note.

---

## 3. Security

**3.1 — Untrusted binary parsing is sandboxed in WASM. STRONG.** The real attack surface (importing `.pes/.dst/.jef/.exp/.vp3`) is parsed entirely inside pyembroidery under Pyodide/WASM, isolated from the JS heap/DOM; `embImport.ts` only consumes the already-parsed plan and divides by 10. The native `pes.ts`/`dst.ts` are **writers of trusted input**, not parsers — the "allocation-bomb/unbounded-loop" concerns do not apply to them.

**3.2 — No import size / stitch-count cap → tab OOM (self-DoS). MEDIUM.** `file.arrayBuffer()` is handed straight to pyembroidery with no limit (`TopBar.tsx:166-167`), and `import_design` builds unbounded run/blocks lists + a full JSON string (`embroidery.py:76-93`). A crafted huge-stitch file can exhaust the WASM heap / crash the tab (client-only, no cross-user impact). **Fix:** byte-size guard before import and/or a stitch-count ceiling that raises a friendly error.

**3.3 — `pec-decode.ts` unchecked reads past buffer end. LOW (test-only).** `readAxis` does `buf[p++]` (and a second read in long form) with no `p < length` check (`pec-decode.ts:39-66`); truncated input yields `NaN` coords. Bounded by a `guard < 2_000_000` loop cap so no infinite loop. Only imported by `roundtrip.test.ts` — nil production exposure today. **Fix (if ever promoted to a real importer):** bounds checks + reject on truncation.

**3.4 — No SVG-to-DOM / HTML-injection path. STRONG.** `svgPath.ts` only *builds* numeric `d` strings; there is no SVG upload/parse — image import goes `new Image()`→`<canvas>`→`getImageData` (raster pixels only, downscaled), so a malicious SVG cannot inject script. Repo-wide grep for `dangerouslySetInnerHTML`, `eval(`, `new Function`, `innerHTML`, `document.write` → **zero matches**. Downloads use `Blob`/`createObjectURL`. `.embproj` load validates version/shape and coerces dimensions.

**3.5 — CSP present and strict, with two gaps. MEDIUM.** `index.html:26-29` sets a thoughtful meta-CSP (`default-src 'self'`, `object-src 'none'`, no `unsafe-inline` scripts, correct `wasm-unsafe-eval` + `worker-src`). Gaps: (a) `connect-src` omits PyPI → **2.2**; (b) `connect-src` omits the tesseract.js OCR model host (`trace/ocr.ts:33-39` lazily fetches an English model; tesseract defaults to unpkg, not allowed) — OCR silently degrades to `[]` rather than erroring, but the feature is dead under CSP. **Fix:** add or self-host both origins.

**3.6 — Dependency vulnerabilities are dev-only. LOW (prod).** `npm audit`: 5 vulns (1 critical, 1 high, 3 moderate) — all in `vite`/`vitest`/`esbuild`/`vite-node`/`@vitest/mocker`, i.e. the **dev toolchain**, never shipped to the browser. The "critical" requires the Vitest UI server listening; the "high" is a dev-server path traversal. **Fix:** bump `vite`/`vitest` when convenient; no production exposure. **No secrets** found in the tree or a history filename scan.

---

## 4. Performance

**4.1 — Per-frame full re-segmentation during playback. MEDIUM (HIGH at 50k+).** `SimulatorBar` sets `simIndex` every rAF (`SimulatorBar.tsx:33-52`); `StitchView` recomputes `designToSegments(design, upTo)` (O(n), fresh point arrays) + `needleAt` every frame (`CanvasStage.tsx:1875-1878`, `engine/render.ts:17-39`) and re-strokes everything, with ~4 passes + two `fiberStrand` trig passes in realistic mode (default on) (`render-stitches.ts:101-123`). At 50k stitches that is ~50k allocations + hundreds of thousands of trig ops per frame → sub-60fps + GC thrash. **Fix:** incremental segments (append only the delta since last `upTo`), clip drawing to the newly revealed range, and auto-disable realistic passes / decimate fiber strands above a stitch threshold.

**4.2 — No viewport culling/decimation of the preview. MEDIUM.** Neither `StitchView` nor `drawStitches` cull off-screen stitches or reduce density at low zoom; every pan/zoom repaints the whole design O(n). **Fix:** cull segments against visible mm bounds and Douglas–Peucker-decimate at low zoom (the repo already has `douglasPeucker` in `trace/simplify.ts`).

**4.3 — Full design recompute on every mutation. LOW–MEDIUM.** `design = useMemo(() => designFor(project), [project])` (`CanvasStage.tsx:160`); any edit re-digitizes synchronously (memoized only on identical project reference). Acceptable now; for large designs consider debouncing or a worker.

**4.4 — `ObjectShape` un-memoized; re-renders on every cursor move. HIGH (large designs).** `ObjectShape` is a plain component (`CanvasStage.tsx:1962`) mapped over every visible object each render (`:1267-1305`); `CanvasStage` subscribes to hot `cursorMm`/`draft` (`:111-112`) updated on every mouse move / ~0.8 mm of pencil travel (`:707-713,737`). Each cursor tick re-renders all objects, and props are inline closures + fresh `px`/`py` identities (`:242-243,1279-1305`), so `React.memo` alone won't help. **Fix:** memoize `ObjectShape`, stabilize `px`/`py`/callbacks (`useCallback`/`useMemo` or pass primitives), and isolate the live cursor/draft preview into a small child so motion doesn't re-render the object list.

**4.5 — Store selectors are otherwise good. INFO.** Fine-grained selectors throughout; `TopBar` uses `useShallow`; `simIndex` deliberately not subscribed in `CanvasStage` (documented at `:155-157`); `colorById`/`objectBounds` memoized.

**4.6 — `bs:zoom` effect missing deps array. LOW.** `CanvasStage.tsx:281-290` re-subscribes the window listener every render. **Fix:** add `[]`/stable deps.

**4.7 — Bundle & code splitting. STRONG.** Pyodide is never bundled (CDN script at runtime); `tesseract.js` is `await import()`ed (`ocr.ts:35`); `imagetracerjs`/`opentype.js` land in lazy dialog chunks (`AutoDigitizeDialog`/`TextDialog` are `lazy()` — `TopBar.tsx:57,59`); `manualChunks` splits Konva (`vite.config.ts:60-62`). No heavy dep in the entry path. Risk: this relies on the lazy boundaries holding, with **no CI size budget** — one stray static import of `lib/trace`/`lib/text/fonts` would silently bloat the entry chunk. **Fix:** add a bundle-size check. *(Also: 13 bundled TTFs ≈ 2.5 MB — consider subsetting or per-face lazy-load.)*

---

## 5. TypeScript & code quality

**5.1 — Type strictness is STRONG.** `strict` + `noUnusedLocals/Parameters` on; effectively **zero `: any`** in production source. The Pyodide boundary is typed `Promise<unknown>` then narrowed at call sites; remaining `as unknown as` casts are legitimate boundaries (Konva internals, JSON deserialization).

**5.2 — Deserialization is well-guarded. POSITIVE.** `project.ts:37-109` validates/normalizes untrusted project JSON (finite-number filtering, hoop fallback, hard-fail on unknown type/no color) so a malformed file can't crash the engine.

**5.3 — Error handling: mostly OK, one structural gap. LOW–MEDIUM.** Silent catches are almost all legitimate (storage in private mode, canvas under jsdom). Two notes: `PropertiesPanel.tsx:362-364` swallows a `generateObjectStitches` error and shows count `0` (masks a real engine failure as a plausible number); and **`ErrorBoundary` is mounted only at the root** (`main.tsx:26-28`) — a render throw in `CanvasStage`, a dialog, or the export UI blanks the whole app. **Fix:** surface the stitch-count error; wrap `CanvasStage` + dialogs in their own boundaries.

**5.4 — God modules. LOW.** `CanvasStage.tsx` 2340 lines (tools + rendering + transforms + node editing), `engine/index.ts` 1723 (assembly + ties + safety + public API), `engine/fill.ts` 1275, `engine/medial.ts` 1034, `pes.ts` 864. Cohesive but the top refactor candidates.

**5.5 — Minor style. LOW.** `planFromDesign` uses repeated `current!` non-null assertions (`export/index.ts:75,80,83`); a small local variable would let the compiler prove it and drop the `!`.

---

## 6. Testing

**Strong today:** ~98 test files. Engine/digitizer unit tests are extensive (~35 files: underlay, satin-width, jam-safety, machine-safety, short-stitch, travel, turning, routing, contour/medial, gradient, appliqué). A numeric **regression bench** exists (`bench/corpus.ts` + `coverage/distortion/routing/metrics.test.ts` with hard thresholds like `fillCoverage > 0.92`, plus a committed `bench/baseline.json`). Native encoder tests + an encoder→decoder round-trip (`roundtrip.test.ts`). `.embproj` malformed-JSON handling is tested (`foundations.test.ts:64-93`). Broad multi-step scenario tests (`journeys/synthetic-users/broad-qa`).

**Gaps (prioritized):**
- **6.1 — No real third-party binary fixtures; round-trip is self-referential. HIGH.** Zero committed `.pes/.dst/...` files; `roundtrip.test.ts` decodes only app-produced bytes, so an encoder+decoder-shared bug is invisible, and nothing proves the app reads files produced by real machines/software. **Fix (highest value):** commit small golden third-party `.pes`/`.dst` files (with redistribution rights) + expected stitch-count/bounds/colors, and assert the importer reconstructs them.
- **6.2 — Import decode path untested (Pyodide not in vitest). HIGH.** `importDesignBytes` parses inside Pyodide; vitest is `environment: "node"` with no Pyodide, so the byte-decode path has **no automated coverage**. `embImport.test.ts` only tests `buildImportedObjects` on a synthetic plan. **Fix:** a Pyodide-backed node integration test (possible — `scripts/derisk-pyodide.mjs` proves it) importing the 6.1 fixtures and round-tripping back through export.
- **6.3 — No malformed/corrupt-byte importer tests. HIGH.** Nothing fuzzes truncated/garbage bytes; `friendlyExportError` is only unit-tested on strings. **Fix:** fuzz the importer + the pure `decodePecStitches` decoder with garbage/truncated/header-only input; assert graceful rejection, not hangs or raw tracebacks.
- **6.4 — Oracle scripts not in CI. MEDIUM.** `oracle-pes/dst.mjs` (native-vs-pyembroidery equivalence — the real reference check) are manual, not part of `npm test` or CI. **Fix:** promote to a CI job (nightly is fine) to catch encoder drift.
- **6.5 — No visual/rendering regression. MEDIUM.** `render-stitches.test.ts` asserts call-counts on a fake ctx, not pixels; no screenshot comparisons anywhere. **Fix:** Playwright screenshot snapshots of the simulator on canonical designs (realistic on/off).

**Test plan, highest value first:** 6.1 → 6.2 → 6.3 → 6.4 → 6.5 → bundle-size budget (4.7).

---

## 7. Accessibility

**Strong:** Dialog focus management is genuinely well done — `useDialogFocus` (`useEscapeToClose.ts:21-57`) focuses in, **traps Tab in both directions**, and restores focus on close; used by all four modals with `aria-modal`. Global shortcuts early-return when a modal is open or focus is in a field (`App.tsx:262-265`). ToolRail items are real buttons with `aria-label`/`aria-keyshortcuts`/`aria-pressed` (`ToolRail.tsx:244-246`). The canvas exposes a polite live region describing state (`CanvasStage.tsx:1050-1060`). a11y is tested twice: `vitest-axe` on panels/dialogs and full-page `@axe-core/playwright` incl. color-contrast.

**Findings:**
- **7.1 — Canvas is pointer-only for authoring/reshaping. HIGH.** Keyboard reaches selection (LayerPanel `:174-181`) + nudge/reorder/delete/duplicate via shortcuts, but **not** drawing/creating, node editing, or scale/rotate — all pointer-drag only, and objects can't be cycled/selected on-canvas by keyboard. Inherent to canvas editors, but should be documented and supplemented (keyboard object-cycling; numeric position/size inputs in `PropertiesPanel`).
- **7.2 — `ColorSelect` announces `listbox` semantics it doesn't implement. MEDIUM.** `role="listbox"`/`option` + `aria-expanded` (`ColorSelect.tsx:53-98`) but no focus-into-list, no `aria-activedescendant`, no arrow/Home/End/typeahead, and interactive `<button>`s nested inside `role="option"` (non-standard). Operable via Tab+Enter so axe likely passes, but it violates its own announced model. **Fix:** real listbox keyboard nav, or drop the roles and present a plain button menu.
- **7.3 — Contrast under-scanned. MEDIUM.** Component axe tests disable `color-contrast` (`a11y.dom.test.tsx:24-31`); the e2e contrast pass loads only empty `/` and `/app` — never a dialog, populated panel, toast, tooltip, disabled state (`disabled:opacity-40`), or stitch view. With the muted cream/butter/navy palette + low-opacity UI (grid at 0.08), this is a real risk. **Fix:** e2e axe with dialogs/panels open and in stitch view; spot-check disabled/low-opacity text vs WCAG AA.
- **7.4 — Context menu opens pointer-only. LOW.** Right-click/long-press only (`CanvasStage.tsx:311-318`); mitigated because its actions exist as shortcuts/panels.
- **7.5 — Simulator controls labeled & keyboard-usable. POSITIVE.** Play/pause (Space), labeled scrub range, speed select (`SimulatorBar.tsx:96-130`).
- **Test gaps:** the focus-trap/restore logic itself is untested; no keyboard full-flow test (select→nudge→delete). **Fix:** a jsdom test that Tabs past the last dialog element and asserts wrap + restore.

---

## 8. UX & resilience

- **Failure behavior — mostly good.** Export errors map through `friendlyExportError`; the serialized `exportChain` keeps `.catch` alive so one failure can't wedge later exports (`export/index.ts:246-249,307-319`); Pyodide load nulls its promise on failure to allow retry (`loader.ts:100-104`). **But:** (a) under the enforced CSP, import/Python-export fail every time (exec #1); (b) no import size guard → tab OOM (3.2); (c) a render throw outside the root boundary blanks the app (5.3).
- **Data-loss risk — addressed.** Autosave exists (`src/lib/autosave.ts`, wired in `App.tsx`) with storage writes wrapped for private mode; `.embproj` JSON is the documented source of truth. Worth confirming a `beforeunload` guard for unsaved-work edge cases.
- **Browser support.** WASM is required only for the Python path (import + minority formats); native writers keep DST/PES-v1 working without it — the right graceful-degradation shape. Safari + the main-thread Pyodide load is the roughest combo; show a clear message when `WebAssembly` is absent. `version.json` polling enables refresh-into-new-deploy.

---

## 9. Open-source readiness

**Strong:** MIT `LICENSE`; thorough, honest `README.md` (283 lines incl. privacy/security/a11y, local-run, hosting); solid `CONTRIBUTING.md` (mm convention, engine-purity rule, CSP + a11y guardrails, dev commands that match package.json). CI runs typecheck + lint + unit tests + build + Playwright e2e (incl. axe and CSP specs) + Lighthouse on every PR; Pages deploy on main. Bundled **fonts are license-enforced by a test** (`text/fonts.test.ts` accepts only OFL-1.1/Apache-2.0). No secrets in the tree or a history filename scan; `dist/` untracked; **zero** TODO/FIXME markers and **zero** `console.log` in shipped code.

**Gaps:**
- **Runtime dependency licensing docs. MEDIUM (compliance).** pyembroidery (MIT) and Pyodide (MPL-2.0) are fetched at runtime, not vendored — document them in a THIRD-PARTY/NOTICE section. And **ship the OFL/Apache license texts** alongside the bundled fonts (the OFL requires the license text to accompany the font); currently only SPDX ids are recorded in `fonts.ts`.
- **Community health files missing. LOW.** No `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates, or PR template.
- **Build reproducibility. OK.** `npm install && npm run dev/build` per README works; consider `.nvmrc`/`engines` (CI uses Node 22) so contributors match.

---

## Remediation roadmap

**Quick wins (< 1 hour each)**
1. Pin `pyembroidery==1.5.1` in `micropip.install` (2.3).
2. Fix CSP `connect-src` for PyPI + the tesseract model host — or self-host both (2.2, 3.5); then manually verify import on the deployed site.
3. Add an import byte-size / stitch-count cap with a friendly error (3.2).
4. `moveObjects`: translate `o.nodes` too (1.4).
5. PyProxy `.destroy()` in `finally` (2.5); `bs:zoom` deps array (4.6); surface the swallowed stitch-count error (5.3).
6. Soften "byte-identical" doc claims to "functionally equivalent" (1.2).
7. Add `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates, `.nvmrc`; ship font license texts + a THIRD-PARTY notice (9).

**High-impact**
1. Move Pyodide to a Web Worker with abort/timeout; consider a binary boundary instead of JSON (2.1, 2.4).
2. Golden third-party fixtures → Pyodide import integration + bytes round-trip → malformed-byte fuzzing → oracle scripts in CI (6.1–6.4).
3. Re-check min-spacing in the tenths domain / assert it on decoded bytes (1.1).
4. Memoize `ObjectShape` + stabilize callbacks; isolate the live cursor/draft preview (4.4).
5. Incremental playback segments + realistic-mode auto-disable above a stitch threshold (4.1).

**Longer-term**
- Keyboard authoring path (object cycling, numeric position/size inputs) and a real listbox `ColorSelect` (7.1, 7.2).
- Viewport culling + low-zoom decimation of the preview (4.2).
- Error boundaries around `CanvasStage`/dialogs (5.3); split the god modules (5.4).
- Bundle-size CI budget (4.7); expanded contrast/dialog axe scans + a focus-trap test (7.3).
- Visual regression snapshots of the simulator (6.5).

---

## Done well — patterns to keep

- **Native TS PES/DST writers** bypassing Pyodide for the common formats — the right call for memory-constrained mobile, and a clean fast path.
- **Safety gates on the final assembled stream** (jam-safety min spacing, long-move splitting for stitches *and* jumps, STOP properly quarantined to the Python path).
- **Excellent type discipline** (no `any` in production code) and **defensive deserialization** of untrusted project JSON.
- **All heavy deps lazy** and out of the entry chunk (Pyodide/tesseract/opentype/imagetracer); Konva vendor-split.
- **Untrusted binary parsing sandboxed in WASM**; zero HTML-injection sinks; no SVG-to-DOM path; strict CSP with an e2e guard; fonts license-enforced by a test.
- **Dialog focus management** (trap + restore) and a **canvas live region** — above-average a11y foundations.
- **Extensive pure-engine unit tests** plus a **numeric metrics regression bench** with a committed baseline.
- Clean release hygiene: honest README, no secrets, no shipped console noise, zero TODO markers, versioned deploys with update detection.
