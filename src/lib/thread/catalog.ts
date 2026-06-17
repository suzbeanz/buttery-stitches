/**
 * Thread catalogs for color management. A chart is a named list of real thread
 * colors; the matcher snaps a design's colors to the nearest thread so the user
 * gets a name + code to order by.
 *
 * HONESTY: manufacturers' exact catalog numbers (Madeira, Isacord, …) are
 * licensed data we don't ship. This is a curated, well-spread GENERIC chart with
 * our own codes — the matching engine is brand-agnostic, so an official chart can
 * be dropped in as another `ThreadChart` (same shape) when you have the data.
 */

export interface Thread {
  /** catalog/brand, e.g. "Buttery Standard". */
  brand: string;
  /** catalog number to order by. */
  code: string;
  name: string;
  rgb: [number, number, number];
}

export interface ThreadChart {
  id: string;
  name: string;
  threads: Thread[];
}

const BS = (code: string, name: string, rgb: [number, number, number]): Thread => ({
  brand: "Buttery Standard",
  code,
  name,
  rgb,
});

/** A 48-color, well-distributed everyday embroidery palette. */
export const BUTTERY_STANDARD: ThreadChart = {
  id: "buttery-standard",
  name: "Buttery Standard 48",
  threads: [
    // neutrals
    BS("BS-010", "Black", [20, 20, 22]),
    BS("BS-011", "Charcoal", [55, 58, 62]),
    BS("BS-012", "Slate Gray", [104, 110, 118]),
    BS("BS-013", "Silver", [176, 180, 185]),
    BS("BS-014", "Pewter", [142, 138, 130]),
    BS("BS-015", "Cream", [243, 236, 210]),
    BS("BS-016", "White", [248, 248, 244]),
    BS("BS-017", "Ecru", [226, 214, 184]),
    // reds / pinks
    BS("BS-100", "Scarlet", [196, 38, 38]),
    BS("BS-101", "True Red", [214, 30, 48]),
    BS("BS-102", "Crimson", [160, 24, 46]),
    BS("BS-103", "Burgundy", [108, 26, 40]),
    BS("BS-104", "Rose", [214, 92, 110]),
    BS("BS-105", "Pink", [236, 150, 178]),
    BS("BS-106", "Blush", [244, 198, 200]),
    BS("BS-107", "Coral", [240, 110, 90]),
    // oranges / browns
    BS("BS-200", "Orange", [240, 130, 32]),
    BS("BS-201", "Pumpkin", [222, 104, 36]),
    BS("BS-202", "Rust", [168, 78, 40]),
    BS("BS-203", "Tan", [196, 158, 112]),
    BS("BS-204", "Caramel", [176, 122, 66]),
    BS("BS-205", "Chocolate", [96, 62, 42]),
    BS("BS-206", "Coffee", [70, 50, 38]),
    // yellows / golds
    BS("BS-300", "Lemon", [246, 224, 80]),
    BS("BS-301", "Yellow", [248, 206, 44]),
    BS("BS-302", "Gold", [216, 168, 48]),
    BS("BS-303", "Mustard", [196, 154, 44]),
    BS("BS-304", "Butter", [244, 224, 150]),
    // greens
    BS("BS-400", "Lime", [150, 200, 64]),
    BS("BS-401", "Leaf Green", [86, 160, 66]),
    BS("BS-402", "Kelly Green", [40, 138, 70]),
    BS("BS-403", "Forest", [30, 92, 56]),
    BS("BS-404", "Pine", [22, 64, 48]),
    BS("BS-405", "Sage", [150, 168, 130]),
    BS("BS-406", "Teal", [28, 138, 138]),
    // blues
    BS("BS-500", "Aqua", [86, 196, 210]),
    BS("BS-501", "Sky Blue", [96, 170, 224]),
    BS("BS-502", "Royal Blue", [36, 84, 176]),
    BS("BS-503", "Press Blue", [23, 58, 122]),
    BS("BS-504", "Navy", [22, 38, 78]),
    BS("BS-505", "Denim", [76, 104, 150]),
    // purples
    BS("BS-600", "Lavender", [186, 168, 214]),
    BS("BS-601", "Violet", [128, 84, 178]),
    BS("BS-602", "Purple", [96, 52, 140]),
    BS("BS-603", "Plum", [104, 52, 92]),
    BS("BS-604", "Magenta", [196, 56, 144]),
    BS("BS-605", "Mauve", [168, 124, 150]),
  ],
};

/** All available charts (extend with official brand charts as data lands). */
export const THREAD_CHARTS: ThreadChart[] = [BUTTERY_STANDARD];

export function chartById(id: string): ThreadChart | undefined {
  return THREAD_CHARTS.find((c) => c.id === id);
}
