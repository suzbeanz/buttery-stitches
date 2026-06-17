// Auto-update: detect when a newer bundle has been deployed and refresh into it,
// so a browser (or CDN) holding a stale copy doesn't keep running old code. The
// build stamps a unique id into both this bundle (__BUILD_ID__) and a tiny
// /version.json; we compare them and reload when they diverge.

declare const __BUILD_ID__: string;

/** Build id baked in at compile time. "dev" outside a production build. */
export const BUILD_ID: string =
  typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

const RELOAD_GUARD = "bs:reloaded-for";

/** The deployed id from version.json, fetched past any cache, or null. */
async function deployedId(): Promise<string | null> {
  try {
    const url = `${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return typeof data.id === "string" ? data.id : null;
  } catch {
    return null; // offline, or version.json absent (dev/preview) — ignore.
  }
}

async function checkOnce(): Promise<void> {
  const id = await deployedId();
  if (!id || id === BUILD_ID) return;
  // A newer bundle is live. Reload once per distinct deployed id: if a stale
  // HTML cache survives the reload, the guard stops us looping forever.
  try {
    if (sessionStorage.getItem(RELOAD_GUARD) === id) return;
    sessionStorage.setItem(RELOAD_GUARD, id);
  } catch {
    // sessionStorage unavailable — skip the loop guard but still reload once.
  }
  location.reload();
}

/**
 * Start watching for a newly deployed build. Checks on load and whenever the tab
 * regains focus, so a long-lived tab picks up deploys without a manual refresh.
 * No-op outside a production build.
 */
export function startVersionWatch(): void {
  if (BUILD_ID === "dev") return;
  void checkOnce();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkOnce();
  });
}
