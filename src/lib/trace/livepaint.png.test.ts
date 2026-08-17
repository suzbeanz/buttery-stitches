import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { detectLineArt, livePaintObjects } from "./livepaint";
import { polygonArea } from "./classify";

/**
 * OPT-IN gates against a real outlined-cartoon PNG (not committed — the corpus
 * stays synthetic/copyright-clean). Run locally while tuning:
 *
 *   LINEART_PNG=/path/to/cartoon.png npx vitest run src/lib/trace/livepaint.png.test.ts
 *
 * The expectations encode the measured truth of the reference artwork (a
 * classic outlined cartoon character): transparent background, one dark ink
 * network, flat blue/white/red faces incl. small-but-critical ones (eye
 * whites ~10mm², a red mouth ~10–16mm²).
 */

/** Minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced. */
function decodePng(path: string): ImageData {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0,
    height = 0,
    colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9];
      if (body[8] !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0)
        throw new Error(`unsupported PNG: depth=${body[8]} color=${colorType}`);
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev.set(cur);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp];
      out[o + 1] = cur[x * bpp + 1];
      out[o + 2] = cur[x * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
  }
  return { width, height, data: out } as ImageData;
}

describe.runIf(!!process.env.LINEART_PNG)("live paint on the real cartoon PNG", () => {
  const img = process.env.LINEART_PNG ? decodePng(process.env.LINEART_PNG) : null!;

  it("detects outlined line art and suggests its true color count", () => {
    const det = detectLineArt(img);
    expect(det.isLineArt).toBe(true);
    expect(det.suggestedColors).toBeGreaterThanOrEqual(4);
  });

  it("produces face fills for blue/white/red plus a last, unique-color ink network", () => {
    const fit = 0.92;
    const mmPerPx = Math.min(100 / img.width, 100 / img.height) * fit;
    const det = detectLineArt(img);
    const res = livePaintObjects(img, det.suggestedColors, {
      mmPerPx,
      offsetX: (100 - img.width * mmPerPx) / 2,
      offsetY: (100 - img.height * mmPerPx) / 2,
      removeBackground: true,
      detail: "balanced",
    });
    const has = (t: (rgb: [number, number, number]) => boolean) =>
      res.colors.some((c) => t(c.rgb));
    expect(has(([r, g, b]) => b > 180 && g > 130 && r < 120), "blue").toBe(true);
    expect(has(([r, g, b]) => r > 230 && g > 230 && b > 230), "white").toBe(true);
    expect(has(([r, g, b]) => r > 170 && g < 90 && b < 110), "red").toBe(true);
    const ink = res.objects[res.objects.length - 1];
    expect(ink.name).toBe("Ink lines");
    expect(ink.params.lineArt).toBe(true);
    // The ink thread may own TWO objects: solid blobs (pupils, the mouth
    // cavity) sewn as fills, then the stroke network last. Nothing else
    // shares the ink color, and its ThreadColor is minted last.
    const inkObjs = res.objects.filter((o) => o.colorId === ink.colorId);
    expect(inkObjs.length).toBeGreaterThanOrEqual(1);
    expect(inkObjs.length).toBeLessThanOrEqual(2);
    expect(inkObjs[inkObjs.length - 1].params.lineArt).toBe(true);
    expect(res.colors[res.colors.length - 1].id).toBe(ink.colorId);
    // The small-but-critical features survive: a red mouth fill of ~8–30mm².
    const red = res.objects.find((o) => {
      const c = res.colors.find((cc) => cc.id === o.colorId);
      return c && c.rgb[0] > 170 && c.rgb[1] < 90;
    })!;
    const redArea = red.paths.reduce((s, r) => s + Math.abs(polygonArea(r)), 0);
    expect(redArea).toBeGreaterThan(5);
    expect(redArea).toBeLessThan(60);
  });
});
