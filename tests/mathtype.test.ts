import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mtefToText } from "@/lib/mtef";
import { readOleStream } from "@/lib/ole";

/**
 * Reading a MathType formula out of the Word document it was typed into.
 *
 * Every fixture here is a real `word/embeddings/oleObjectN.bin` lifted from a
 * paper an admin actually uploaded, so the OLE reader and the MTEF decoder are
 * both exercised against genuine bytes rather than something written to suit
 * them. The expected strings are what the surrounding question says in words.
 */

const FIXTURES = "tests/fixtures/mathtype";

const load = (name: string) => fs.readFile(`${FIXTURES}/${name}`);

const decode = async (name: string): Promise<string | null> => {
  const stream = readOleStream(await load(name), "Equation Native");
  return stream ? mtefToText(stream) : null;
};

describe("readOleStream", () => {
  it("finds the equation inside a real embedding", async () => {
    const stream = readOleStream(await load("circle-equation.bin"), "Equation Native");
    expect(stream).not.toBeNull();
    // The OLE equation header says where the MTEF starts; 28 bytes in practice.
    expect(stream!.readUInt16LE(0)).toBe(28);
    // MTEF version 5, then the application key MathType writes.
    expect(stream![28]).toBe(5);
    expect(stream!.subarray(33, 38).toString("latin1")).toBe("DSMT6");
  });

  it("returns null for a stream the file does not have", async () => {
    expect(readOleStream(await load("circle-equation.bin"), "Nothing")).toBeNull();
  });

  it("returns null for something that is not a compound file", () => {
    expect(readOleStream(Buffer.from("PK a zip, not an OLE file"), "Equation Native")).toBeNull();
  });

  it("returns null for a truncated file rather than throwing", async () => {
    // Uploads are not to be trusted: half a file must be a null, not a crash.
    const whole = await load("circle-equation.bin");
    for (const length of [8, 100, 512, 1024, 2048]) {
      expect(readOleStream(whole.subarray(0, length), "Equation Native")).toBeNull();
    }
  });

  it("returns null rather than looping when a sector points at itself", async () => {
    // A chain that cycles is the one corruption that could hang the upload.
    const data = Buffer.from(await load("circle-equation.bin"));
    const sectorSize = 1 << data.readUInt16LE(0x1e);
    const firstFat = data.readUInt32LE(0x4c);
    const fatStart = 512 + firstFat * sectorSize;
    // Point every FAT entry at its own sector.
    for (let i = 0; i * 4 < sectorSize; i++) data.writeUInt32LE(i, fatStart + i * 4);
    expect(readOleStream(data, "Equation Native")).toBeNull();
  });
});

describe("mtefToText", () => {
  it("reads a polynomial, superscripts and all", async () => {
    expect(await decode("circle-equation.bin")).toBe("x²+y²+6x+6y+3=0");
  });

  it("reads the subscripts in a chemical formula", async () => {
    // Losing these would turn CH₃Cl into CH3Cl at best and CHCl at worst.
    expect(await decode("chemical-formula.bin")).toBe("CH₃Cl, CH₂Cl₂, CHCl₃");
  });

  it("reads a fraction with the same brackets ommlToText would use", async () => {
    expect(await decode("fraction.bin")).toBe("−1/4");
  });

  it("reads a nested integral", async () => {
    // The hardest thing in these papers: an integral whose integrand contains
    // bracketed groups, functions and a superscripted exponential.
    expect(await decode("integral.bin")).toBe(
      "∫ eˢᵉᶜˣ(sec x tan x f(x))+(sec x tan x +sec² x)dx=eˢᵉᶜˣf(x)+C",
    );
  });

  it("declines the older Equation.3 format instead of guessing at it", async () => {
    // MTEF 2 and 3 are a different layout. Read as though they were version 5
    // they would produce something — and something is worse than nothing here.
    expect(await decode("equation3-legacy.bin")).toBeNull();
  });
});

describe("what the decoder refuses", () => {
  /** Wraps MTEF bytes in the OLE equation header the stream carries. */
  function stream(...mtef: number[]): Buffer {
    const header = Buffer.alloc(28);
    header.writeUInt16LE(28, 0);
    return Buffer.concat([header, Buffer.from(mtef)]);
  }

  /** version 5, platform bytes, "DSMT6", options. */
  const PREAMBLE = [5, 1, 0, 6, 9, 0x44, 0x53, 0x4d, 0x54, 0x36, 0, 0];

  it("reads a plain character", () => {
    // CHAR: tag, options, typeface, code lo, code hi. Then END.
    expect(mtefToText(stream(...PREAMBLE, 0x02, 0x00, 0x01, 0x78, 0x00, 0x00))).toBe("x");
  });

  it("refuses a record tag it does not know", () => {
    // Skipping it and reading on would resynchronise somewhere arbitrary, and
    // the bytes after that point still parse — into a different equation.
    expect(mtefToText(stream(...PREAMBLE, 0x7f, 0x00, 0x00))).toBeNull();
  });

  it("refuses a version other than 5", () => {
    expect(mtefToText(stream(3, 1, 0, 6, 9, 0x44, 0x53, 0x4d, 0x54, 0x36, 0, 0))).toBeNull();
  });

  it("refuses a stream that ends mid-record", () => {
    // A CHAR needs four bytes after its tag and only two are here.
    expect(mtefToText(stream(...PREAMBLE, 0x02, 0x00, 0x01))).toBeNull();
  });

  it("refuses a private-use glyph it has no mapping for", () => {
    // It would reach a student as an empty box.
    expect(mtefToText(stream(...PREAMBLE, 0x02, 0x00, 0x01, 0x00, 0xe1, 0x00))).toBeNull();
  });

  it("accepts the private-use characters that do occur", () => {
    // 0xEF02 is MathType's own space.
    expect(mtefToText(stream(...PREAMBLE, 0x02, 0x00, 0x01, 0x78, 0x00, 0x02, 0x00, 0x01, 0x02, 0xef, 0x02, 0x00, 0x01, 0x79, 0x00, 0x00))).toBe("x y");
  });

  it("refuses an empty header", () => {
    expect(mtefToText(Buffer.alloc(0))).toBeNull();
    expect(mtefToText(Buffer.from([0x1c, 0x00]))).toBeNull();
  });

  it("returns null for an equation that decodes to nothing", () => {
    // A blank equation object tells the reader nothing; its picture at least
    // shows whatever the author left behind.
    expect(mtefToText(stream(...PREAMBLE, 0x00))).toBeNull();
  });

  it("treats a null line as absent, not as a line with contents", () => {
    // The detail that mis-nests every script in a document when it is wrong: a
    // null LINE has no children and no END of its own, so reading one as an
    // ordinary line swallows the record after it.
    const nullLineThenChar = stream(
      ...PREAMBLE,
      0x01, 0x01, // LINE, options = null
      0x02, 0x00, 0x01, 0x7a, 0x00, // CHAR "z" — a sibling, not a child
      0x00, // END
    );
    expect(mtefToText(nullLineThenChar)).toBe("z");
  });
});
