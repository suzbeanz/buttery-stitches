import type { Project, ThreadColor } from "../types/project";
import { generateDesign, type EngineStitch } from "./engine";

/**
 * Printable thread worksheet: the colour-change sequence an operator follows at
 * the machine — swatch, thread name/brand/code, and stitch count per stop, plus
 * totals and an estimated run time.
 */

/** Typical home-machine speed and the overhead of a colour change. */
const STITCHES_PER_MIN = 600;
const SECONDS_PER_COLOR_CHANGE = 20;

export interface WorksheetRow {
  stop: number; // 1-based colour-stop order
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

/** Group the design into consecutive colour stops and tally stitches each. */
export function buildWorksheet(
  project: Project,
  design: EngineStitch[] = generateDesign(project),
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
<style>
  :root { --navy:#16234A; --butter:#F9E9A6; --cream:#FFFDF3; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--navy);
         background: var(--cream); margin: 2rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  .sub { color:#555; margin:0 0 1.25rem; }
  .totals { display:flex; gap:2rem; margin: 0 0 1.25rem; }
  .totals div span { display:block; font-size:1.4rem; font-weight:bold; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid #ddd; }
  th { background: var(--butter); }
  .num { text-align:right; font-variant-numeric: tabular-nums; }
  .swatch { display:inline-block; width:22px; height:22px; border-radius:4px;
            border:1px solid rgba(0,0,0,.3); vertical-align:middle; }
  .print { margin-top:1.5rem; }
  button { font:inherit; padding:.5rem 1rem; background:var(--navy); color:var(--butter);
           border:none; border-radius:6px; cursor:pointer; }
  @media print { .print { display:none; } body { margin:0; background:#fff; } }
</style></head>
<body>
  <h1>🧈 ${esc(title)} — Thread Worksheet</h1>
  <p class="sub">Stitch in this colour order, top to bottom.</p>
  <div class="totals">
    <div>Stitches<span>${worksheet.totalStitches.toLocaleString()}</span></div>
    <div>Colour stops<span>${worksheet.colorStops}</span></div>
    <div>Est. run time<span>${formatDuration(worksheet.estMinutes)}</span></div>
  </div>
  <table>
    <thead><tr><th class="num">#</th><th>Colour</th><th>Name</th><th>Brand</th><th>Code</th><th class="num">Stitches</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="print"><button onclick="window.print()">Print / Save as PDF</button></div>
</body></html>`;
}
