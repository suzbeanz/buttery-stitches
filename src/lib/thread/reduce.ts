import type { Project, ThreadColor } from "../../types/project";
import { rgbToLab, type RGB } from "./match";

/** A merge cluster: member color ids + an area-weighted Lab/RGB mean. */
interface Cluster {
  ids: string[];
  rgb: RGB;
  lab: [number, number, number];
  w: number;
  rep: ThreadColor; // representative (heaviest member) for name/brand/code
  /** Outer-ring geometry (set on the fringe-consolidation path only): summed
   *  area (mm²) and perimeter (mm). Mean width 2·area/perim separates a compact
   *  deliberate detail (an eye — blobby, wide) from true fringe (anti-alias and
   *  shadow slivers — thin however large their count). */
  areaMm2?: number;
  perimMm?: number;
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
  mergeable: (bestD2: number, a: Cluster, b: Cluster, totalW: number, count: number) => boolean,
): Project {
  let clusters = clusters0;
  const totalW = clusters.reduce((s, c) => s + c.w, 0); // invariant: merges preserve total
  while (clusters.length > 1) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = cd2(clusters[i], clusters[j]);
        if (d < bd && mergeable(d, clusters[i], clusters[j], totalW, clusters.length)) {
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
    clusters.push({
      ids: [...a.ids, ...b.ids],
      rgb,
      lab: rgbToLab(rgb),
      w,
      rep: a.w >= b.w ? a.rep : b.rep,
      areaMm2: (a.areaMm2 ?? 0) + (b.areaMm2 ?? 0),
      perimMm: (a.perimMm ?? 0) + (b.perimMm ?? 0),
    });
  }
  return rebuild(project, clusters);
}

/** Summed |outer-ring area| and perimeter per color — cheap geometry proxies. A
 *  line-art network's outer ring is its whole silhouette (large area), so it
 *  anchors; a thin shadow/anti-alias sliver is small, so it reads as fringe.
 *  Perimeter feeds the mean width (2·area/perim) that tells a compact detail
 *  (an eye) from thin fringe of the same total area. */
function colorGeometry(project: Project): Map<string, { area: number; perim: number }> {
  const geo = new Map<string, { area: number; perim: number }>();
  for (const o of project.objects) {
    const ring = o.paths[0];
    let s = 0;
    let p2 = 0;
    if (ring && ring.length >= 3) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % n];
        s += p.x * q.y - q.x * p.y;
        p2 += Math.hypot(q.x - p.x, q.y - p.y);
      }
    }
    const g = geo.get(o.colorId) ?? { area: 0, perim: 0 };
    g.area += Math.abs(s) / 2;
    g.perim += p2;
    geo.set(o.colorId, g);
  }
  return geo;
}

/**
 * Reduce a design to at most `maxColors` threads — the pro "color reduction" step
 * for cleaning up a traced or over-segmented design.
 */
export function reduceProjectColors(project: Project, maxColors: number): Project {
  if (maxColors < 1 || project.colors.length <= maxColors) return project;
  return mergeLoop(project, clustersFor(project), (_d2, _a, _b, _tw, count) => count > maxColors);
}

/** True duplicates merge at any size; fringe merges only when SMALL. */
const NEAR_DELTA_E = 10;
const FRINGE_DELTA_E = 30;
const FRINGE_AREA_FRAC = 0.06;
/** A small-but-distinct color whose regions average at least this wide (mm) is
 *  a compact deliberate DETAIL — a pet's eye, a nose — not fringe, and the
 *  ΔE≤30 fringe rule must not eat it. True fringe (anti-alias/shadow slivers)
 *  measures ≈0.3–0.8mm mean width; a 2.4mm-radius eye disc measures ≈2.4mm
 *  (for a disc, 2A/P = r). Matches the spirit of fur's 1.6mm sparkle bar. */
const DETAIL_PROTECT_MEAN_WIDTH_MM = 1.5;

/**
 * Consolidate near-duplicate palette entries from tracing — anti-alias bands and
 * thin shadow slivers that k-means spent a slot on (a flat red split into two
 * reds, a grey into two greys). Area-aware: a pair merges when it's a true
 * duplicate (ΔE < NEAR_DELTA_E, any size) OR the smaller side is a tiny fraction
 * of the design AND only moderately distinct (ΔE < FRINGE_DELTA_E). Two LARGE
 * distinct colors are left intact. Pure; object colorIds are remapped.
 */
export function consolidateFringeColors(project: Project, minColors = 1): Project {
  if (project.colors.length <= 1) return project;
  const geo = colorGeometry(project);
  const clusters = clustersFor(project).map((c) => {
    const g = geo.get(c.rep.id);
    return { ...c, w: Math.max(1e-6, g?.area ?? 0), areaMm2: g?.area ?? 0, perimMm: g?.perim ?? 0 };
  });
  const near2 = NEAR_DELTA_E * NEAR_DELTA_E;
  const fringe2 = FRINGE_DELTA_E * FRINGE_DELTA_E;
  const meanWidthMm = (c: { areaMm2?: number; perimMm?: number }) =>
    c.perimMm && c.perimMm > 0 ? (2 * (c.areaMm2 ?? 0)) / c.perimMm : 0;
  return mergeLoop(project, clusters, (d2, a, b, totalW, count) => {
    if (d2 <= near2) return true;
    // Fringe trimming must never take the palette BELOW what the user asked
    // for. Unbounded, this rule collapsed a requested-7 trace to three colors
    // — eating a beacon dome, the whites, the greys — undoing both the colour
    // budget and every feature the perceptual quantizer deliberately kept.
    if (count <= minColors) return false;
    const small = a.w <= b.w ? a : b;
    const minShare = small.w / (totalW || 1);
    if (!(d2 <= fringe2 && minShare < FRINGE_AREA_FRAC)) return false;
    // COMPACT-DETAIL GUARD: a small color made of wide blobby regions is a
    // deliberate feature (a rescued eye at ΔE≈33 to the fur around it), not the
    // thin anti-alias fringe this rule exists to sweep up. Slot budgets above
    // don't protect it — the quantizer's rescue slots sit ABOVE the user's
    // count, so the minColors brake never engages for them.
    return meanWidthMm(small) < DETAIL_PROTECT_MEAN_WIDTH_MM;
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
