# Master‑Embroiderer Stitch Engine — Comprehensive Implementation Plan

Status: PLAN (no code yet). Scope: turn our already‑capable engine into a
master‑digitizer‑grade engine by closing precise gaps and adding the decisions a
professional makes that we don't yet. All work stays **pure, deterministic, in
millimeters**, preserves existing contracts, and is verified by metric probes +
CPython `pyembroidery` export. American spelling; no AI references in artifacts;
commits as `suzbeanz`.

---

## 0. Framing — what we are (and aren't) doing

Our engine is **not** primitive. It already implements (file:line):
- Medial‑axis satin with junction‑chaining for lettering (`medial.ts`).
- Density compensation on curves (`satin.ts:99`, `medial.ts:466`).
- Width‑driven pull compensation (`satin.ts:59`).
- Tiered, fabric‑aware underlay (center / edge‑walk / zigzag; fill edge + parallel)
  (`underlay.ts`).
- Principal‑axis auto fill angle with one shared angle per multi‑region object
  (`fill.ts:281`).
- Split‑satin corner mitering with brick stagger (`satin.ts:122`, `resample.ts:141`).
- Lock stitches via backward retrace, coincident collapse, nearest‑neighbor routing
  within color blocks (`index.ts:66,337,477`).
- A non‑blocking validation pass (`validate.ts`).

So this is a **precision + decision upgrade**, layered onto the existing
architecture. Hard contracts we must preserve:
- `designFor(project)` memoizes on project reference (immutable updates only).
- Output is `EngineStitch[]` (`x,y,colorId,objectId,jump?,trim?,underlay?`).
- Color‑block order is never reordered; only intra‑block routing changes.
- Safety floors hold: `MIN_SAFE_DENSITY=0.3mm`, min gap `0.25mm`, coincident
  collapse `0.05mm`.
- Underlay and top are separate `StitchRun`s so the assembler can jump between them.

---

## 1. The master numeric reference (researched defaults)

> Sourced from leading commercial digitizer docs & blogs, open-source digitizers, Embroidery Legacy, Madeira,
> mySewnet, EduTech wiki, DST/Tajima format specs, plus corroborating digitizing
> guides. Values flagged **[contested]** vary by source/use‑case and ship as
> tunable defaults, not gospel.

### 1.1 Stitch‑type selection by geometry (mean width `w`, length, aspect, area)
| Condition | Type |
|---|---|
| `w < ~1.0–1.3 mm` (hairline) | running (single); **bean/triple** for bold outlines (3 passes default; 5/7 optional) |
| `1.3 mm ≤ w ≤ satinMax` AND elongated (aspect ≳ 2) | satin column |
| `w > satinMax` OR roundish/large area | tatami / complex fill |
- Satin **min** width: `1.0 mm` absolute, **`1.5 mm` recommended** for sheen, `1.5–2.0 mm` on pile.
- Satin **max** width: **`7 mm` wearables**, `~10 mm` general, `~12 mm` commercial/heavy. **[contested]** → fabric/use‑case driven.
- Below viable satin width → convert to running. Above max → split satin or convert to fill.

### 1.2 Density / spacing (40wt baseline)
| Type | Default | Range |
|---|---|---|
| Tatami row spacing | `0.40 mm` | `0.35–0.45 mm` |
| Satin row spacing | `0.40 mm` | `0.35–0.50 mm` (0.4–0.6 by fabric) |
| Tatami stitch length (along row) | `3.0–4.0 mm` | `2.5–4.0 mm`, exposed ≤ 7 mm |
| Running stitch length | `2.0–2.5 mm` | `1.0–5.0 mm`; outlines 2.5–3 mm; tight detail 1.25 mm |
- **Thread weight:** 60wt → tighten spacing ~25–30% (e.g. 0.40→~0.30 mm); 30wt → open slightly.
- Fill **underlay** row spacing ≈ **3× top spacing** (~1.2 mm).

### 1.3 Underlay (by satin width tier; fabric scales it up)
| Column width | Underlay |
|---|---|
| `~1.5–2 mm` | center‑run only |
| `> ~3 mm` | edge‑run mandatory (inset **0.35 mm straight / 0.6–0.7 mm on curves**) |
| `≥ ~4 mm` | edge‑run **+ zigzag** (or double‑zigzag for loft) |
| `> ~10 mm` | don't satin — fill |
- **Ordering rule:** zigzag underlay stitches **before** edge‑run (else the zigzag pulls the edge inward).
- Underlay run stitch length `1.5–2.0 mm`; zigzag spacing `0.4–0.8 mm`.
- Fill underlay: edge run + tatami/zigzag at **~90°** to the top; mesh = `45°/135°`.
- Running: **no underlay.**
- Fabric: knit/pile/stretch → heavier (double zigzag / lattice); woven/leather → lighter.

### 1.4 Push–pull compensation
- **Pull** (across width) makes columns narrower → widen rails. **Push** (along stitches) makes column **ends** overshoot → shorten ends.
- Rule of thumb (per‑side widen): `~0.15 mm @ 2 mm column → ~0.30 mm @ 7 mm` (≈ linear). Define **per‑side** (open-source digitizer model), not total. **[contested: per‑side vs total]**
- Fabric starting points: **woven `0.17–0.20 mm`**, **knit/piqué `0.35–0.40 mm`**, **fleece `0.40 mm`**, sheer lower, leather low.

### 1.5 Max stitch length & splitting (format‑aware)
- **DST/ternary hard max = `12.1 mm`** (deltas ±1/3/9/27/81 ×0.1mm). **Binary/Barudan = `12.7 mm`.** Longer ⇒ jump/trim.
- **Satin auto‑split ≈ `7 mm`** throw; **randomize split penetrations** so they don't form a center line. Disable split for 3D foam.
- Wearables: never expose a single stitch > ~7 mm; non‑wearables tolerate up to format max.

### 1.6 Tatami fill detail
- Stagger/offset **`0.25` (1/4 brick) = 4‑row repeat**; add seeded randomness to kill moiré/split‑lines.
- Fill **angle default 45°**; align to shape flow; **adjacent regions must differ** (≥ ~20–45°). Auto from 16‑angle grid minimizing fragments.
- **Straight tatami** for blocky/large; **turning/contour fill** for curved/organic (the "Complex Turning" technique = multiple angles).
- Holes/islands: even‑odd clip scanlines against all boundaries; route travels as **underpath inside the shape**.

### 1.7 Lettering minimums
- Min legible height: **`6.35 mm` (0.25") block**, **`9.5 mm` (3/8") serif**.
- Strokes below viable satin width → running. Warn below legible height.

### 1.8 Fabric profiles (ship as "Auto‑Fabric")
| Fabric | Density mult | Pull‑comp (per side) | Underlay | Stitch len | Special |
|---|---|---|---|---|---|
| Woven | 1.0 (0.40) | 0.18 mm | standard | normal | — |
| Knit/stretch | ~1.0–1.1 (looser) | 0.35–0.40 mm | heavy (edge+zigzag) | +travel loft | cutaway |
| Pile/towel | tighter +10–20% | 0.30 mm | heavy/double | 4.0–4.5 mm | **knockdown + topping**, no edge sink |
| Sheer | looser 0.6–0.7 | low (0.10) | light/none | normal | minimize show‑through |
| Leather/vinyl | 0.45–0.6 | low | minimal | 3.0–4.0 mm | fewer perforations |

---

## 2. Gap → upgrade map (highest leverage first)

| # | Gap (today) | Upgrade | Primary files |
|---|---|---|---|
| 1 | `FabricProfile` is 3 multipliers | Full **Auto‑Fabric** profile (density, stitch length, per‑width pull‑comp, underlay tier, knockdown) recomputed per object | `types/project.ts`, `engine/index.ts` |
| 2 | Export splits at fixed ~12 mm | **Format‑aware** split (12.1 ternary / 12.7 binary) + randomized penetrations | `export/index.ts`, `engine/index.ts` |
| 3 | Only pull comp (width) | Add **push compensation** (shorten satin ends) | `satin.ts`, `medial.ts` |
| 4 | Fill pull/push **deferred** | Directional **fill compensation** (region outset, not per‑row) | `fill.ts`, new helper |
| 5 | One angle per object | **Per‑region angle** + adjacent‑region contrast | `fill.ts`, `index.ts` |
| 6 | No short stitches on curves | **Short‑stitch insertion** on inner radius of satin curves/corners | `satin.ts`, `medial.ts`, new `shortstitch.ts` |
| 7 | Split only by throw length | **Adaptive split** on width spikes + randomized, non‑aligned penetrations | `satin.ts`, `resample.ts` |
| 8 | No bean/triple | **Bean stitch** (3/5/7 passes) for bold outlines | new `bean.ts`, `classify`, params |
| 9 | Straight tatami only | **Turning/contour fill** auto‑selected for curved shapes | new `turningfill.ts`, `fill.ts` |
| 10 | No pile handling | **Knockdown + topping** stitches for pile | new `knockdown.ts`, `index.ts` |
| 11 | Underlay tiers approximate | **Numeric‑exact tiers** + zigzag‑before‑edge ordering | `underlay.ts` |
| 12 | Routing is NN within color | **Underpath travel** inside fills; format‑aware jump/trim; seeded lock patterns | `index.ts` |
| 13 | No thread‑weight awareness | **Thread weight** (40/60/30) scales density | `types/project.ts`, `index.ts` |
| 14 | Lettering can go illegible | **Lettering guards** (min satin width → running; legibility warnings) | `classify.ts`, `validate.ts` |
| 15 | Fixed 1/4 stagger | Seeded **stagger randomization** to kill moiré | `fill.ts`, `resample.ts` |

---

## 3. Phased plan (each phase ships independently, green tests + export)

### Phase A — Profiles, thread weight & format‑aware safety (foundation)
- **Data model** (`types/project.ts`): expand `FabricProfile` to full numeric fields; add `FABRICS` rich table (§1.8); add `threadWeight?: 30|40|60` (default 40) on project (and optional per color); add optional params `pushComp`, `splitRandomSeed`. All optional + back‑compat in `parseProject`.
- **Engine** (`index.ts`): resolve density/stitch‑length/pull/underlay/knockdown from the profile + thread weight in `generateObjectRuns` (replace the 3‑multiplier path). Keep the `MIN_SAFE_DENSITY` floor.
- **Export** (`export/index.ts`): `maxStitchMm` per format (DST/EXP→12.1, others→12.7/12.7‑equiv); split long stitches at the format limit with **seeded randomized** break points; keep finite‑coordinate gate.
- **Tests:** profile resolution; thread‑weight density scaling; per‑format split limit (no stitch exceeds limit); determinism with seed.

### Phase B — Satin finesse
- **Push compensation:** shorten satin column ends by a fabric‑scaled amount (new in `satin.ts`/`medial.ts`).
- **Short stitches:** on the **inner radius** of curves and at corners, insert shortened throws so the inner rail doesn't bunch (new `shortstitch.ts`; integrate in `satinColumn` + medial throw placement). Numeric: trigger when inner/outer advance ratio exceeds threshold; hold inner penetration back, insert 1 short stitch per N throws.
- **Adaptive split + randomized penetrations:** split where width spikes (not just throw length); randomize split offsets (seeded) so no center seam.
- **Tests:** inner‑rail gap bounded on tight curves; no center‑line alignment (penetration‑column histogram); ends shortened by push amount; deterministic.

### Phase C — Fill finesse
- **Per‑region angle + contrast:** angle per region (keep multi‑region continuity option), nudge adjacent regions to differ; auto from principal axis else 45°.
- **Turning/contour fill:** auto‑select contour/turning for curved shapes (extend `contour.ts` or new `turningfill.ts`); straight tatami otherwise.
- **Fill compensation:** directional region outset for pull (and inset for push) — the deferred item — done at region level, not per row, to avoid fraying.
- **Stagger randomization:** seeded jitter on the 1/4 brick to kill moiré.
- **Tests:** adjacent regions differ; turning fill follows curvature; coverage maintained; compensation outset bounded; determinism.

### Phase D — Underlay numeric overhaul
- Recode tiers to §1.3 exact numbers; **zigzag‑before‑edge** ordering; fill underlay 3× spacing at 90°; fabric scales tier; **knockdown** (`knockdown.ts`) + topping flag for pile.
- **Tests:** tier by width; ordering; inset on curves; knockdown emitted for pile.

### Phase E — Routing, ties, trims, jumps
- **Underpath travel** inside fills; **format‑aware** jump/trim thresholds; min‑jump‑before‑trim; seeded/standard **lock patterns** (3–4 stitch tie shapes); keep color‑block order.
- **Tests:** travels stay inside region; trims only beyond threshold; lock count/shape; no reorder across colors.

### Phase F — Bean, lettering guards, validation & UI
- **Bean stitch** (`bean.ts`) as a running variant (3/5/7 passes) + param + UI.
- **Lettering guards** in `classify.ts`/`validate.ts` (min satin width → running; legibility warnings by height).
- **Validation** expanded: push/pull sanity, per‑format max stitch, lettering, knockdown presence on pile.
- **UI** (`DesignPanel.tsx`, `PropertiesPanel.tsx`): fabric type (rich), thread weight, push comp, fill flow (straight/contour/auto), bean repeats, short‑stitch toggle — mirroring existing param controls.

---

## 4. Data‑model changes (precise)
- `FabricProfile`: `{ name, densityMm, stitchLenMm, pullCompPerSide(widthMm)→mm, underlay: tier spec, knockdown?: boolean, topping?: boolean, minSatinMm }`.
- `Project`: `threadWeight?: 30|40|60` (default 40); existing `fabric?` stays.
- `EmbObjectParams` additions (all optional, defaulted): `pushComp?`, `fillFlow?: "auto"|"straight"|"contour"`, `beanRepeats?: 0|3|5|7`, `shortStitch?: boolean`, `splitMode?: "auto"|"off"`.
- Export options: `maxStitchMm` derived from format; `seed` for deterministic randomization.
- **Back‑compat:** every new field optional; `parseProject` fills defaults; old `.embproj` loads unchanged.

## 5. New modules
- `engine/shortstitch.ts` — inner‑radius short‑stitch insertion.
- `engine/turningfill.ts` — contour‑following multi‑angle fill.
- `engine/knockdown.ts` — pile knockdown grid + topping marker.
- `engine/bean.ts` — multi‑pass running.
- `engine/profile.ts` — resolve fabric+thread‑weight → concrete parameters (single source of truth used by all generators).

## 6. Verification strategy (the bar for "master")
- **Unit tests** per module with numeric invariants (above).
- **Metric probes** (extend existing): coverage ≥ threshold; inner‑rail gap ≥ 0.25 mm on tight curves; longest exposed stitch ≤ wearable/format limit; **penetration‑column alignment** test (no center seam after split); per‑region angle distinctness; short‑stitch presence on curvature.
- **Determinism:** all randomization seeded; same project → identical design (existing invariant).
- **Journey suite:** all 8 bundled fonts sewable under each fabric; longest stitch ≤ limit; coverage ≥ threshold.
- **CPython `pyembroidery`:** export a mixed design (thin stem + word + broad fill + pile case) to all 5 formats × fabrics — valid files, longest stitch ≤ format max, sane stitch/jump/trim counts, color blocks intact.
- `npm run typecheck && npm run lint && npx vitest run && npm run build` green every phase.

## 7. Risks & decisions to lock
- **Pull comp per‑side vs total:** adopt **per‑side** (open-source digitizer convention) consistently; document.
- **Satin max:** make **fabric/use‑case driven** (7 wearable default, up to 10–12 for stable/decorative).
- **Randomization vs determinism:** seed everything; tests assert determinism.
- **Performance:** turning fill + medial are heavy; keep memoization; cap grid sizes (existing 4M‑cell guard).
- **Source confidence:** primary commercial-tool docs were 403 to fetch; numbers are corroborated across sources but ship as tunable defaults.

## 8. Recommended sequencing
A → B → D → C → E → F. (Foundations first; satin + underlay give the biggest
visible quality jump for lettering/logos; fills and routing next; bean/UI/validation
last.) Each phase is independently shippable and verified.

---

## 9. Final research refinements (precise numbers for B/C/E)

### 9.1 Satin density by column width (AmeFird) — density *increases* with width
| Width | spacing (no underlay) | spacing (with underlay) |
|---|---|---|
| 2–3 mm | ~0.20 mm (125 SPI) | ~0.17 mm (150 SPI) |
| 3–4 mm | ~0.18 mm (138 SPI) | ~0.15 mm (165 SPI) |
| 4–6 mm | ~0.17 mm (150 SPI) | ~0.14 mm (180 SPI) |
| 6–8 mm | ~0.145 mm (175 SPI) | ~0.127 mm (200 SPI) |
(SPI→mm ≈ 25.4/SPI.) Our current flat `~0.4 mm` satin spacing is too open for wide
columns vs. pro practice — Phase B should scale spacing with width toward these.
**[contested vs. the simpler 0.35–0.5 mm guidance; ship as width‑curve, tunable.]**

### 9.2 Short stitches on satin curves/corners (Phase B)
- Trigger: when inner‑rail stitch length collapses (curvature), i.e. inner advance ≪ outer.
- Geometry: shorten **every other** inner‑edge stitch so its penetration lands **~1/2 across** the column (vary 1/3–2/3 on consecutive shorts so they don't ridge).
- Params (open-source digitizer model): `shortStitchDistance` (length below which a stitch is "short") and `shortStitchInset` (fraction of width to pull in). Practical engine trigger: per‑stitch angular change ≳ 5–10°.

### 9.3 Corners (Phase B)
- Total turn ≈ 90° → **miter** (taper to a point, widen out the other side).
- Sharper/long turns → **cap** (entry column → flat low‑angle end‑cap object → exit column) or split into separate columns.
- Shallow turns → no special handling. Keep per‑stitch angle change small by adding rungs; outer side spacing > inner side through the turn.
- Push distortion ≈ **0.13–0.20 mm** at full density (40wt) → trim column ends by ≈ the pull added.

### 9.4 Routing / connectors / ties (Phase E) — engine decision procedure
1. **Sequence:** background→foreground (last stitched = on top), grouped by color block (never reorder across colors), then nearest‑neighbor / closest‑join within a block; recompute joins on any geometry/sequence change.
2. **Entry/exit:** place at closest‑join positions to the next object (exit next to the adjoining object).
3. **Per connector** of length `L`, test if its whole path lies under a **later‑sequenced** object's footprint:
   - under later coverage → **travel run, no trim/tie‑off** (length ~1.8 mm on curves, up to ~4.0 mm straight).
   - exposed and `L < ~3 mm` → leave untrimmed (invisible).
   - exposed and `L > trimThreshold` → **tie‑off + trim** (tieOffThreshold ≤ trimThreshold).
4. **Tie‑offs:** multi‑stitch default; **single tie‑off + shorter length for thin columns / small text.**
5. **Format reality:** machines convert N consecutive jumps→trim (Brother default 3, range 1–8) and won't physically cut jumps below their own min (e.g. 5–50 mm in 5 mm steps); long stitches > format max (12.1/12.7) auto‑become jumps.

### 9.5 Puckering/registration safeguards (cross‑cutting, validate.ts)
- Split pull across two axes (underlay opposes top; large fills can layer) to halve per‑axis distortion.
- "Never line‑to‑line" — abutting objects should **overlap 1–2 mm** (trapping) so no gap shows; pull‑comp 0.2–0.4 mm closes knit gaps.
- Stitch largest areas first, details last; group colors; minimize hoop traverses.

### 9.6 Sourcing caveat
Primary commercial-tool docs returned HTTP 403 during research; all numbers are
corroborated across multiple independent sources but ship as **tunable defaults**,
to be confirmed by stitch‑out. Determinism is preserved by seeding any randomization.
