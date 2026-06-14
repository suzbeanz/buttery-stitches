import { getPyodide, type LoadStage, type PyodideInterface } from "../pyodide/loader";
import embroideryPy from "./embroidery.py?raw";
import type { Project, ThreadColor } from "../../types/project";
import { mmToTenths } from "../units";
import { generateDesign, type EngineStitch } from "../engine";

/**
 * Export pipeline: turn the engine's design into embroidery file bytes via
 * pyembroidery in Pyodide, then download. The plan is the only boundary to
 * Python and is built from the same `generateDesign` output that drives the
 * on-canvas simulator, so preview and file always agree.
 */

export const EMB_FORMATS = ["pes", "dst", "jef", "exp", "vp3"] as const;
export type EmbFormat = (typeof EMB_FORMATS)[number];

/** Most compatible PES first; #PES0060 carries richer colour data. */
export const PES_VERSIONS = [1, 6] as const;
export type PesVersion = (typeof PES_VERSIONS)[number];

/** One command in 1/10 mm units: stitch, jump, or trim. */
export type PlanCmd = ["s", number, number] | ["j", number, number] | ["t"];

/** One thread colour and its command stream. */
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
 * Convert an engine design into a colour-blocked plan in 1/10 mm units.
 * Consecutive same-colour stitches share a block; a colour change starts a new
 * block (the exporter trims + colour-changes between blocks).
 */
export function planFromDesign(
  design: EngineStitch[],
  colors: ThreadColor[],
): StitchPlan {
  const rgbById = new Map(colors.map((c) => [c.id, packRgb(c)]));
  const blocks: PlanBlock[] = [];
  let current: PlanBlock | null = null;
  let currentColor: string | null = null;

  design.forEach((s, idx) => {
    const startsBlock = s.colorId !== currentColor;
    if (startsBlock) {
      current = { rgb: rgbById.get(s.colorId) ?? 0, cmds: [] };
      blocks.push(current);
      currentColor = s.colorId;
    }
    // A within-colour trim (the colour-change trim is implied by the block
    // boundary, so skip it on the first event of a block).
    if (s.trim && !startsBlock) current!.cmds.push(["t"]);
    const x = mmToTenths(s.x);
    const y = mmToTenths(s.y);
    current!.cmds.push(s.jump ? ["j", x, y] : ["s", x, y]);
    void idx;
  });

  return { blocks };
}

/** Build a plan directly from a project (runs the stitch engine). */
export function planFromProject(project: Project): StitchPlan {
  return planFromDesign(generateDesign(project), project.colors);
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
export async function exportToBytes(
  plan: StitchPlan,
  { format, pesVersion = 1, onStage }: ExportOptions,
): Promise<Uint8Array> {
  const pyodide = await getPyodide(onStage);
  await ensurePython(pyodide);

  pyodide.globals.set("__plan_json", JSON.stringify(plan));
  pyodide.globals.set("__fmt", format);
  pyodide.globals.set("__pes_version", pesVersion);

  const result = (await pyodide.runPythonAsync(
    `export_bytes(__plan_json, __fmt, __pes_version)`,
  )) as { toJs: () => Uint8Array; destroy: () => void };

  const bytes = result.toJs();
  result.destroy();
  return bytes;
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
