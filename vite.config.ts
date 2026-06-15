/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is designed to be hosted from static files (e.g. GitHub Pages).
// `base` is relative so the build works from any sub-path. Override with
// the BASE_PATH env var when deploying to a fixed project page.
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  plugins: [react()],
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
