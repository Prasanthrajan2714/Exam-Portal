import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isMetafile, metafileToPng } from "@/lib/wmf";

/**
 * Word's Equation Editor stores formulae as WMF/EMF, which browsers cannot
 * render — a chemistry paper's options arrived as broken-image icons. These
 * cover the detection and, on Windows, the rasterisation itself.
 */

describe("isMetafile", () => {
  it("recognises what Word actually emits", () => {
    expect(isMetafile("image/x-wmf")).toBe(true);
    expect(isMetafile("image/x-emf")).toBe(true);
    expect(isMetafile("IMAGE/X-WMF")).toBe(true);
  });

  it("leaves ordinary images alone", () => {
    expect(isMetafile("image/png")).toBe(false);
    expect(isMetafile("image/jpeg")).toBe(false);
    expect(isMetafile("")).toBe(false);
  });
});

/** A placeable WMF drawing a single filled rectangle. */
function placeableWmf(): Buffer {
  const records: number[][] = [
    // SetWindowOrg(0, 0)
    [0x020b, 0, 0],
    // SetWindowExt(100, 100)
    [0x020c, 100, 100],
    // Rectangle(10, 10, 90, 90) — params are pushed in reverse order
    [0x041b, 90, 90, 10, 10],
  ];

  const bodies = records.map(([fn, ...params]) => {
    const size = 3 + params.length; // size in 16-bit words
    const buf = Buffer.alloc(size * 2);
    buf.writeUInt32LE(size, 0);
    buf.writeUInt16LE(fn, 4);
    params.forEach((p, i) => buf.writeInt16LE(p, 6 + i * 2));
    return buf;
  });

  const eof = Buffer.alloc(6);
  eof.writeUInt32LE(3, 0);
  eof.writeUInt16LE(0, 4);

  const body = Buffer.concat([...bodies, eof]);

  // Standard 18-byte WMF header.
  const header = Buffer.alloc(18);
  header.writeUInt16LE(1, 0); // memory metafile
  header.writeUInt16LE(9, 2); // header size in words
  header.writeUInt16LE(0x0300, 4); // version
  header.writeUInt32LE((18 + body.length) / 2, 6); // total size in words
  header.writeUInt16LE(1, 10); // number of objects
  header.writeUInt32LE(5, 12); // max record size
  header.writeUInt16LE(0, 16);

  // 22-byte Aldus placeable header, which is what Word writes.
  const apm = Buffer.alloc(22);
  apm.writeUInt32LE(0x9ac6cdd7, 0);
  apm.writeUInt16LE(0, 4);
  apm.writeInt16LE(0, 6);
  apm.writeInt16LE(0, 8);
  apm.writeInt16LE(100, 10);
  apm.writeInt16LE(100, 12);
  apm.writeUInt16LE(96, 14); // units per inch
  apm.writeUInt32LE(0, 16);
  let checksum = 0;
  for (let i = 0; i < 10; i++) checksum ^= apm.readUInt16LE(i * 2);
  apm.writeUInt16LE(checksum, 20);

  return Buffer.concat([apm, header, body]);
}

describe("metafileToPng", () => {
  const onWindows = process.platform === "win32";
  const maybe = onWindows ? it : it.skip;

  maybe("rasterises a metafile into a PNG", { timeout: 60_000 }, async () => {
    const raster = await metafileToPng(placeableWmf());
    expect(raster, "conversion should succeed on Windows").not.toBeNull();
    // PNG magic number.
    expect(raster!.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(raster!.png.length).toBeGreaterThan(100);
    // The size the document intends, which is what it must display at.
    expect(raster!.width).toBeGreaterThan(0);
    expect(raster!.height).toBeGreaterThan(0);
  });

  maybe("converts a real Word equation if one is on disk", { timeout: 60_000 }, async () => {
    // Uses whatever a real upload left behind; skipped when there is none.
    const root = path.resolve("uploads/exams");
    let found: string | null = null;
    async function walk(dir: string) {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (found) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(wmf|emf)$/i.test(e.name)) found = p;
      }
    }
    await walk(root);
    if (!found) {
      console.log("no .wmf on disk to try — skipping");
      return;
    }
    const raster = await metafileToPng(await fs.readFile(found));
    console.log(
      `converted ${path.basename(found)} -> ${
        raster ? `${raster.png.length} bytes, displays at ${raster.width}x${raster.height}` : "null"
      }`,
    );
    expect(raster).not.toBeNull();
  });

  it("returns null rather than throwing on rubbish input", async () => {
    expect(await metafileToPng(Buffer.from("not a metafile at all"))).toBeNull();
  });
});
