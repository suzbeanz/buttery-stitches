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
 * Greedy agglomerative merge in CIELAB: repeatedly merge the perceptually CLOSEST
 * pair that `mergeable(...)` accepts, until none qualify. Picking the closest
 * *qualifying* pair (rather than testing only the globally closest) lets the rule
 * depend on the pair's areas — a near mid-pair can be skipped while a farther
 * big+fringe pair still merges. For distance-only rules this is identical to
 * "merge the closest while under threshold". Then remap objects. Pure.
 */
function mergeLoop(
  project: Project,
  clusters0: Cluster[],
  mergeable: (bestD2: number, aW: number, bW: number, totalW: number, count: number) => boolean,
): Project {
  let clusters = clusters0;
  const totalW = clusters.reduce((s, c) => s + c.w, 0); // invariant: merges preserve total
  while (clusters.length > 1) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = cd2(clusters[i], clusters[j]);
        if (d < bd && mergeable(d, clusters[i].w, clusters[j].w, totalW, clusters.length)) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break; // no qualifying pair left
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

/** Summed |outer-ring area| per color — a cheap area proxy for weighting. A
 *  line-art network's outer ring is its whole silhouette (large), so it anchors;
 *  a thin shadow/anti-alias sliver is small, so it reads as fringe. */
function colorAreas(project: Project): Map<string, number> {
  const areas = new Map<string, number>();
  for (const o of project.objects) {
    const ring = o.paths[0];
    let s = 0;
    if (ring && ring.length >= 3) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % n];
        s += p.x * q.y - q.x * p.y;
      }
    }
    areas.set(o.colorId, (areas.get(o.colorId) ?? 0) + Math.abs(s) / 2);
  }
  return areas;
}

/**
 * Reduce a design to at most `maxColors` threads — the pro "color reduction" step
 * for cleaning up a traced or over-segmented design.
 */
export function reduceProjectColors(project: Project, maxColors: number): Project {
  if (maxColors < 1 || project.colors.length <= maxColors) return project;
  return mergeLoop(project, clustersFor(project), (_d2, _aW, _bW, _tw, count) => count > maxColors);
}

/** True duplicates merge at any size; fringe merges only when SMALL. */
const NEAR_DELTA_E = 10;
const FRINGE_DELTA_E = 30;
const FRINGE_AREA_FRAC = 0.06;

/**
 * Consolidate near-duplicate palette entries from tracing — anti-alias bands and
 * thin shadow slivers that k-means spent a slot on (a flat red split into two
 * reds, a grey into two greys). Area-aware: a pair merges when it's a true
 * duplicate (ΔE < NEAR_DELTA_E, any size) OR the smaller side is a tiny fraction
 * of the design AND only moderately distinct (ΔE < FRINGE_DELTA_E). Two LARGE
 * distinct colors are left intact. Pure; object colorIds are remapped.
 */
export function consolidateFringeColors(project: Project): Project {
  if (project.colors.length <= 1) return project;
  const areas = colorAreas(project);
  const clusters = clustersFor(project).map((c) => ({ ...c, w: Math.max(1e-6, areas.get(c.rep.id) ?? 0) }));
  const near2 = NEAR_DELTA_E * NEAR_DELTA_E;
  const fringe2 = FRINGE_DELTA_E * FRINGE_DELTA_E;
  return mergeLoop(project, clusters, (d2, aW, bW, totalW) => {
    if (d2 <= near2) return true;
    const minShare = Math.min(aW, bW) / (totalW || 1);
    return d2 <= fringe2 && minShare < FRINGE_AREA_FRAC;
  });
}

/**
 * Merge only colors that are perceptually closer than `maxDeltaE` (CIE76 ΔE) —
 * collapses near-duplicate shades (anti-alias bands, JPEG noise) without forcing a
 * target count. No-op when nothing is that close.
 */
export function mergeSimilarColors(project: Project, maxDeltaE: number): Project {
  if (maxDeltaE <= 0 || project.colors.length <= 1) return project;
  const thr = maxDeltaE * maxDeltaE;
  return mergeLoop(project, clustersFor(project), (bestD2) => bestD2 <= thr);
}
