import { describe, expect, it } from "vitest";
import { NOTE_MAX_BYTES, formatFileSize, noteFileError } from "@/lib/note-file";

/**
 * What may be uploaded as study material.
 *
 * The size check has to run in the browser as well as the server, which is why
 * this rule lives outside the server-only upload module: a file over the cap is
 * truncated in transit rather than rejected, so the server never sees enough of
 * it to complain. It gets a parser error about a half-finished form instead,
 * naming neither the file nor its size — which is exactly what an admin
 * reported.
 */

function pdf(name: string, size: number, type = "application/pdf"): File {
  const file = new File([new Uint8Array(0)], name, { type });
  // File.size is read-only and building a 21 MB buffer to test a comparison
  // would be silly.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("noteFileError", () => {
  it("accepts an ordinary PDF", () => {
    expect(noteFileError(pdf("chapter-3.pdf", 2 * 1024 * 1024))).toBeNull();
  });

  it("refuses a file past the cap, saying how big it is", () => {
    const problem = noteFileError(pdf("huge.pdf", NOTE_MAX_BYTES + 1));
    expect(problem).toContain("50.0 MB");
    expect(problem).toContain("split it into parts");
  });

  it("accepts a file exactly at the cap", () => {
    expect(noteFileError(pdf("exact.pdf", NOTE_MAX_BYTES))).toBeNull();
  });

  it("refuses anything that is not a PDF", () => {
    // The student page hands the file to the browser's viewer, so the type is
    // not a formality.
    expect(noteFileError(pdf("notes.docx", 1024, "application/msword"))).toContain(
      "must be a PDF",
    );
  });

  it("accepts a dropped file whose type the browser did not report", () => {
    expect(noteFileError(pdf("notes.pdf", 1024, ""))).toBeNull();
    expect(noteFileError(pdf("notes.txt", 1024, ""))).toContain("must be a PDF");
  });

  it("refuses an empty or missing file", () => {
    expect(noteFileError(pdf("empty.pdf", 0))).toContain("Choose a PDF");
    expect(noteFileError(null)).toContain("Choose a PDF");
    expect(noteFileError("not a file")).toContain("Choose a PDF");
  });
});

describe("formatFileSize", () => {
  it("reads the way a person would say it", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1024 * 1024 * 3.5)).toBe("3.5 MB");
  });
});

describe("the cap and the transports it has to fit through", () => {
  it("is 50 MB", () => {
    expect(NOTE_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(formatFileSize(NOTE_MAX_BYTES)).toBe("50.0 MB");
  });

  it("leaves room under the request limits for multipart overhead", async () => {
    // Both limits in next.config.ts have to sit above this one. Under either,
    // the body is truncated in transit and the parser fails on half a form —
    // naming neither the file nor its size, which is exactly what an admin
    // reported. Read from the file so the two cannot drift apart unnoticed.
    const config = await import("node:fs/promises").then((fs) =>
      fs.readFile("next.config.ts", "utf8"),
    );
    const limits = [...config.matchAll(/"(\d+)mb"/g)].map((m) => Number(m[1]));
    expect(limits.length, "both limits should be set").toBe(2);
    for (const limit of limits) {
      expect(limit * 1024 * 1024).toBeGreaterThan(NOTE_MAX_BYTES);
    }
  });
});
