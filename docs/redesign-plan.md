# Buttery Stitches — "Pressed Butter" Visual Overhaul Plan

Complete redesign of the homepage AND the app to the butter-wrapper brand guide
(Edition 01): flat ink on churned butter, the tablespoon tape as a structural
grid, "stamped" press components. Premium like French spring butter; classy;
"just works." Goal: make this look like the best open-source tool there is.

NOTE: this supersedes the earlier serif (Playfair/Old Standard) pass.

## Decisions (locked 2026-06-15)
- Toolbar: **left vertical tool rail** (icon + Oswald label, grouped).
- Homepage: **full editorial spread** (many numbered sections, magazine-style).
- Build order: **Foundations → Homepage → App shell → Toolbar → Fixtures → Voice/QA.**

## Progress
- [x] P0 Foundations (tokens, fonts, press primitives).
- [x] P1 Homepage (editorial wrapper).
- [x] P2 App shell (nameplate, canvas inks, panels, mono numbers).
- [x] P3 Left tool rail with custom stitch glyphs (+ snap/guides toggles).
- [x] P4 Fixtures: export menu, dialogs, quick-start, simulator bar in press style.
- [ ] P5 Voice & accessibility: wholesome microcopy pass; contrast/keyboard QA.

---

## 0. Foundations (design system)

### 0.1 Inks (Tailwind tokens → replace current palette)
| token | hex | role |
|---|---|---|
| `ink` | #173A7A | Press Blue — primary ink: wordmark, rules, buttons, type |
| `ink-deep` | #102A57 | Midnight Press — headings, deep press shadow |
| `stamp` | #B23A2E | Stamp Red — grade marks, measures, ONE cta accent |
| `butter` | #F1DE8B | Churned Butter — primary background fill |
| `butter-deep` | #E7CC63 | Deep Churn — panels / shadow edge |
| `foil` | #C9A227 | Foil Gold — hairlines, fine accents |
| `cream` | #F6EFCB | Cream Wrapper — paper / card stock |
| `char` | #25241C | Char Black — body copy |
Body background = butter radial wash (#F8F2D6 → #F1DE8B → #E7CC63) + faint grain.
Working CANVAS stays light cream so stitches/fabric read clearly.

### 0.2 Type (Google Fonts; serif fallbacks for offline)
- **Anton** — display / wordmark / section titles (UPPERCASE, condensed).
- **Oswald** 500–700 — labels, buttons, eyebrows, panel headers (uppercase, letterspaced).
- **Libre Franklin** 400–800 — body copy (sentence case, the readable workhorse).
- **DM Serif Display** italic — taglines / accents only ("Sweet & Unsalted").
- **Space Mono** — measurements & metadata: tick labels, hex, stitch counts, dimensions, file names.
Tailwind: `font-display / font-label / font-body / font-accent / font-mono`.
Default body → Libre Franklin (drop the Old Standard serif).

### 0.3 "Printed" component rules
- Flat fills only — NO gradients/glows/glassy sheen on components.
- 2.5px ink borders; square-ish corners (2–3px).
- Hard **press shadow**: `box-shadow: 0 3px 0 <ink-deep>` (offset, not blurred), not a soft glow. Tailwind `shadow-press`.
- Reserve Stamp Red for marks, measures, and a single CTA — never flood.

### 0.4 Shared primitives to build (new components)
- **`Tape`** (canonical ruler): 8 majors / 32 minors, 2.5px ink rule, taller end-caps, Space Mono **red** labels centered under each division. Props: `labels?`, `variant: 'divider'|'progress'|'scale'`, `fillPct?` (red progress), `fullBleed?`. Replaces `RulerStrip`; powers section dividers, the playback meter, and stat scales. Flat — no rounded ends/shadow.
- **`PressButton`** — `variant: primary (ink) | stamp (red) | ghost (ink outline)`, Oswald caps, `shadow-press`.
- **`Stamp`** — format/grade chip: outline / solid / red.
- **`GradeStamp`** — the circular "GRADE / AA / STITCH" mascot (app icon, hero flanks, empty states).
- **`Field`** — Oswald label + 2px-ink white input.
- **`PressCard`** — cream card, 2.5px ink border, `shadow-press` (panels, hero label, comp cards).
- **`SectionHead`** — Space-Mono red "Section 0X", Anton title, Oswald right-aligned sub.

### 0.5 The full-bleed ruler GRID (your key note)
The tape rule runs **edge-to-edge** and is the structural skeleton:
- Homepage: a full-bleed `Tape` divider opens every section; content sits in a
  centered measured column; the tape's end-caps + ticks frame the page like a
  printed sheet.
- App: a full-bleed `Tape` under the nameplate bar; the canvas's own top/left
  rulers are restyled to the same tape device, so the whole workspace reads as
  one measured grid. Panels align to the same horizontal rules.

---

## 1. Homepage (`Home.tsx`) — the label, fully rebuilt
A focused premium landing (not the 9-section guide), using the devices:
1. **Hero label** — a `PressCard`: topline ("U.S. Open Source" · "Net Wt. Free"),
   `GradeStamp` flanking the stacked **Anton** wordmark with the DM-Serif red
   "Sweet & Unsalted" descriptor above and an Oswald tagline below; Space Mono
   "NET WT. FREE" line. Primary CTA **Start Stitching** (ink press button).
2. Full-bleed **Tape** divider (Tbsp labels) between every block.
3. **The Spread** — short story/positioning (Libre Franklin lede, ink bold).
4. **What it does** — 3 press-cards (Pictures / Words / Preview & Export) with
   the single-weight 2px line motifs (image→stitch, butter stick, needle/thread).
5. **How it works** — the Tape as a **progress meter** (Trace→Path→Fill→Satin→
   Tie→Preview→Export) filled in Stamp Red.
6. **Formats** — `Stamp` row (PES/DST/JEF/EXP/VP3) + "Grade AA" / "Net Wt. Free".
7. **Footer band** — Anton "Net Wt. Free · 100% Open Source" between two ink
   rules, Space Mono meta, Made-with-love + social.
Voice throughout: plain, wholesome, proud — no startup jargon, sparing puns.

---

## 2. App shell
- **TopBar → Nameplate press bar**: Press Blue field, `GradeStamp` app mark +
  Anton "BUTTERY STITCHES", actions as compact icon+Oswald-label controls;
  full-bleed `Tape` directly beneath.
- **Panels (Stitch Order / Properties / Design) → `PressCard` blocks**: cream
  stock, ink border, `shadow-press`, Oswald uppercase headers, Space Mono for all
  numbers (stitch counts, dimensions, density), `Field` inputs.
- **SimulatorBar → the Tape as a playback progress meter** (red fill = position;
  Space Mono counts), Edit/Stitch as a segmented `tag-strip`.
- **CanvasStage**: recolor `C` to the inks (Press Blue, butter, cream); restyle
  the on-canvas rulers to the `Tape` device; hoop drawn in press-blue ink line
  with the grade-stamp registration feel; keep fabric light for legibility.

---

## 3. Toolbar redesign (the explicit ask — fix the confusing icons)
- **Group the palette**: Selection (Select · Edit points · Eraser) | Create
  (Line · Satin · Fill · Shape · Words · Picture) | Modify (Curve) | Units.
- **Custom stitch-glyph icons** (single-weight 2px, press blue) that DEPICT the
  stitch instead of generic tool metaphors — this is the premium, self-evident fix:
  - Running → a dashed running-stitch line.
  - Satin → a satin column (two rails + rungs).
  - **Fill → a rounded shape filled with stitch rows** (replaces the paint-bucket,
    which read as a classic paint-fill tool).
  - Edit points → anchor squares on a path (replaces the pen, which read as "draw").
  - Shape/Words/Picture/Eraser → clean line glyphs.
- **Oswald micro-labels** under each icon (foolproof for first-timers / 60+).
- Consolidate the "Add" creation actions (Picture/Words/Shape currently in the
  top bar) INTO the tool palette so "make something" is one obvious place.
- Decide rail layout: **left vertical tool rail** (more room for label+icon,
  separates create vs select, premium) vs. keep the horizontal strip.

---

## 4. Fixtures everywhere
Buttons → `PressButton`; inputs → `Field`; export formats → `Stamp`s; dialogs
(Add words / Use a picture / Help) → `PressCard` with Oswald headers and the
press shadow; tooltips → ink on cream. Stitch count / dimensions in Space Mono.

## 5. Voice & "just works"
Microcopy pass to the wholesome butter voice ("Free. No sign-up. Stays on your
machine."). First-run clarity, plain labels, big targets — foolproof for a 60+
maker. No emoji overload, no jargon.

---

## Execution phases (each: typecheck + lint + 244 tests + build green, then deploy)
- **P0 Foundations** — tokens, fonts, `shadow-press`, primitives (`Tape`,
  `PressButton`, `Stamp`, `GradeStamp`, `Field`, `PressCard`, `SectionHead`).
- **P1 Homepage** rebuild.
- **P2 App shell** (nameplate, ruler grid, panels, SimulatorBar tape).
- **P3 Toolbar** (custom glyphs, grouping, labels, layout).
- **P4 Fixtures + Canvas/Hoop recolor + dialogs.**
- **P5 Voice/microcopy + accessibility (contrast) + final QA.**

## Guardrails
- American spelling; no AI/Claude refs; commits as suzbeanz.
- Contrast: verify Char-on-Butter, Ink-on-Cream, Cream-on-Ink, Stamp-on-Cream.
- Fonts via CDN (deploy is online); serif/system fallbacks if offline.
- Keep the single-`Shape` stitch renderer (playback stability) — recolor only.
- No gradients/glows on components; flat press shadows only.
