/// <reference types="vitest/config" />
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Client-side routing ("/" homepage, "/app" studio) needs the static host to
// serve the SPA for deep paths. GitHub Pages serves `404.html` for any unknown
// path, so we copy the built index.html to 404.html — visiting "/app" (or
// reloading it) then boots the same app, which reads the path and shows the
// studio. Asset URLs are absolute (base "/"), so they resolve from the root
// regardless of how deep the visited path is.
function spaFallback(): Plugin {
  let outDir = "dist";
  return {
    name: "spa-404-fallback",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      const index = resolve(outDir, "index.html");
      if (existsSync(index)) copyFileSync(index, resolve(outDir, "404.html"));
    },
  };
}

// A unique id per build, baked into the bundle and written to version.json so a
// running tab can detect a newer deploy and refresh into it (see lib/version.ts).
const BUILD_ID = String(Date.now());

// Emit an unhashed version.json alongside the build carrying BUILD_ID.
function emitVersion(): Plugin {
  return {
    name: "emit-version",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ id: BUILD_ID }),
      });
    },
  };
}

// The app is hosted from static files (GitHub Pages, custom domain at the root).
// `base` is absolute ("/") so deep-linked routes like "/app" load their assets
// from the site root. Override with BASE_PATH when deploying under a sub-path.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), spaFallback(), emitVersion()],
  build: {
    rollupOptions: {
      output: {
        // Split the heavy canvas library into its own vendor chunk so it caches
        // independently of app code (and keeps the entry chunk under the warning
        // limit). opentype.js and pyodide are already lazy-loaded on demand.
        manualChunks: {
          konva: ["konva", "react-konva"],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
