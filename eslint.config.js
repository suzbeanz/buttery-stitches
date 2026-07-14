import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Flat ESLint config for the app source. Type-aware linting is intentionally
 * left off so lint stays fast and decoupled from tsconfig; `npm run typecheck`
 * (tsc) is the source of truth for types. Stylistic and refresh rules are
 * warnings so they never block a build.
 */
export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules", ".claude"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Our labels wrap their control directly, which satisfies "either".
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either" }],
      // Focusing a modal's first field on open is intentional focus management.
      "jsx-a11y/no-autofocus": "off",
      // Modal backdrops intentionally close on click (Escape/Cancel also close);
      // surface these as guidance rather than hard errors.
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
    },
  },
  // Node/tooling scripts and config files run outside the browser.
  {
    files: ["scripts/**/*.{js,mjs}", "*.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
  // Production app source ships to the BROWSER: `process` is undefined there
  // and a stray `process.env.X` crashes the feature that touches it at runtime
  // (it happened — a debug flag in the engine broke auto-digitize). Tests and
  // bench code run under node and may keep using it.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/lib/bench/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "process",
          message:
            "`process` does not exist in the browser. Use import.meta.env, or guard with typeof process !== 'undefined'.",
        },
      ],
    },
  },
);
