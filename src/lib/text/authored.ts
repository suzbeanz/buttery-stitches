/**
 * Per-glyph AUTHORED satin-column decompositions for the flagship font (Oswald).
 *
 * Auto-skeletonization is excellent for curves, loops and straight stems, but at
 * the diagonal 3- and 4-way junctions of letters like W, M, A, K it can't always
 * decide how to split the strokes — the throws fan or cross. For those glyphs we
 * hand-author the decomposition: a list of stroke CENTERLINES per character, in
 * normalized glyph-ink-bbox coordinates (x: 0 = left … 1 = right, y: 0 = top …
 * 1 = bottom). At layout time each centerline is mapped into the glyph's actual
 * ink box; the engine then lays one clean satin column down each, raycasting the
 * rails onto the real outline. Because the strokes are authored as clean, mostly
 * straight runs that simply meet at the junctions, there is no fan — and the
 * engine's residual fill closes any tiny gap where two strokes meet.
 *
 * Only the junction-heavy glyphs are authored; everything else (O, S, l, e, …)
 * keeps the auto path, which already sews flawlessly. Pure data — no DOM, no font.
 */

/** A normalized stroke centerline: points as [x, y] in 0..1 glyph-bbox space. */
export type NormStroke = [number, number][];
/** char → its authored stroke centerlines. */
export type AuthoredAlphabet = Record<string, NormStroke[]>;

/**
 * Oswald — the flagship. Condensed, even, medium-weight strokes, so each stroke
 * is a clean column. Coordinates are eyeballed to Oswald's letterforms and then
 * snapped to the true outline by the engine's rail raycast, so they need only run
 * roughly down the middle of each stroke at the right angle.
 */
const OSWALD: AuthoredAlphabet = {
  // — Uppercase diagonals —
  A: [
    [[0.47, 0.06], [0.17, 0.97]], // left diagonal (inboard of the leg)
    [[0.53, 0.06], [0.83, 0.97]], // right diagonal
    [[0.28, 0.64], [0.72, 0.64]], // crossbar
  ],
  K: [
    [[0.13, 0.04], [0.13, 0.96]], // stem
    [[0.22, 0.46], [0.95, 0.05]], // upper arm — starts at the stem's right edge
    [[0.24, 0.5], [0.98, 0.96]], // lower leg
  ],
  M: [
    [[0.12, 1.0], [0.12, 0.08]], // left stem
    [[0.15, 0.12], [0.48, 0.6]], // left diagonal to the centre valley
    [[0.52, 0.6], [0.85, 0.12]], // right diagonal
    [[0.88, 0.08], [0.88, 1.0]], // right stem
  ],
  N: [
    [[0.07, 1.0], [0.07, 0.0]], // left stem
    [[0.07, 0.0], [0.93, 1.0]], // diagonal
    [[0.93, 0.0], [0.93, 1.0]], // right stem
  ],
  V: [
    [[0.04, 0.0], [0.5, 1.0]],
    [[0.96, 0.0], [0.5, 1.0]],
  ],
  W: [
    [[0.04, 0.05], [0.25, 0.9]], // each arm stops short of the shared valley/peak;
    [[0.3, 0.9], [0.49, 0.4]], //  the residual fill closes the small meeting wedges
    [[0.51, 0.4], [0.7, 0.9]],
    [[0.75, 0.9], [0.96, 0.05]],
  ],
  X: [
    [[0.06, 0.0], [0.94, 1.0]],
    [[0.94, 0.0], [0.06, 1.0]],
  ],
  Y: [
    [[0.05, 0.0], [0.5, 0.5]],
    [[0.95, 0.0], [0.5, 0.5]],
    [[0.5, 0.5], [0.5, 1.0]],
  ],
  Z: [
    [[0.06, 0.07], [0.94, 0.07]], // top bar
    [[0.94, 0.07], [0.06, 0.93]], // diagonal
    [[0.06, 0.93], [0.94, 0.93]], // bottom bar
  ],
  // — Lowercase diagonals (mapped into each glyph's own ink box) —
  v: [
    [[0.06, 0.0], [0.5, 1.0]],
    [[0.94, 0.0], [0.5, 1.0]],
  ],
  w: [
    [[0.04, 0.0], [0.28, 1.0]],
    [[0.28, 1.0], [0.5, 0.32]],
    [[0.5, 0.32], [0.72, 1.0]],
    [[0.72, 1.0], [0.96, 0.0]],
  ],
  x: [
    [[0.08, 0.0], [0.92, 1.0]],
    [[0.92, 0.0], [0.08, 1.0]],
  ],
  y: [
    [[0.08, 0.0], [0.52, 0.52]], // short left arm
    [[0.92, 0.0], [0.2, 1.0]], // long right arm + descender tail
  ],
  k: [
    [[0.14, 0.04], [0.14, 0.96]], // stem (full ascender)
    [[0.22, 0.62], [0.92, 0.4]], // arm — starts at the stem's right edge
    [[0.24, 0.66], [0.95, 0.96]], // leg
  ],
  z: [
    [[0.07, 0.08], [0.93, 0.08]],
    [[0.93, 0.08], [0.07, 0.92]],
    [[0.07, 0.92], [0.93, 0.92]],
  ],
  // — Stem + bowl / shoulder junctions (the strokes meet at an angle, where the
  //   auto skeleton tends to fan; curves themselves auto-sew fine, so each bowl is
  //   authored as one spine that meets the stem and stops). —
  B: [
    [[0.16, 0.03], [0.16, 0.97]], // stem
    [[0.18, 0.05], [0.62, 0.07], [0.82, 0.27], [0.6, 0.47], [0.18, 0.49]], // upper bowl
    [[0.18, 0.51], [0.66, 0.53], [0.9, 0.74], [0.64, 0.95], [0.18, 0.95]], // lower bowl
  ],
  n: [
    [[0.2, 0.04], [0.2, 1.0]], // left stem
    [[0.22, 0.34], [0.5, 0.05], [0.78, 0.34]], // shoulder
    [[0.8, 0.32], [0.8, 1.0]], // right stem
  ],
  u: [
    [[0.2, 0.0], [0.2, 0.66]], // left stem
    [[0.22, 0.66], [0.5, 0.96], [0.78, 0.66]], // bottom bowl
    [[0.8, 0.0], [0.8, 1.0]], // right stem
  ],
  r: [
    [[0.26, 0.04], [0.26, 1.0]], // stem
    [[0.28, 0.34], [0.56, 0.06], [0.86, 0.14]], // shoulder
  ],
  h: [
    [[0.2, 0.02], [0.2, 1.0]], // full-height left stem
    [[0.22, 0.52], [0.5, 0.33], [0.78, 0.52]], // shoulder (springs at x-height)
    [[0.8, 0.5], [0.8, 1.0]], // right stem
  ],
  m: [
    [[0.12, 0.04], [0.12, 1.0]], // left stem
    [[0.14, 0.34], [0.33, 0.06], [0.5, 0.34]], // first shoulder
    [[0.5, 0.3], [0.5, 1.0]], // middle stem
    [[0.52, 0.34], [0.7, 0.06], [0.88, 0.34]], // second shoulder
    [[0.88, 0.3], [0.88, 1.0]], // right stem
  ],
  b: [
    [[0.2, 0.02], [0.2, 1.0]], // full-height stem
    [[0.2, 0.52], [0.58, 0.5], [0.82, 0.74], [0.58, 0.97], [0.2, 0.96]], // bowl
  ],
  d: [
    [[0.8, 0.02], [0.8, 1.0]], // full-height stem
    [[0.8, 0.52], [0.42, 0.5], [0.18, 0.74], [0.42, 0.97], [0.8, 0.96]], // bowl
  ],
  D: [
    [[0.16, 0.04], [0.16, 0.96]], // stem
    [[0.16, 0.05], [0.55, 0.06], [0.85, 0.3], [0.85, 0.7], [0.55, 0.94], [0.16, 0.95]], // bowl
  ],
  P: [
    [[0.16, 0.04], [0.16, 0.96]], // stem
    [[0.16, 0.05], [0.58, 0.06], [0.82, 0.28], [0.58, 0.5], [0.16, 0.49]], // bowl
  ],
  R: [
    [[0.16, 0.04], [0.16, 0.96]], // stem
    [[0.16, 0.05], [0.58, 0.06], [0.8, 0.27], [0.58, 0.49], [0.16, 0.48]], // bowl
    [[0.4, 0.49], [0.9, 0.96]], // leg
  ],
  // — Digit with a diagonal junction —
  "4": [
    [[0.7, 0.04], [0.7, 0.96]], // right stem
    [[0.66, 0.07], [0.1, 0.66]], // diagonal from the stem top down to the bar's left
    [[0.08, 0.66], [0.95, 0.66]], // crossbar
  ],
};

/** fontId → authored alphabet (only fonts we've hand-tuned appear here). */
const ALPHABETS: Record<string, AuthoredAlphabet> = {
  oswald: OSWALD,
};

/** The authored alphabet for a font, or null if that font isn't authored. */
export function authoredAlphabet(fontId: string | undefined): AuthoredAlphabet | null {
  if (!fontId) return null;
  return ALPHABETS[fontId] ?? null;
}
