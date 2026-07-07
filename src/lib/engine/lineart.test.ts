import { describe, it, expect } from "vitest";
import { generateDesign, generateObjectRuns } from "./index";
import { medialColumns } from "./medial";
import { makeObjectFromPaths } from "../objects";
import { createEmptyProject } from "../project";
import type { Path, Project } from "../../types/project";

/** Phase A — line-art outline polish: bold (bean) strokes + branch chaining. */

const trims = (d: ReturnType<typeof generateDesign>) => d.filter((s) => s.trim).length;
const drawn = (d: ReturnType<typeof generateDesign>) =>
  d.filter((s) => !s.jump && !s.trim).length;

function lineArtObject(rings: Path[]) {
  const o = makeObjectFromPaths("fill", rings, "c1");
  o.params = { fillStyle: "satin", lineArt: true, underlay: false };
  return o;
}
function lineArtDesign(rings: Path[]): ReturnType<typeof generateDesign> {
  const p: Project = { ...createEmptyProject(), objects: [lineArtObject(rings)] };
  return generateDesign(p, { lockStitches: false });
}
/** Direction reversals along x — a single pass is monotonic (0), a bean / triple
 *  pass goes out → back → out (≥ 2). */
function xReversals(pts: { x: number }[]): number {
  let rev = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = Math.sign(Math.round(pts[i].x) - Math.round(pts[i - 1].x));
    const b = Math.sign(Math.round(pts[i - 1].x) - Math.round(pts[i - 2].x));
    if (a && b && a !== b) rev++;
  }
  return rev;
}

describe("line-art bold (bean) outlines", () => {
  // A thin (~0.5 mm) horizontal stroke 40 mm long — a typical cartoon outline. It
  // runs down its centerline, but RETRACED forward/back/forward so it sews solid
  // and dark instead of a single weak hairline.
  const hairline: Path = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 0.5 }, { x: 0, y: 0.5 }];

  it("retraces a thin outline stroke (bean / triple), not a single weak pass", () => {
    const top = generateObjectRuns(lineArtObject([hairline])).find((r) => !r.underlay)!;
    expect(xReversals(top.pts)).toBeGreaterThanOrEqual(2); // out → back → out
  });
});

describe("line-art strokes sew as satin ACROSS the stroke", () => {
  // A tire: an annulus with a 3 mm wall. A hand digitizer sews it as RADIAL satin
  // (throws across the wall, marching around the ring) — solid, with the spoke
  // texture of a real tire. Passes running ALONG the ring (concentric rings /
  // contour) read as a coiled rope with gaps. So: most drawn segments of real
  // throw length must point radially, not tangentially.
  function annulus(cx: number, cy: number, rOut: number, rIn: number): Path[] {
    const ring = (r: number, ccw: boolean): Path => {
      const pts: Path = [];
      for (let i = 0; i < 72; i++) {
        const a = ((ccw ? i : 72 - i) / 72) * 2 * Math.PI;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      return pts;
    };
    return [ring(rOut, true), ring(rIn, false)];
  }

  it("sews a ring (tire wall) with radial throws, not concentric passes", () => {
    const runs = generateObjectRuns(lineArtObject(annulus(15, 15, 10, 7)));
    let radial = 0;
    let total = 0;
    for (const run of runs.filter((r) => !r.underlay)) {
      for (let i = 1; i < run.pts.length; i++) {
        const a = run.pts[i - 1];
        const b = run.pts[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1.5) continue; // connectors/advance steps, not throws
        const mx = (a.x + b.x) / 2 - 15;
        const my = (a.y + b.y) / 2 - 15;
        const rl = Math.hypot(mx, my) || 1;
        const cos = Math.abs(((b.x - a.x) * mx + (b.y - a.y) * my) / (len * rl));
        total++;
        if (cos > 0.7) radial++; // within ~45° of the radial direction
      }
    }
    expect(total).toBeGreaterThan(50); // the wall is really satined
    expect(radial / total).toBeGreaterThan(0.7);
  });
});

describe("annulus weld: a chopped ring sews as one complete circle", () => {
  // A tire whose ring CONNECTS to two horizontal bars (running boards) — the
  // skeleton chains the ring into the bars, so no single branch is a circle and
  // the ring used to sew as trimmed arcs with bare wedges at the junctions. The
  // circular HOLE plus a constant wall is unambiguous: one closed circular
  // column must cover the full 360°.
  function tireWithBars(): Path[] {
    const cx = 30, cy = 30, rOut = 10, rIn = 6.5;
    // ONE merged outer outline (the way a trace really delivers it): the circle
    // united with a 2.4 mm bar out each side, walked as a single polygon.
    const aBar = Math.asin(1.2 / rOut); // half-angle the bar consumes on the circle
    const arc = (from: number, to: number, out: Path) => {
      const steps = Math.max(8, Math.ceil((Math.abs(to - from) * rOut) / 0.5));
      for (let s = 0; s <= steps; s++) {
        const a = from + ((to - from) * s) / steps;
        out.push({ x: cx + rOut * Math.cos(a), y: cy + rOut * Math.sin(a) });
      }
    };
    const outer: Path = [];
    arc(aBar, Math.PI - aBar, outer); // top of the circle, left-to-right in angle
    outer.push({ x: cx - 22, y: cy + 1.2 }); // left bar (top edge, then around its cap)
    outer.push({ x: cx - 22, y: cy - 1.2 });
    arc(Math.PI + aBar, 2 * Math.PI - aBar, outer); // bottom of the circle
    outer.push({ x: cx + 22, y: cy - 1.2 }); // right bar
    outer.push({ x: cx + 22, y: cy + 1.2 });
    const hub: Path = [];
    for (let i = 90; i > 0; i--) {
      const a = (i / 90) * 2 * Math.PI;
      hub.push({ x: cx + rIn * Math.cos(a), y: cy + rIn * Math.sin(a) });
    }
    return [outer, hub];
  }

  it("covers the full ring with radial satin (no trimmed-junction wedge)", () => {
    const runs = generateObjectRuns(lineArtObject(tireWithBars()));
    const cx = 30, cy = 30, rIn = 6.5, rOut = 10;
    // Angular coverage of drawn penetrations inside the annulus band. Bins are
    // 5° so discrete penetration pitch can't fake a gap; a real trimmed-junction
    // wedge (the old failure) is ~15–30° of bare ring and still gets caught.
    const N = 72;
    const bins = new Uint8Array(N);
    for (const run of runs.filter((r) => !r.underlay)) {
      for (const p of run.pts) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < rIn - 0.5 || d > rOut + 0.5) continue;
        let a = Math.atan2(p.y - cy, p.x - cx) / (2 * Math.PI);
        if (a < 0) a += 1;
        bins[Math.floor(a * N) % N] = 1;
      }
    }
    let covered = 0;
    for (let i = 0; i < N; i++) covered += bins[i];
    expect(covered).toBe(N); // complete ring, no bare wedge

    // PRECISION: the ring is one exact circle, so (almost) every penetration in
    // the band lands ON one of its two rails. A chained wobbly skeleton (the old
    // behavior) scatters penetrations across the wall at the junctions.
    let onRail = 0;
    let inBand = 0;
    for (const run of runs.filter((r) => !r.underlay)) {
      for (const p of run.pts) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < rIn - 0.5 || d > rOut + 0.5) continue;
        inBand++;
        if (Math.abs(d - rIn) < 0.55 || Math.abs(d - rOut) < 0.55) onRail++;
      }
    }
    expect(inBand).toBeGreaterThan(200);
    expect(onRail / inBand).toBeGreaterThan(0.93);
  });

  it("TRIMS between separated small shapes — no phantom connector across bare fabric", () => {
    // Two small letter-like blocks 4mm apart (a word gap in 3mm lettering). The
    // coverage grid's 1mm lattice can land sample points inside both while the
    // bare gap falls between them — the router must NOT thread that phantom
    // corridor and slash a visible connector across it; the move trims.
    const blockA: Path = [{ x: 10, y: 10 }, { x: 13, y: 10 }, { x: 13, y: 14 }, { x: 10, y: 14 }];
    const blockB: Path = [{ x: 10, y: 18 }, { x: 13, y: 18 }, { x: 13, y: 22 }, { x: 10, y: 22 }];
    const d = lineArtDesign([blockA, blockB]);
    // Nothing sewn in the bare band between the blocks (y 14.6–17.4).
    for (const s of d) {
      if (s.jump || s.trim) continue;
      expect(s.y < 14.6 || s.y > 17.4).toBe(true);
    }
    expect(d.filter((s) => s.trim).length).toBeGreaterThanOrEqual(1);
  });

  it("sews a CONNECTED network with no trims — connectors ride the ink", () => {
    // The ring and its two bars are one connected ink network: the thread must
    // walk between the strokes through the coverage (as the professional
    // references do — hotdog sews 8.5k stitches with zero trims) instead of
    // cutting at every stroke boundary.
    const d = lineArtDesign(tireWithBars());
    expect(d.filter((s) => s.trim).length).toBe(0);
    expect(drawn(d)).toBeGreaterThan(300);
  });
});

describe("line-art width regularization (constant-width pen stroke)", () => {
  // A 40 mm bar whose TOP edge undulates (±0.8 mm, like a shakily traced ladder
  // rail) while the bottom edge is straight: the raw column's width beads and
  // pinches. Regularized, the rails must come out near-parallel — the constant
  // width band a hand digitizer would draw through the noise.
  function wavyBar(): Path[] {
    const top: Path = [];
    const bot: Path = [];
    for (let i = 0; i <= 80; i++) {
      const x = i * 0.5;
      top.push({ x, y: 2.4 + 0.8 * Math.sin((x / 8) * 2 * Math.PI) });
      bot.push({ x: 40 - i * 0.5, y: 0 });
    }
    return [[...top, ...bot]];
  }

  const railWidths = (regularize: boolean): number[] => {
    const cols = medialColumns(wavyBar(), { density: 0.4, regularize });
    expect(cols.length).toBeGreaterThan(0);
    const col = cols.reduce((a, b) => (b.left.length > a.left.length ? b : a));
    const w: number[] = [];
    const n = Math.min(col.left.length, col.right.length);
    // Skip the ends (terminal extension / caps); judge the body of the stroke.
    for (let i = Math.floor(n * 0.15); i < Math.ceil(n * 0.85); i++) {
      w.push(Math.hypot(col.left[i].x - col.right[i].x, col.left[i].y - col.right[i].y));
    }
    return w.sort((a, b) => a - b);
  };

  it("holds a wavy-edged stroke to near-constant width (raw column proves the noise)", () => {
    const raw = railWidths(false);
    const reg = railWidths(true);
    const spread = (w: number[]) => w[Math.floor(w.length * 0.95)] / w[Math.floor(w.length * 0.05)];
    // The un-regularized column really carries the bead-and-pinch noise…
    expect(spread(raw)).toBeGreaterThan(1.45);
    // …and regularization flattens it into a near-constant band.
    expect(spread(reg)).toBeLessThan(1.25);
  });
});

describe("line-art branch chaining (fewer trims)", () => {
  // A plus/cross: four ~2 mm limbs meeting at one junction — a connected outline
  // network. Its medial axis breaks into separate branches; chaining links the ones
  // that meet at the junction so the whole mark sews with almost no trims instead of
  // one cut per branch.
  const plus: Path = [
    { x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 14 }, { x: 30, y: 14 },
    { x: 30, y: 16 }, { x: 16, y: 16 }, { x: 16, y: 30 }, { x: 14, y: 30 },
    { x: 14, y: 16 }, { x: 0, y: 16 }, { x: 0, y: 14 }, { x: 14, y: 14 },
  ];

  it("chains the limbs of a connected mark so it barely trims", () => {
    const d = lineArtDesign([plus]);
    expect(trims(d)).toBeLessThanOrEqual(1);
    expect(drawn(d)).toBeGreaterThan(0);
  });
});
