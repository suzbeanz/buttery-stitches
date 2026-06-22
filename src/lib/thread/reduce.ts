import type { Project, ThreadColor } from "../../types/project";
import { rgbToLab, type RGB } from "./match";

/** A merge cluster: member color ids + an area-weighted Lab/RGB mean. */
interface Cluster {
  ids: string[];
  rgb: RGB;
  lab: [number, number, number];
  w: number;
  rep: ThreadColor; // representative (heaviest member) for name/brand/code
}

const cd2 = (a: Cluster, b: Cluster) =>
  (a.lab[0] - b.lab[0]) ** 2 + (a.lab[1] - b.lab[1]) ** 2 + (a.lab[2] - b.lab[2]) ** 2;

/** One cluster per color, each weighted by how many objects use it (so a dominant
 *  color anchors a cluster rather than getting averaged away by stray specks). */
function clustersFor(project: Project): Cluster[] {
  const weight = new Map<string, number>();
  for (const c of project.colors) weight.set(c.id, 0);
  for (const o of project.objects) weight.set(o.colorId, (weight.get(o.colorId) ?? 0) + 1);
  return project.colors.map((c) => ({
    ids: [c.id],
    rgb: [...c.rgb] as RGB,
    lab: rgbToLab(c.rgb),
    w: Math.max(1, weight.get(c.id) ?? 1),
    rep: c,
  }));
}

/** Surviving colors (reuse each cluster's representative id) + object remap. */
function rebuild(project: Project, clusters: Cluster[]): Project {
  const newColors: ThreadColor[] = [];
  const remap = new Map<string, string>();
  for (const cl of clusters) {
    newColors.push({ ...cl.rep, rgb: cl.rgb });
    for (const id of cl.ids) remap.set(id, cl.rep.id);
  }
  return {
    ...project,
    colors: newColors,
    objects: project.objects.map((o) => ({ ...o, colorId: remap.get(o.colorId) ?? o.colorId })),
  };
}

/**
 * Greedy agglomerative merge in CIELAB: repeatedly merge the two perceptually
 * closest colors (area-weighted) while `proceed(remainingCount, closestΔE²)` says
 * to. Then remap every object to its surviving color. Pure.
 */
function agglomerate(project: Project, proceed: (count: number, bestD2: number) => boolean): Project {
  let clusters = clustersFor(project);
  while (clusters.length > 1) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = cd2(clusters[i], clusters[j]);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (!proceed(clusters.length, bd)) break;
    const a = clusters[bi];
    const b = clusters[bj];
    const w = a.w + b.w;
    const mix = (k: 0 | 1 | 2) => Math.round((a.rgb[k] * a.w + b.rgb[k] * b.w) / w);
    const rgb: RGB = [mix(0), mix(1), mix(2)];
    clusters = clusters.filter((_, i) => i !== bi && i !== bj);
    clusters.push({ ids: [...a.ids, ...b.ids], rgb, lab: rgbToLab(rgb), w, rep: a.w >= b.w ? a.rep : b.rep });
  }
  return rebuild(project, clusters);
}

/**
 * Reduce a design to at most `maxColors` threads — the pro "color reduction" step
 * for cleaning up a traced or over-segmented design.
 */
export function reduceProjectColors(project: Project, maxColors: number): Project {
  if (maxColors < 1 || project.colors.length <= maxColors) return project;
  return agglomerate(project, (count) => count > maxColors);
}

/**
 * Merge only colors that are perceptually closer than `maxDeltaE` (CIE76 ΔE) —
 * collapses near-duplicate shades (anti-alias bands, JPEG noise) without forcing a
 * target count. No-op when nothing is that close.
 */
export function mergeSimilarColors(project: Project, maxDeltaE: number): Project {
  if (maxDeltaE <= 0 || project.colors.length <= 1) return project;
  const thr = maxDeltaE * maxDeltaE;
  return agglomerate(project, (_count, bestD2) => bestD2 <= thr);
}
