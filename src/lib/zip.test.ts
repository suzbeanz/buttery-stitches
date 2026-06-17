import { describe, it, expect } from "vitest";
import { zipStore, crc32 } from "./zip";

/** Parse a STORE-mode zip's central directory back out (enough to verify ours). */
function readEntries(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Find EOCD (no comment, so it's the last 22 bytes).
  const eocd = zip.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(cd, true)).toBe(0x02014b50);
    const size = dv.getUint32(cd + 24, true);
    const nameLen = dv.getUint16(cd + 28, true);
    const lho = dv.getUint32(cd + 42, true);
    const name = dec.decode(zip.subarray(cd + 46, cd + 46 + nameLen));
    // Local header: data begins after 30 + nameLen (+ 0 extra).
    const lNameLen = dv.getUint16(lho + 26, true);
    const dataStart = lho + 30 + lNameLen;
    out.push({ name, data: zip.subarray(dataStart, dataStart + size) });
    cd += 46 + nameLen;
  }
  return out;
}

describe("zipStore", () => {
  it("round-trips entry names and bytes through the central directory", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([9, 8, 7]);
    const zip = zipStore([
      { name: "design.pes", data: a },
      { name: "design.dst", data: b },
    ]);
    const entries = readEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["design.pes", "design.dst"]);
    expect([...entries[0].data]).toEqual([1, 2, 3, 4, 5]);
    expect([...entries[1].data]).toEqual([9, 8, 7]);
  });

  it("crc32 matches the known check value for \"123456789\"", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("handles an empty archive", () => {
    const zip = zipStore([]);
    const dv = new DataView(zip.buffer);
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });
});
