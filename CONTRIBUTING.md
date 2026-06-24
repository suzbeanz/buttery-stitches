# Contributing to Buttery Stitches

Thanks for your interest! Buttery Stitches is meant to be a community-maintainable
OSS project, so clarity beats cleverness here.

## Ground rules

- **The stitch-generation logic must stay pure and tested.** Functions in the
  stitch engine take geometry + params and return ordered stitch points. No
  reaching into the store, no DOM, no side effects. They are the part that's
  expensive to get wrong — every algorithm change needs a unit test.
- **Work in millimeters.** The entire app model is in mm; only the exporter
  converts to pyembroidery's 1/10 mm units.
- **The `.embproj` JSON is the source of truth.** PES and friends are lossy
  exports. Don't add features that depend on round-tripping through PES.
- **Ask before architecture changes** — especially adding a backend, swapping
  the raster tracer, or changing the data model in `src/types/project.ts`.
- **Keep it client-only and private.** No network calls beyond the on-demand
  Pyodide runtime, no third-party scripts/fonts, no analytics/telemetry. New
  origins must be added to the CSP in `index.html` *and* justified — the
  `e2e/csp.spec.ts` check fails the build on an unexpected third-party request.
- **Don't regress accessibility.** New interactive UI needs an accessible name,
  the right ARIA state, and keyboard reachability; modals use the shared
  `useDialogFocus` + `useEscapeToClose` hooks. The axe checks in
  `src/test/a11y.dom.test.tsx` (jsdom) and `e2e/a11y.spec.ts` (full page) guard
  this — keep them green and add coverage for new components.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest, incl. axe a11y checks)
npm run typecheck  # TypeScript check (note: the real type gate is `tsc -b` in build)
npm run build      # full production build
npm run e2e        # Playwright e2e (run `npx playwright install chromium` once)
```

## Code style

- TypeScript strict mode is on; keep it green.
- Prefer clear names and short comments that explain *why*, not *what*.
- Match the style of the surrounding code.

## Commit / PR

- Small, focused commits with descriptive messages.
- Include or update tests for any stitch-math change.
- Check it against the running polish list in `docs/polish-todo.md`.
