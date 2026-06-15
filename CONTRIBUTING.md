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

## Development

```bash
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest)
npm run typecheck  # strict TypeScript check
npm run build      # full production build
```

## Code style

- TypeScript strict mode is on; keep it green.
- Prefer clear names and short comments that explain *why*, not *what*.
- Match the style of the surrounding code.

## Commit / PR

- Small, focused commits with descriptive messages.
- Include or update tests for any stitch-math change.
- Check it against the running polish list in `docs/polish-todo.md`.
