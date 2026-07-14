import type { EmbObject, Point, Project, ThreadColor } from "../types/project";
import { pathsBounds } from "./geometry";
import { designBounds, translateAllPaths } from "./layout";
import { newId } from "./id";

/**
 * Multi-hoop splitting: partition an oversized design into hoop-sized hoopings
 * the user stitches in sequence (the "multi-hooping" workflow of professional
 * digitizers). Everything here is pure and in millimeters.
 *
 * HONEST V1 SEMANTICS — we partition OBJECTS, we never cut stitch geometry.
 * Because objects are vectors that re-digitize at any position, splitting is
 * just assigning each whole object to the grid cell that contains its bounding
 * -box CENTER. An object that straddles a cell boundary therefore belongs
 * entirely to the tile of its center and may poke past that tile's usable
 * area (the per-hooping design-check will flag it). Cutting satin columns or
 * fills mid-shape would silently degrade stitch quality, so we don't.
 *
 * Alignment: every tile project carries thin cross running-stitch marks at the
 * corners it shares with neighboring tiles. The marks are placed at IDENTICAL
 * WORLD positions in each neighboring hooping (then translated into each
 * hooping's frame), so stitching hooping N+1's crosses on top of hooping N's
 * physically registers the re-hooping. They sew FIRST and use a dedicated
 * "remove after" thread color.
 */

export interface HoopTile {
  /** 0-based hooping order (row-major over the grid, empty tiles dropped). */
  index: number;
  col: number;
  row: number;
  /** World-space (design mm) center of this tile's grid cell. */
  centerMm: { x: number; y: number };
  /** Grid cell size in mm (≤ hoop × marginFrac); needed to locate shared corners. */
  cellMm: { w: number; h: number };
  /** Ids of the objects assigned to this hooping, in document (sew) order. */
  objectIds: string[];
}

/** Stable id/color for the alignment-mark thread (identical across tiles). */
export const ALIGN_COLOR_ID = "color_alignment_marks";
export const ALIGN_COLOR_NAME = "Alignment — remove after";

/** Total arm span of an alignment cross, mm (two crossing ~8 mm lines). */
export const ALIGN_MARK_SIZE_MM = 8;

function alignColor(): ThreadColor {
  return { id: ALIGN_COLOR_ID, rgb: [204, 32, 32], name: ALIGN_COLOR_NAME };
}

/**
 * Plan the minimal grid of hoopings (cols × rows) that covers the design at a
 * usable area of hoop × `marginFrac` per hooping. Each object is assigned to
 * the cell containing its bbox center; empty cells are dropped. A design that
 * already fits yields a single tile.
 */
export function planHoopSplit(
  objects: EmbObject[],
  hoop: { wMm: number; hMm: number },
  marginFrac = 0.9,
): HoopTile[] {
  const b = designBounds(objects);
  if (!b) return [];

  const frac = marginFrac > 0 ? marginFrac : 0.9;
  const usableW = Math.max(1e-6, hoop.wMm * frac);
  const usableH = Math.max(1e-6, hoop.hMm * frac);

  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  // Minimal grid whose cells (design span / count) fit in the usable area.
  // The -1e-6 slack keeps a design measuring exactly the usable size at 1 cell.
  const cols = Math.max(1, Math.ceil((w - 1e-6) / usableW));
  const rows = Math.max(1, Math.ceil((h - 1e-6) / usableH));
  const cw = w / cols;
  const ch = h / rows;

  // Row-major tiles — a natural left-to-right, top-to-bottom hooping sequence.
  const grid: HoopTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      grid.push({
        index: 0, // re-numbered after empties are dropped
        col,
        row,
        centerMm: { x: b.minX + (col + 0.5) * cw, y: b.minY + (row + 0.5) * ch },
        cellMm: { w: cw, h: ch },
        objectIds: [],
      });
    }
  }

  // Assign each object (by bbox center) to its cell — document order preserved.
  for (const o of objects) {
    const ob = pathsBounds(o.paths);
    if (!ob) continue; // no geometry, nothing to hoop
    const cx = (ob.minX + ob.maxX) / 2;
    const cy = (ob.minY + ob.maxY) / 2;
    const col = cw > 0 ? Math.min(cols - 1, Math.max(0, Math.floor((cx - b.minX) / cw))) : 0;
    const row = ch > 0 ? Math.min(rows - 1, Math.max(0, Math.floor((cy - b.minY) / ch))) : 0;
    grid[row * cols + col].objectIds.push(o.id);
  }

  const tiles = grid.filter((t) => t.objectIds.length > 0);
  tiles.forEach((t, i) => (t.index = i));
  return tiles;
}

/** The four world-space corner points of a tile's grid cell. */
function tileCorners(t: HoopTile): Point[] {
  const hw = t.cellMm.w / 2;
  const hh = t.cellMm.h / 2;
  return [
    { x: t.centerMm.x - hw, y: t.centerMm.y - hh },
    { x: t.centerMm.x + hw, y: t.centerMm.y - hh },
    { x: t.centerMm.x - hw, y: t.centerMm.y + hh },
    { x: t.centerMm.x + hw, y: t.centerMm.y + hh },
  ];
}

/** Corners of `tile` that coincide with a corner of another (non-empty) tile. */
function sharedCorners(tile: HoopTile, allTiles: HoopTile[]): Point[] {
  const eps = 1e-6;
  const out: Point[] = [];
  for (const c of tileCorners(tile)) {
    const shared = allTiles.some(
      (o) =>
        o.index !== tile.index &&
        tileCorners(o).some((k) => Math.abs(k.x - c.x) < eps && Math.abs(k.y - c.y) < eps),
    );
    if (shared) out.push(c);
  }
  return out;
}

/** Two thin ~8 mm crossing running lines centered on `at` (world mm). */
function crossMarkObjects(at: Point): EmbObject[] {
  const a = ALIGN_MARK_SIZE_MM / 2;
  const line = (p1: Point, p2: Point, name: string): EmbObject => ({
    id: newId("obj"),
    name,
    type: "running",
    colorId: ALIGN_COLOR_ID,
    paths: [[p1, p2]],
    params: { stitchLength: 2 },
    visible: true,
  });
  return [
    line({ x: at.x - a, y: at.y }, { x: at.x + a, y: at.y }, "Alignment mark —"),
    line({ x: at.x, y: at.y - a }, { x: at.x, y: at.y + a }, "Alignment mark |"),
  ];
}

/** "base — hooping N of M" — the per-hooping document/file name. (The Project
 *  model has no name field, so callers apply this to the download filename.) */
export function hoopingName(base: string, tile: HoopTile, allTiles: HoopTile[]): string {
  return `${base} — hooping ${tile.index + 1} of ${allTiles.length}`;
}

/**
 * Build a standalone Project for one hooping: the tile's objects translated so
 * the tile center sits at the hoop center, alignment crosses (shared corners
 * only) prepended so they sew first, same colors plus the alignment thread,
 * hoop unchanged. The input project is never mutated.
 */
export function buildTileProject(
  project: Project,
  tile: HoopTile,
  allTiles: HoopTile[],
): Project {
  const dx = project.hoop.wMm / 2 - tile.centerMm.x;
  const dy = project.hoop.hMm / 2 - tile.centerMm.y;

  const byId = new Map(project.objects.map((o) => [o.id, o]));
  // Clone params too so the tile document is fully independent of the source.
  const tileObjects = tile.objectIds
    .map((id) => byId.get(id))
    .filter((o): o is EmbObject => o !== undefined)
    .map((o) => ({ ...o, params: { ...o.params } }));

  const corners = allTiles.length > 1 ? sharedCorners(tile, allTiles) : [];
  const marks = corners.flatMap((c) => crossMarkObjects(c));

  // Marks are built in WORLD space, then everything rides the same translation
  // into the hoop frame — so neighboring hoopings' marks coincide physically.
  const objects = translateAllPaths([...marks, ...tileObjects], dx, dy);
  const colors = marks.length > 0 ? [...project.colors, alignColor()] : [...project.colors];

  return {
    ...project,
    widthMm: project.hoop.wMm,
    heightMm: project.hoop.hMm,
    hoop: { ...project.hoop },
    colors,
    objects,
  };
}
