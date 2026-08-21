import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  clearExamUploads,
  copyExamDocument,
  copyExamImage,
  examDir,
  resolveUploadPath,
  saveExamImage,
} from "@/lib/uploads";

/**
 * Reusing a paper for another batch copies its questions, and their images have
 * to come with them. Pointing the copy at the original's files would look fine
 * until someone re-uploaded the first paper — `clearExamUploads` would delete
 * the directory and silently blank out every diagram in the reused exam.
 */

const SOURCE = "itestcopysrc";
const TARGET = "itestcopydst";

// A one-pixel PNG, so the bytes are a real image rather than arbitrary data.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

afterAll(async () => {
  await clearExamUploads(SOURCE);
  await clearExamUploads(TARGET);
});

async function exists(relative: string): Promise<boolean> {
  const absolute = resolveUploadPath(relative);
  if (!absolute) return false;
  try {
    await fs.access(absolute);
    return true;
  } catch {
    return false;
  }
}

describe("copying an exam's uploads to a reused exam", () => {
  it("copies the bytes into the target's own directory, not a reference", async () => {
    const original = await saveExamImage(SOURCE, PNG_BYTES, "image/png");
    expect(original.startsWith(`${examDir(SOURCE).split(path.sep).join("/")}/images/`)).toBe(true);

    const copied = await copyExamImage(TARGET, original);
    expect(copied).not.toBeNull();
    expect(copied).toContain(`/${TARGET}/`);
    expect(copied).not.toBe(original);
    expect(await exists(copied!)).toBe(true);

    // The whole point: wiping the source must leave the copy intact.
    await clearExamUploads(SOURCE);
    expect(await exists(original)).toBe(false);
    expect(await exists(copied!)).toBe(true);

    const bytes = await fs.readFile(resolveUploadPath(copied!)!);
    expect(bytes.equals(PNG_BYTES)).toBe(true);
  });

  it("keeps the extension for formats contentTypeFor does not know", async () => {
    // Word emits .emf/.wmf for pasted equations and drawings. Routing those
    // through the MIME table would rename them to .bin and break the <img>.
    const dir = resolveUploadPath(path.join(examDir(SOURCE), "images"))!;
    await fs.mkdir(dir, { recursive: true });
    const relative = `${examDir(SOURCE).split(path.sep).join("/")}/images/diagram.emf`;
    await fs.writeFile(resolveUploadPath(relative)!, PNG_BYTES);

    const copied = await copyExamImage(TARGET, relative);
    expect(copied).not.toBeNull();
    expect(copied!.endsWith(".emf")).toBe(true);
    expect(await exists(copied!)).toBe(true);
  });

  it("returns null for a missing or escaping source rather than throwing", async () => {
    expect(await copyExamImage(TARGET, "exams/nope/images/gone.png")).toBeNull();
    expect(await copyExamImage(TARGET, "../../../etc/passwd")).toBeNull();
  });

  it("copies the stored source document too", async () => {
    const dir = resolveUploadPath(examDir(SOURCE))!;
    await fs.mkdir(dir, { recursive: true });
    const relative = `${examDir(SOURCE).split(path.sep).join("/")}/paper.docx`;
    await fs.writeFile(resolveUploadPath(relative)!, PNG_BYTES);

    const copied = await copyExamDocument(TARGET, relative);
    expect(copied).not.toBeNull();
    expect(copied).toContain(`/${TARGET}/`);
    expect(copied!.endsWith(".docx")).toBe(true);
    expect(await exists(copied!)).toBe(true);
  });
});
