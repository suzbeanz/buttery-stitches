# Stitch-engine benchmark

The objective scoreboard for the digitizing engine. The goal is to make "are we
beating the leading commercial digitizers yet?" a **number on a shared corpus**, not an opinion — so every
engine change can be scored and no quality/efficiency dimension can silently
regress.

```bash
npm run bench
```

Scores every design in the corpus, prints the table, and writes
[`baseline.json`](./baseline.json) for diffing against future runs.

## What's measured

Pure functions of the compiled stitch stream (`src/lib/bench/metrics.ts`):

| Metric | Meaning | Better |
|---|---|---|
| `stitches` | needle penetrations | fewer for equal quality |
| `jumps` / `trims` | thread breaks the operator pays for | fewer |
| `thread(mm)` | thread actually laid | lower for equal coverage |
| `travel(mm)` / `travel%` | needle motion laying **no** thread (routing waste) | lower |
| `meanLen(mm)` | mean stitched-segment length | — (context) |
| `lenCV` | penetration-spacing evenness (coefficient of variation) | lower = smoother |
| `short%` | segments below 0.8 mm (needle-stress / lint risk) | lower |
| `coverage` | thread coverage of the fill regions (raster, ≈0.4 mm thread) | higher → 100% |

## The corpus

`src/lib/bench/corpus.ts` — canonical shapes that hit the distinct engine paths:
flat tatami (`rect`, `disc`), `contour`, concavity (`ring`, `golf-green`), the
turning fill (`crescent`), multi-object routing (`two-discs`), and `satin`.
Deterministic geometry + ids so a metric delta means an engine change, not noise.

## Reading it / where to push next

This is step **(b)** of the "surpass the commercial tools" plan — measure first. Early signals
the baseline already surfaces:

- `crescent-turning` covers **97.6%**, not 100% — the turning fill leaves small
  end-gaps. A coverage target the directional-field work should close.
- `satin-band` runs **27% short** stitches — expected for tight satin, but the
  metric to watch when curvature compensation changes.
- `travel%` is low on this corpus (single regions); it becomes the headline
  number once multi-region designs and a real routing optimizer land.

Next levers (highest first): a **guidance vector field** generalizing the
turning/flow fills (coverage + smoothness), then a **global routing optimizer**
(travel + trims).
