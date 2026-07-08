import type { Project, ThreadColor } from "../types/project";
import { designFor, type EngineStitch } from "./engine";
import { BOBBIN_RATIO, estimateRuntimeMin } from "./engine/info";

/**
 * Printable thread worksheet: the color-change sequence an operator follows at
 * the machine — swatch, thread name/brand/code, stitch count and thread length
 * per stop, plus totals (incl. an estimated bobbin/under-thread figure) and an
 * estimated run time.
 *
 * The runtime + bobbin model is imported from `engine/info` so the worksheet and
 * the Check panel always agree (they used to diverge: 600 vs 700 spm).
 */

export interface WorksheetRow {
  stop: number; // 1-based color-stop order
  rgb: [number, number, number];
  name?: string;
  brand?: string;
  code?: string;
  stitches: number;
  /** top thread laid down at this stop (mm) — for spool ordering. */
  threadMm: number;
}

export interface Worksheet {
  rows: WorksheetRow[];
  totalStitches: number;
  colorStops: number;
  estMinutes: number;
  /** total top thread laid down (mm). */
  totalThreadMm: number;
  /** estimated bobbin/under-thread consumption (mm) — a rough ~⅓-of-top figure. */
  bobbinMm: number;
}

/** Group the design into consecutive color stops and tally stitches + thread. */
export function buildWorksheet(
  project: Project,
  design: EngineStitch[] = designFor(project),
): Worksheet {
  const byId = new Map<string, ThreadColor>(project.colors.map((c) => [c.id, c]));
  const rows: WorksheetRow[] = [];
  let prev: string | null = null;
  let total = 0;
  let trims = 0;
  let totalThreadMm = 0;
  let prevStitch: EngineStitch | null = null;

  for (const s of design) {
    if (s.trim) trims++;
    if (s.colorId !== prev) {
      const c = byId.get(s.colorId);
      rows.push({
        stop: rows.length + 1,
        rgb: c?.rgb ?? [0, 0, 0],
        name: c?.name,
        brand: c?.brand,
        code: c?.code,
        stitches: 0,
        threadMm: 0,
      });
      prev = s.colorId;
    }
    if (!s.jump && !s.trim && !s.stop) {
      const row = rows[rows.length - 1];
      row.stitches += 1;
      total += 1;
      if (
        prevStitch &&
        !prevStitch.jump &&
        !prevStitch.trim &&
        !prevStitch.stop &&
        prevStitch.colorId === s.colorId
      ) {
        const seg = Math.hypot(s.x - prevStitch.x, s.y - prevStitch.y);
        row.threadMm += seg;
        totalThreadMm += seg;
      }
    }
    prevStitch = s.jump || s.trim || s.stop ? null : s;
  }

  const colorChanges = Math.max(0, rows.length - 1);
  const estMinutes = estimateRuntimeMin(total, colorChanges, trims);

  return {
    rows,
    totalStitches: total,
    colorStops: rows.length,
    estMinutes,
    totalThreadMm,
    bobbinMm: totalThreadMm * BOBBIN_RATIO,
  };
}

/** Format a thread length (mm) for display: metres or feet by unit preference. */
export function formatThread(mm: number, unit: "mm" | "inch"): string {
  return unit === "inch"
    ? `${(mm / 25.4 / 12).toFixed(1)} ft`
    : `${(mm / 1000).toFixed(1)} m`;
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
export function worksheetHtml(
  worksheet: Worksheet,
  title = "Buttery Stitches",
  unit: "mm" | "inch" = "mm",
): string {
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
        <td class="num">${formatThread(r.threadMm, unit)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${esc(title)} — Thread Worksheet</title>
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
    <div>Top thread<span>${formatThread(worksheet.totalThreadMm, unit)}</span></div>
    <div>Bobbin (est.)<span>${formatThread(worksheet.bobbinMm, unit)}</span></div>
    <div>Est. run time<span>${formatDuration(worksheet.estMinutes)}</span></div>
  </div>
  <table>
    <thead><tr><th class="num">#</th><th>Color</th><th>Name</th><th>Brand</th><th>Code</th><th class="num">Stitches</th><th class="num">Thread</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="print"><button onclick="window.print()">Print / Save as PDF</button></div>
</body></html>`;
}
