# What real PES files teach us (stitch-quality benchmark)

Measured from 7 professionally-digitized PES files (A Day At Sea, Hot Dog ×2,
Brewster 1–3, hl_…) plus an industry-standard production worksheet for
"Hot Dog 100". These are the targets our engine must hit. Analyzed with
`pyembroidery` (script in git history / `/tmp/analyze*.py`).

## Measured numbers

| File | Size mm | Colors | Stitches | trims+jumps /1000 | median stitch | max stitch | short <0.5mm | satin-ish turns |
|---|---|---|---|---|---|---|---|---|
| A Day At Sea | 65×89 | 7 | 8,572 | 2.9 | 1.90 | 7.05 | 8.4% | 39% |
| Hot Dog 120 | 120×118 | 4 | 16,647 | 0.2 | 3.98 | 5.06 | 1.8% | 18% |
| hl_… | 92×97 | 2 | 15,749 | 2.3 | 1.49 | 7.02 | 2.3% | 60% |
| Brewster 1 | 125×123 | 5 | 32,920 | 1.0 | 3.58 | 7.00 | 1.8% | 39% |
| Brewster 2 | 97×95 | 5 | 21,838 | 1.3 | 3.57 | 7.01 | 2.1% | 43% |
| Brewster 3 | — | — | — | 2.0 | — | — | — | 51% |
| Hot Dog 100 (worksheet) | 99.8×98.5 | 3 | 12,212 | — | — | **10.8** | min **0.3** | — |

Contiguous-run lengths: **median 130–4,500 stitches between breaks**, single runs
up to **14,868 stitches** unbroken. Design density **1.2–2.4 stitches/mm²**.
Hot Dog 100 worksheet: Tajima format, **max jump 6.1 mm**, color sequence
orange → red → **orange again** → yellow (the bun is sewn in two passes, back then
front over the sausage — deliberate layering).

## The lessons

1. **Pros barely cut the thread.** 0.2–2.9 trims+jumps per 1000 stitches; whole
   colors sew as one continuous path with internal *travel runs*, not jumps/trims.
   → **This was our biggest gap.** We left a jump on every 3–8 mm gap. **Fixed:**
   same-color gaps up to the trim threshold now sew a continuous travel run; only
   longer gaps / color changes trim. (`engine/index.ts`, TRAVEL_STITCH.)
2. **Max single stitch ≈ 7 mm satin, up to ~10–11 mm tatami** (non-wearable). Our
   7 mm satin cap matches; tatami can safely run longer than our 4 mm default
   (now user-tunable via fill stitch length). Min stitch ~0.3 mm — matches our
   floor.
3. **Satin everywhere.** 39–60% of turns are sharp reversals → outlines, details,
   and squiggles are satin columns, and broad areas are tatami *with satin
   outlines* on top for crisp edges. The Hot Dog: tatami bun + tatami sausage +
   satin mustard squiggle + satin edges. → We should lean satin for definition
   and offer easy auto-satin-outlines (we have an outline action; make it default-
   friendly).
4. **Short stitches are normal** (1.8–8.4%) — the inner-curve/corner technique. Our
   short-stitch feature matches; don't over-cull them.
5. **Deliberate layering / sequencing** — overlapping shapes are split and ordered
   (bun-back → sausage → bun-front) so seams read cleanly and travels hide under
   later coverage. → motivates smarter object sequencing + underpath-under-coverage.

## What we already match
7 mm satin cap; 4 mm tatami default + ≤7 mm throws; 0.3 mm density/stitch floor;
short stitches on curves; brick/jitter stagger; tiered fabric-aware underlay;
push/pull comp; format-aware export split (12.1/12.7).

## Prioritized remaining gaps (by impact)
1. **Underpath travel under coverage** (run a connector *beneath* a later object
   instead of trimming) — extends the travel-run win to longer gaps with zero
   visible thread. The pros' near-zero trim counts come from this.
2. **Auto satin outlines** on fills/shapes for the crisp "patch" edge, on by an
   easy toggle.
3. **Smart object sequencing / layering** (largest/background first, overlap
   trapping) so registration and seams match the worksheet's two-pass bun.
4. **Image auto-digitize quality** (Batch 2) — smooth traces, satin the thin
   regions, fewer/cleaner colors.
5. **Longer tatami default option** for big smooth fills (≤ ~10 mm), fewer
   penetrations, smoother sheen.

## How we verify against the benchmark
Re-run the `pyembroidery` analysis on our own exported design and compare:
trims+jumps /1000 → toward ≤3; max stitch ≤7 (satin) / ≤10 (tatami); short% in a
sane band; no stitch over the format limit. Plus a real sew-out review.
