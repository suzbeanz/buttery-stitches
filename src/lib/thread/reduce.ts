import type { Project, ThreadColor } from "../../types/project";
import { rgbToLab, type RGB } from "./match";

/**
 * Reduce a design to at most `maxColors` threads — the pro "color reduction" step
 * for cleaning up a traced or over-segmented design. Greedy agglomerative merge
 * in CIELAB (merge the two perceptually closest colors, area-weighted, until the
 * count fits), then remap every object to its surviving color. Pure.
 */
export function reduceProjectColors(project: Project, maxColors: number): Project {
  const colors = project.colors;
  if (maxColors < 1 || colors.length <= maxColors) return project;

  // Weight each color by how many objects use it (so a dominant color anchors a
  // cluster rather than getting averaged away by stray specks).
  const weight = new Map<string, number>();
  for (const c of colors) weight.set(c.id, 0);
  for (const o of project.objects) weight.set(o.colorId, (weight.get(o.colorId) ?? 0) + 1);

  // Clusters start as one-per-color; each tracks member ids + a weighted Lab mean.
  interface Cluster {
    ids: string[];
    rgb: RGB;
    lab: [number, number, number];
    w: number;
    rep: ThreadColor; // representative (heaviest member) for name/brand/code
  }
  let clusters: Cluster[] = colors.map((c) => ({
    ids: [c.id],
    rgb: [...c.rgb] as RGB,
    lab: rgbToLab(c.rgb),
    w: Math.max(1, weight.get(c.id) ?? 1),
    rep: c,
  }));

  const d2 = (a: Cluster, b: Cluster) =>
    (a.lab[0] - b.lab[0]) ** 2 + (a.lab[1] - b.lab[1]) ** 2 + (a.lab[2] - b.lab[2]) ** 2;

  while (clusters.length > maxColors) {
    // Find the closest pair.
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = d2(clusters[i], clusters[j]);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    const a = clusters[bi];
    const b = clusters[bj];
    const w = a.w + b.w;
    // Area-weighted blended color; keep the heavier side's name/code.
    const mix = (k: 0 | 1 | 2) => Math.round((a.rgb[k] * a.w + b.rgb[k] * b.w) / w) as number;
    const rgb: RGB = [mix(0), mix(1), mix(2)];
    const merged: Cluster = {
      ids: [...a.ids, ...b.ids],
      rgb,
      lab: rgbToLab(rgb),
      w,
      rep: a.w >= b.w ? a.rep : b.rep,
    };
    clusters = clusters.filter((_, i) => i !== bi && i !== bj);
    clusters.push(merged);
  }

  // Build surviving colors (reuse the representative's id) + an id remap.
  const newColors: ThreadColor[] = [];
  const remap = new Map<string, string>();
  for (const cl of clusters) {
    const survivorId = cl.rep.id;
    newColors.push({ ...cl.rep, id: survivorId, rgb: cl.rgb });
    for (const id of cl.ids) remap.set(id, survivorId);
  }

  return {
    ...project,
    colors: newColors,
    objects: project.objects.map((o) => ({ ...o, colorId: remap.get(o.colorId) ?? o.colorId })),
  };
}
