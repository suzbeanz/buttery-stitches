/**
 * Lazy Pyodide loader. Pyodide (~10 MB compressed + packages) is heavy, so we
 * only load it the first time the user exports. The runtime is fetched from a
 * CDN by default — override `PYODIDE_INDEX_URL` (or self-host the files) for a
 * fully offline / air-gapped deployment.
 *
 * pyembroidery is installed from a SELF-HOSTED wheel bundled in `public/wheels/`
 * (pure Python, no native deps — de-risked before the rest of the app was
 * built). Installing from PyPI would need pypi.org/files.pythonhosted.org in
 * the CSP `connect-src` — origins the deployed meta-CSP deliberately excludes —
 * and an unpinned `micropip.install("pyembroidery")` could drift from the
 * 1.5.1 semantics the native writers were validated against. Self-hosting
 * keeps the "no third-party origins beyond the Pyodide CDN" privacy promise
 * AND pins the exact version.
 */

// Pin to the version we validated. Keep in sync with the `pyodide` devDep used
// for the Node de-risk test.
export const PYODIDE_VERSION = "0.27.7";
const DEFAULT_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** The bundled pyembroidery wheel, served from the app's own origin (public/).
 *  Keep the version in the filename in sync with the oracle scripts' pin. */
export const PYEMBROIDERY_WHEEL = "wheels/pyembroidery-1.5.1-py2.py3-none-any.whl";

// Minimal shape of the bits of the Pyodide API we use.
export interface PyodideInterface {
  loadPackage(names: string | string[]): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  globals: {
    get(name: string): unknown;
    set(name: string, value: unknown): void;
  };
  // pyembroidery returns Python `bytes`; .toJs() gives us a Uint8Array.
  // (Typed loosely; the real object is a PyProxy.)
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface>;
  }
}

export type LoadStage =
  | "idle"
  | "loading-runtime"
  | "loading-micropip"
  | "installing-pyembroidery"
  | "ready"
  | "error";

let pyodidePromise: Promise<PyodideInterface> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Reuse an existing tag if the loader was called more than once.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-pyodide]`,
    );
    if (existing) {
      if (window.loadPyodide) resolve();
      else existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load the Pyodide runtime script.")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.pyodide = "true";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load the Pyodide runtime script."));
    document.head.appendChild(script);
  });
}

/**
 * Get the shared Pyodide instance with pyembroidery installed, loading it on
 * first call. `onStage` reports progress so the UI can show what's happening
 * (the first load takes a few seconds).
 */
export function getPyodide(
  onStage?: (stage: LoadStage) => void,
  indexURL: string = DEFAULT_INDEX_URL,
): Promise<PyodideInterface> {
  if (pyodidePromise) return pyodidePromise;

  pyodidePromise = (async () => {
    try {
      onStage?.("loading-runtime");
      await injectScript(`${indexURL}pyodide.js`);
      if (!window.loadPyodide) {
        throw new Error("Pyodide script loaded but loadPyodide is missing.");
      }
      const pyodide = await window.loadPyodide({ indexURL });

      onStage?.("loading-micropip");
      await pyodide.loadPackage("micropip");

      onStage?.("installing-pyembroidery");
      // Absolute same-origin URL for the bundled wheel; BASE_URL keeps sub-path
      // deployments (BASE_PATH override) working.
      const wheelUrl = new URL(
        `${import.meta.env.BASE_URL}${PYEMBROIDERY_WHEEL}`,
        window.location.href,
      ).href;
      await pyodide.runPythonAsync(
        `import micropip\nawait micropip.install("${wheelUrl}")`,
      );

      onStage?.("ready");
      return pyodide;
    } catch (err) {
      // Allow a later retry if loading failed (e.g. offline first attempt).
      pyodidePromise = null;
      onStage?.("error");
      throw err;
    }
  })();

  return pyodidePromise;
}

/** True once Pyodide has finished loading at least once. */
export function isPyodideReady(): boolean {
  return pyodidePromise !== null;
}
