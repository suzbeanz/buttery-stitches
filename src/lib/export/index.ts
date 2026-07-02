import { getPyodide, type LoadStage, type PyodideInterface } from "../pyodide/loader";
import { encodeDst } from "./native/dst";
import { encodePes } from "./native/pes";
import embroideryPy from "./embroidery.py?raw";
import type { Project, ThreadColor } from "../../types/project";
import { mmToTenths } from "../units";
import { designFor, type EngineStitch } from "../engine";
import { zipStore } from "../zip";

/**
 * Export pipeline: turn the engine's design into embroidery file bytes via
 * pyembroidery in Pyodide, then download. The plan is the only boundary to
 * Python and is built from the same `generateDesign` output that drives the
 * on-canvas simulator, so preview and file always agree.
 */

export const EMB_FORMATS = ["pes", "dst", "jef", "exp", "vp3"] as const;
export type EmbFormat = (typeof EMB_FORMATS)[number];

/** Most compatible PES first; #PES0060 carries richer color data. */
export const PES_VERSIONS = [1, 6] as const;
export type PesVersion = (typeof PES_VERSIONS)[number];

/** One command in 1/10 mm units: stitch, jump, trim, or machine stop. */
export type PlanCmd =
  | ["s", number, number]
  | ["j", number, number]
  | ["t"]
  | ["stop"];

/** One thread color and its command stream. */
export interface PlanBlock {
  rgb: number;
  cmds: PlanCmd[];
}

export interface StitchPlan {
  blocks: PlanBlock[];
}

/** Pack a ThreadColor's rgb triple into a single 0xRRGGBB integer. */
export function packRgb(color: ThreadColor): number {
  const [r, g, b] = color.rgb;
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/**
 * Convert an engine design into a color-blocked plan in 1/10 mm units.
 * Consecutive same-color stitches share a block; a color change starts a new
 * block (the exporter trims + color-changes between blocks).
 */
export function planFromDesign(
  design: EngineStitch[],
  colors: ThreadColor[],
): StitchPlan {
  const rgbById = new Map(colors.map((c) => [c.id, packRgb(c)]));
  const blocks: PlanBlock[] = [];
  let current: PlanBlock | null = null;
  let currentColor: string | null = null;

  design.forEach((s) => {
    // Belt-and-suspenders: never let a non-finite coordinate reach the file
    // (it would become int(NaN) in pyembroidery and fail the export opaquely).
    // The engine shouldn't produce these, but a malformed import might.
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return;
    const startsBlock = s.colorId !== currentColor;
    if (startsBlock) {
      current = { rgb: rgbById.get(s.colorId) ?? 0, cmds: [] };
      blocks.push(current);
      currentColor = s.colorId;
    }
    // A machine STOP (appliqué pause) rides after the point already stitched —
    // emit the STOP command, not another penetration.
    if (s.stop) {
      current!.cmds.push(["stop"]);
      return;
    }
    // A within-color trim (the color-change trim is implied by the block
    // boundary, so skip it on the first event of a block).
    if (s.trim && !startsBlock) current!.cmds.push(["t"]);
    const x = mmToTenths(s.x);
    const y = mmToTenths(s.y);
    current!.cmds.push(s.jump ? ["j", x, y] : ["s", x, y]);
  });

  // Anchor the design at the origin (bounding-box MIN → 0,0) so the stitch stream
  // occupies [0..w]×[0..h], all-positive. This matches what professional PES files
  // do (verified against reference frog/hotdog files, whose stitch bounds start at
  // (0,0)); the machine then positions/centers it the same way it does those. This
  // is NOT origin-CENTERING (which subtracts the centre and yields negative coords
  // the machine clamps to the hoop edge) — it subtracts the MIN, so min is exactly 0.
  return { blocks: anchorBlocks(blocks) };
}

/** Translate every coordinate-bearing command so the design's bounding-box MIN is
 *  at (0,0) — the all-positive, origin-anchored layout professional PES files use.
 *  Trims/stops carry no coordinate and pass through. */
export function anchorBlocks(blocks: PlanBlock[]): PlanBlock[] {
  let minX = Infinity, minY = Infinity;
  for (const b of blocks) {
    for (const c of b.cmds) {
      if (c[0] !== "s" && c[0] !== "j") continue;
      if (c[1] < minX) minX = c[1];
      if (c[2] < minY) minY = c[2];
    }
  }
  if (!Number.isFinite(minX) || (minX === 0 && minY === 0)) return blocks;
  return blocks.map((b) => ({
    rgb: b.rgb,
    cmds: b.cmds.map((c) => (c[0] === "s" || c[0] === "j" ? [c[0], c[1] - minX, c[2] - minY] : c)),
  }));
}

/**
 * Largest single stitch/jump delta a format tolerates, in 1/10 mm. DST and EXP
 * use Tajima ternary encoding capped at 12.1 mm (121 units); the binary-coded
 * formats tolerate ~12.7 mm. Anything longer is silently reinterpreted by the
 * machine as a jump/trim ("invisible embroidery"), so we split it ourselves.
 */
export const MAX_STITCH_TENTHS: Record<EmbFormat, number> = {
  dst: 121,
  exp: 121,
  pes: 127,
  jef: 127,
  vp3: 127,
};

/**
 * Subdivide any stitch or jump longer than the format's maximum into equal
 * sub-moves (deterministic; ≤ max each). Trims carry no coordinate, so they pass
 * through untouched. Splitting is per block — a color change resets the cursor,
 * and the exporter handles the inter-block connector itself.
 */
export function splitPlanForFormat(plan: StitchPlan, format: EmbFormat): StitchPlan {
  const max = MAX_STITCH_TENTHS[format];
  const blocks = plan.blocks.map((b) => {
    const cmds: PlanCmd[] = [];
    let px = 0;
    let py = 0;
    let have = false;
    for (const cmd of b.cmds) {
      if (cmd[0] === "t" || cmd[0] === "stop") {
        cmds.push(cmd); // no coordinate to split
        continue;
      }
      const [kind, x, y] = cmd;
      if (have) {
        const dx = x - px;
        const dy = y - py;
        const dist = Math.hypot(dx, dy);
        if (dist > max) {
          const n = Math.ceil(dist / max);
          for (let i = 1; i < n; i++) {
            cmds.push([kind, Math.round(px + (dx * i) / n), Math.round(py + (dy * i) / n)]);
          }
        }
      }
      cmds.push([kind, x, y]);
      px = x;
      py = y;
      have = true;
    }
    return { rgb: b.rgb, cmds };
  });
  return { blocks };
}

/** Build a plan directly from a project (runs the stitch engine). */
export function planFromProject(project: Project): StitchPlan {
  return planFromDesign(designFor(project), project.colors);
}

/** Total penetrations (excludes jumps) in a plan — handy for UI/feedback. */
export function planStitchCount(plan: StitchPlan): number {
  return plan.blocks.reduce(
    (n, b) => n + b.cmds.filter((c) => c[0] === "s").length,
    0,
  );
}

let pythonLoaded = false;
async function ensurePython(pyodide: PyodideInterface): Promise<void> {
  if (pythonLoaded) return;
  await pyodide.runPythonAsync(embroideryPy);
  pythonLoaded = true;
}

export interface ExportOptions {
  format: EmbFormat;
  pesVersion?: PesVersion;
  onStage?: (stage: LoadStage) => void;
}

/** Build the embroidery file bytes for a plan. Loads Pyodide on first use. */
// Exports share Pyodide globals (__plan_json/__fmt), so two overlapping calls
// would clobber each other's plan. Serialize them through a single chain.
let exportChain: Promise<unknown> = Promise.resolve();

/** True if a plan contains an appliqué STOP (the native DST writer can't yet
 *  encode it, so those plans take the Python path). */
function planHasStop(plan: StitchPlan): boolean {
  return plan.blocks.some((b) => b.cmds.some((c) => c[0] === "stop"));
}

export async function exportToBytes(
  plan: StitchPlan,
  { format, pesVersion = 1, onStage }: ExportOptions,
): Promise<Uint8Array> {
  // Native, runtime-free path for DST (universal format). No Pyodide download —
  // works on memory-constrained mobile browsers where the Python runtime fails.
  // Validated sew-equivalent to pyembroidery (scripts/oracle-dst.ts). STOPs fall
  // through to Python until the native writer encodes them.
  if (format === "dst" && !planHasStop(plan)) {
    onStage?.("ready");
    return encodeDst(splitPlanForFormat(plan, "dst"));
  }

  // Native PES version 1 — the format the user's Brother machine reads. Same
  // motivation as DST: no Pyodide download on memory-constrained phones.
  // Validated functionally equivalent to pyembroidery's write_pes(...,{"version":1})
  // (scripts/oracle-pes.ts — stitches + colors gate the check). v6 and
  // STOP-bearing plans stay on the Python path.
  if (format === "pes" && pesVersion === 1 && !planHasStop(plan)) {
    onStage?.("ready");
    return encodePes(splitPlanForFormat(plan, "pes"));
  }

  const run = exportChain.then(async () => {
    const pyodide = await getPyodide(onStage);
    await ensurePython(pyodide);

    // Split any over-long stitch/jump for the target format before serializing,
    // so the machine never silently turns a long stitch into a jump/trim.
    const safe = splitPlanForFormat(plan, format);
    pyodide.globals.set("__plan_json", JSON.stringify(safe));
    pyodide.globals.set("__fmt", format);
    pyodide.globals.set("__pes_version", pesVersion);

    const result = (await pyodide.runPythonAsync(
      `export_bytes(__plan_json, __fmt, __pes_version)`,
    )) as { toJs: () => Uint8Array; destroy: () => void };

    // destroy() in finally so the PyProxy can't leak if toJs() throws.
    try {
      return result.toJs();
    } finally {
      result.destroy();
    }
  });
  // Keep the chain alive even if this export rejects, so a failure doesn't
  // permanently wedge later exports.
  exportChain = run.catch(() => undefined);
  return run;
}

/**
 * Export the plan to several formats at once and bundle them into a single .zip
 * (STORE mode). Each file is generated through the same serialized chain as a
 * single export, so it's just as safe — handy for sending a design to a shop in
 * every machine format in one click.
 */
export async function exportBundle(
  plan: StitchPlan,
  formats: readonly EmbFormat[],
  { pesVersion = 1, onStage, baseName = "buttery-stitches" }: {
    pesVersion?: PesVersion;
    onStage?: (stage: LoadStage) => void;
    baseName?: string;
  } = {},
): Promise<Uint8Array> {
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const format of formats) {
    const data = await exportToBytes(plan, { format, pesVersion, onStage });
    entries.push({ name: `${baseName}.${format}`, data });
  }
  return zipStore(entries);
}

/** A design read back from an embroidery file: color blocks of contiguous stitch
 *  RUNS, in 1/10 mm units (mirrors the export plan shape). */
export interface ImportedPlan {
  blocks: { rgb: number; runs: [number, number][][] }[];
}

/** Hard ceiling on an imported file's size. Real embroidery files are well under
 *  1 MB (the largest commercial designs run a few hundred KB); a crafted
 *  multi-megabyte file could exhaust the WASM heap / crash the tab while
 *  pyembroidery expands it into stitch lists. 16 MB is generous headroom. */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

/** Read an embroidery file's bytes into an {@link ImportedPlan} via pyembroidery.
 *  Serialized through the same chain as exports so they never clobber globals. */
export async function importDesignBytes(
  bytes: Uint8Array,
  format: EmbFormat,
  onStage?: (stage: LoadStage) => void,
): Promise<ImportedPlan> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error(
      `This file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — embroidery files are far smaller. It may be corrupt or not an embroidery file.`,
    );
  }
  const run = exportChain.then(async () => {
    const pyodide = await getPyodide(onStage);
    await ensurePython(pyodide);
    pyodide.globals.set("__import_bytes", bytes);
    pyodide.globals.set("__import_fmt", format);
    const json = (await pyodide.runPythonAsync(
      `import_design(__import_bytes, __import_fmt)`,
    )) as string;
    return JSON.parse(json) as ImportedPlan;
  });
  exportChain = run.catch(() => undefined);
  return run;
}

/**
 * Turn a raw export failure (a Pyodide load error, a multi-line Python traceback,
 * a network blip) into one friendly sentence for the user. Pure, so it's unit
 * tested; the UI shows the result instead of a raw stack trace.
 */
export function friendlyExportError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  if (low.includes("failed to fetch") || low.includes("networkerror") || low.includes("micropip"))
    return "Couldn't download the export engine. Check your connection and try again.";
  if (low.includes("pyodide") || low.includes("loadpyodide") || low.includes("runtime script"))
    return "Couldn't load the export engine. Check your connection and try again.";
  if (low.includes("traceback") || low.includes("write_") || low.includes("embpattern") || low.includes("pyembroidery"))
    return "Sorry — this design couldn't be written to that format. Please report it if it keeps happening.";
  // Fallback: the last non-empty line (Python puts the real message last), capped.
  const line = raw.split("\n").map((s) => s.trim()).filter(Boolean).pop() ?? "Unknown error";
  return line.length > 160 ? line.slice(0, 157) + "…" : line;
}

/** Trigger a browser download of raw bytes. */
export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime = "application/octet-stream",
): void {
  const blob = new Blob([bytes.slice()], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Convenience: build + download in one call. */
export async function exportAndDownload(
  plan: StitchPlan,
  filename: string,
  options: ExportOptions,
): Promise<void> {
  const bytes = await exportToBytes(plan, options);
  const name = filename.toLowerCase().endsWith(`.${options.format}`)
    ? filename
    : `${filename}.${options.format}`;
  downloadBytes(bytes, name);
}
