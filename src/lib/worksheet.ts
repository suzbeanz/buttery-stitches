import type { Project, ThreadColor } from "../types/project";
import { designFor, type EngineStitch } from "./engine";

/**
 * Printable thread worksheet: the color-change sequence an operator follows at
 * the machine — swatch, thread name/brand/code, and stitch count per stop, plus
 * totals and an estimated run time.
 */

/** Typical home-machine speed and the overhead of a color change. */
const STITCHES_PER_MIN = 600;
const SECONDS_PER_COLOR_CHANGE = 20;

export interface WorksheetRow {
  stop: number; // 1-based color-stop order
  rgb: [number, number, number];
  name?: string;
  brand?: string;
  code?: string;
  stitches: number;
}

export interface Worksheet {
  rows: WorksheetRow[];
  totalStitches: number;
  colorStops: number;
  estMinutes: number;
}

/** Group the design into consecutive color stops and tally stitches each. */
export function buildWorksheet(
  project: Project,
  design: EngineStitch[] = designFor(project),
): Worksheet {
  const byId = new Map<string, ThreadColor>(project.colors.map((c) => [c.id, c]));
  const rows: WorksheetRow[] = [];
  let prev: string | null = null;
  let total = 0;

  for (const s of design) {
    if (s.colorId !== prev) {
      const c = byId.get(s.colorId);
      rows.push({
        stop: rows.length + 1,
        rgb: c?.rgb ?? [0, 0, 0],
        name: c?.name,
        brand: c?.brand,
        code: c?.code,
        stitches: 0,
      });
      prev = s.colorId;
    }
    if (!s.jump) {
      rows[rows.length - 1].stitches += 1;
      total += 1;
    }
  }

  const estMinutes =
    total / STITCHES_PER_MIN + (rows.length * SECONDS_PER_COLOR_CHANGE) / 60;

  return {
    rows,
    totalStitches: total,
    colorStops: rows.length,
    estMinutes,
  };
}

/** Human-friendly duration, e.g. "1 h 04 m" or "7 m". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} m`;
  return `${h} h ${String(m).padStart(2, "0")} m`;
}

const hex = ([r, g, b]: [number, number, number]) =>
  "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Render the worksheet as a self-contained, print-friendly HTML document
 * (butter-themed). Opened in a new tab so the user can print or save to PDF.
 */
export function worksheetHtml(worksheet: Worksheet, title = "Buttery Stitches"): string {
  const rows = worksheet.rows
    .map(
      (r) => `
      <tr>
        <td class="num">${r.stop}</td>
        <td><span class="swatch" style="background:${hex(r.rgb)}"></span></td>
        <td>${esc(r.name ?? "Unnamed")}</td>
        <td>${esc(r.brand ?? "—")}</td>
        <td>${esc(r.code ?? "—")}</td>
        <td class="num">${r.stitches.toLocaleString()}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${esc(title)} — Thread Worksheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Libre+Franklin:wght@400;600&display=swap" rel="stylesheet" />
<style>
  /* Pressed Butter brand tokens — match the app exactly. */
  :root { --ink:#173A7A; --ink-deep:#102A57; --butter:#F1DE8B; --cream:#F6EFCB; --stamp:#B23A2E; --char:#25241C; }
  body { font-family: "Libre Franklin", "Helvetica Neue", Arial, sans-serif; color: var(--char);
         background: var(--cream); margin: 2rem; }
  h1 { font-family: "Oswald", "Arial Narrow", sans-serif; text-transform: uppercase;
       letter-spacing: .04em; font-size: 1.5rem; color: var(--ink-deep); margin: 0 0 .25rem; }
  .sub { color: var(--ink); margin:0 0 1.25rem; }
  .totals { display:flex; gap:2rem; margin: 0 0 1.25rem; }
  .totals div { font-size:.8rem; text-transform:uppercase; letter-spacing:.08em; color:var(--ink); }
  .totals div span { display:block; font-family:"Oswald",sans-serif; font-size:1.5rem; font-weight:600; color:var(--ink-deep); }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid rgba(23,58,122,.18); }
  th { background: var(--butter); color: var(--ink-deep); font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; }
  .num { text-align:right; font-variant-numeric: tabular-nums; }
  .swatch { display:inline-block; width:22px; height:22px; border-radius:2px;
            border:1.5px solid var(--ink-deep); vertical-align:middle; }
  .print { margin-top:1.5rem; }
  button { font-family:"Oswald",sans-serif; text-transform:uppercase; letter-spacing:.08em;
           padding:.5rem 1rem; background:var(--ink); color:var(--cream);
           border:2px solid var(--ink-deep); border-radius:2px; box-shadow:0 2px 0 var(--ink-deep); cursor:pointer; }
  @media print { .print { display:none; } body { margin:0; background:#fff; } }
</style></head>
<body>
  <h1>🧈 ${esc(title)} — Thread Worksheet</h1>
  <p class="sub">Stitch in this color order, top to bottom.</p>
  <div class="totals">
    <div>Stitches<span>${worksheet.totalStitches.toLocaleString()}</span></div>
    <div>Color stops<span>${worksheet.colorStops}</span></div>
    <div>Est. run time<span>${formatDuration(worksheet.estMinutes)}</span></div>
  </div>
  <table>
    <thead><tr><th class="num">#</th><th>Color</th><th>Name</th><th>Brand</th><th>Code</th><th class="num">Stitches</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="print"><button onclick="window.print()">Print / Save as PDF</button></div>
</body></html>`;
}
