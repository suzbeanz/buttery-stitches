# Buttery Stitches — agent notes

## Standing practice: watch code reviews
Always watch code reviews — regardless of branch, commit, or PR. On every PR
you open: subscribe to its activity, request a Copilot review, address review
findings (fix + push + resolve the thread), and keep it watched until merged
or closed. Periodically sweep ALL open PRs for unresolved review threads and
red CI, and handle what's actionable.

## Product constraint: input art class
Source images are ALWAYS simple flat-color artwork — logos, line art, and
soft-shaded cartoon/animal art. NEVER photos. Photos are deliberately out of
scope (the wizard warns and does not pretend otherwise): detection heuristics,
tracers and tests may assume a small, flat, quantizable palette and must not
spend complexity on photographic robustness.

## Local gates (match CI)
- `npm run typecheck` (tsc -b --force — catches unused locals bare `tsc --noEmit` misses)
- `npm run build`
- `npx eslint src --max-warnings 0`
- `npx vitest run --no-file-parallelism`
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test`

## Quality bars
Stitch-quality thresholds in the bench/tests are measured from commercial
reference designs (never committed — only the derived named constants are).
Change the mechanism to meet a gate; never loosen a gate to pass.
