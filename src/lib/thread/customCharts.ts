import type { Thread, ThreadChart } from "./catalog";

/**
 * User-imported thread charts. We deliberately don't ship manufacturers'
 * licensed catalog data (see catalog.ts), but anyone who OWNS a chart — a CSV
 * from their thread supplier, a community-shared palette — can import it here
 * and get real brand names + order codes on the worksheet.
 *
 * Formats accepted:
 *  - CSV / TSV / semicolons, one thread per line, with or without a header:
 *      code, name, #RRGGBB
 *      code, name, r, g, b
 *  - JSON: either a full ThreadChart ({ name, threads: [...] }) or a bare
 *    array of { code, name, rgb | hex } objects.
 *
 * Imported charts persist in localStorage (best-effort — private-mode safe).
 */

const STORAGE_KEY = "bs:threadCharts";

/** A chart id that can't collide with built-ins. */
const customId = (name: string) =>
  "custom-" +
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function parseHex(s: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function parseByte(s: string): number | null {
  const v = Number(s.trim());
  return Number.isFinite(v) && v >= 0 && v <= 255 ? Math.round(v) : null;
}

/** Parse one CSV line into a Thread, or null if it isn't one (header, blank). */
function parseCsvLine(line: string, brand: string, delim: string): Thread | null {
  const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
  if (cells.length < 3) return null;
  const [code, name] = cells;
  if (!code || !name) return null;
  // 3-column: code, name, #hex
  if (cells.length === 3) {
    const rgb = parseHex(cells[2]);
    return rgb ? { brand, code, name, rgb } : null;
  }
  // 5-column: code, name, r, g, b
  const r = parseByte(cells[2]);
  const g = parseByte(cells[3]);
  const b = parseByte(cells[4]);
  if (r === null || g === null || b === null) return null;
  return { brand, code, name, rgb: [r, g, b] };
}

function detectDelimiter(text: string): string {
  const head = text.slice(0, 2000);
  const counts: [string, number][] = [
    ["\t", (head.match(/\t/g) ?? []).length],
    [";", (head.match(/;/g) ?? []).length],
    [",", (head.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

function isThreadArray(v: unknown): v is { code: unknown; name: unknown }[] {
  return Array.isArray(v) && v.every((t) => t && typeof t === "object");
}

function threadFromJson(raw: Record<string, unknown>, brand: string): Thread | null {
  const code = typeof raw.code === "string" || typeof raw.code === "number" ? String(raw.code) : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  if (!code || !name) return null;
  let rgb: [number, number, number] | null = null;
  if (Array.isArray(raw.rgb) && raw.rgb.length === 3) {
    const [r, g, b] = raw.rgb.map((n) => parseByte(String(n)));
    if (r !== null && g !== null && b !== null) rgb = [r, g, b];
  } else if (typeof raw.hex === "string") {
    rgb = parseHex(raw.hex);
  }
  if (!rgb) return null;
  const rowBrand = typeof raw.brand === "string" && raw.brand ? raw.brand : brand;
  return { brand: rowBrand, code, name, rgb };
}

/**
 * Parse chart file text into a ThreadChart. `chartName` doubles as the brand
 * for rows that don't carry their own. Throws a friendly Error when nothing
 * parseable is found (the UI shows the message verbatim).
 */
export function parseChartFile(text: string, chartName: string): ThreadChart {
  const name = chartName.trim() || "Imported chart";
  const threads: Thread[] = [];

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error("That JSON file couldn't be read — check it for syntax errors.");
    }
    const obj = json as Record<string, unknown>;
    const list = isThreadArray(json) ? json : isThreadArray(obj.threads) ? obj.threads : null;
    if (!list) throw new Error("Expected a list of threads (or { threads: [...] }).");
    const jsonName = typeof obj.name === "string" && obj.name ? obj.name : name;
    for (const raw of list) {
      const t = threadFromJson(raw as Record<string, unknown>, jsonName);
      if (t) threads.push(t);
    }
    if (threads.length === 0)
      throw new Error("No usable threads found — each needs a code, a name, and rgb [r,g,b] or hex.");
    return { id: customId(jsonName), name: jsonName, threads };
  }

  // CSV / TSV
  const delim = detectDelimiter(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const t = parseCsvLine(line, name, delim);
    if (t) threads.push(t);
  }
  if (threads.length === 0)
    throw new Error(
      'No usable rows found. Use "code, name, #hex" or "code, name, r, g, b" — one thread per line.',
    );
  return { id: customId(name), name, threads };
}

/** Load persisted custom charts (best-effort; [] in private mode / bad data). */
export function loadCustomCharts(): ThreadChart[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Re-validate through the JSON path so corrupt storage can't crash the UI.
    return parsed.flatMap((c) => {
      try {
        const chart = c as ThreadChart;
        if (!chart || typeof chart.name !== "string" || !Array.isArray(chart.threads)) return [];
        const threads = chart.threads.flatMap((t) => {
          const parsedT = threadFromJson(t as unknown as Record<string, unknown>, chart.name);
          return parsedT ? [parsedT] : [];
        });
        return threads.length ? [{ id: customId(chart.name), name: chart.name, threads }] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** Add (or replace, by id) a custom chart and persist. Returns the new list. */
export function saveCustomChart(chart: ThreadChart): ThreadChart[] {
  const list = loadCustomCharts().filter((c) => c.id !== chart.id);
  list.push(chart);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage full / private mode — chart still usable this session
  }
  return list;
}

/** Remove a custom chart by id and persist. Returns the new list. */
export function removeCustomChart(id: string): ThreadChart[] {
  const list = loadCustomCharts().filter((c) => c.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // best-effort
  }
  return list;
}
