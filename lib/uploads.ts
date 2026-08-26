import "server-only";
import { NOTE_MAX_BYTES, formatFileSize, noteFileError } from "./note-file";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isMetafile, metafileToPng } from "./wmf";

/**
 * Local-disk storage for uploaded papers and the images pulled out of them.
 * Everything goes through `resolveUploadPath`, which is the only place that
 * turns caller-supplied text into a filesystem path.
 */

export function uploadRoot(): string {
  // turbopackIgnore keeps the bundler from tracing the entire project into the
  // server output: the path is env-driven on purpose (it becomes an S3 prefix or
  // a mounted volume in production), so it cannot be statically scoped.
  return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "./uploads");
}

/**
 * Resolves a relative path inside the upload root, refusing anything that
 * escapes it. Image paths reach this from the database and from URLs, so
 * traversal (`../../.env`) has to be impossible rather than merely unlikely.
 */
export function resolveUploadPath(relative: string): string | null {
  const root = uploadRoot();
  const target = path.resolve(root, relative);
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(withSep)) return null;
  return target;
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Directory holding everything for one exam, relative to the upload root. */
export function examDir(examId: string): string {
  return path.join("exams", sanitiseSegment(examId));
}

function sanitiseSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]/g, "");
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/x-emf": ".emf",
  "image/x-wmf": ".wmf",
};

/**
 * Writes an image extracted from a .docx and returns its upload-root-relative
 * path. Content-addressed by hash, so a logo repeated on every page is stored
 * once instead of sixty times.
 */
export type StoredImage = {
  /** Upload-root-relative path. */
  path: string;
  /**
   * The size the document lays this out at, in CSS pixels — zero when unknown.
   * Word equations are inline and text-height (152 x 24 for a typical one), and
   * without carrying that through they render at the raster's own size.
   */
  width: number;
  height: number;
};

export async function saveExamImage(
  examId: string,
  data: Buffer,
  contentType: string,
): Promise<StoredImage> {
  const dirRelative = path.join(examDir(examId), "images");
  const dirAbsolute = resolveUploadPath(dirRelative);
  if (!dirAbsolute) throw new Error("Invalid upload path");
  await ensureDir(dirAbsolute);

  // Word writes Equation Editor formulae as WMF/EMF, which no browser renders —
  // they reached the review screen as broken images. Rasterise them here so what
  // is stored is what an admin and a student can actually see. If the platform
  // cannot do it, keep the original rather than losing the equation.
  let width = 0;
  let height = 0;
  if (isMetafile(contentType)) {
    const raster = await metafileToPng(data);
    if (raster) {
      data = raster.png;
      contentType = "image/png";
      width = raster.width;
      height = raster.height;
    }
  }

  const extension = EXTENSION_BY_MIME[contentType.toLowerCase()] ?? ".bin";
  const hash = createHash("sha1").update(data).digest("hex").slice(0, 16);
  const filename = `${hash}${extension}`;

  const absolute = path.join(dirAbsolute, filename);
  try {
    await fs.access(absolute);
  } catch {
    await fs.writeFile(absolute, data);
  }

  // Always forward slashes: this value ends up in URLs.
  return {
    path: `${dirRelative.split(path.sep).join("/")}/${filename}`,
    width,
    height,
  };
}

/** Stores an uploaded source document (the .docx or .xlsx) for later reference. */
export async function saveExamDocument(
  examId: string,
  file: File,
): Promise<string> {
  const dirRelative = examDir(examId);
  const dirAbsolute = resolveUploadPath(dirRelative);
  if (!dirAbsolute) throw new Error("Invalid upload path");
  await ensureDir(dirAbsolute);

  const extension = path.extname(file.name).toLowerCase().slice(0, 10) || ".bin";
  const filename = `${randomUUID()}${extension}`;
  await fs.writeFile(
    path.join(dirAbsolute, filename),
    Buffer.from(await file.arrayBuffer()),
  );

  return `${dirRelative.split(path.sep).join("/")}/${filename}`;
}

/** Removes everything stored for an exam — used when a paper is replaced. */
export async function clearExamUploads(examId: string): Promise<void> {
  const absolute = resolveUploadPath(examDir(examId));
  if (!absolute) return;
  await fs.rm(absolute, { recursive: true, force: true });
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream";
}

/**
 * Copies an image already stored under one exam into another exam's directory,
 * returning the new upload-root-relative path (null when the original file is
 * gone). Reusing a paper for a second batch must not leave the copy pointing at
 * the source's files: replacing or deleting the source paper wipes its whole
 * directory, which would blank the copy's diagrams.
 */
export async function copyExamImage(
  targetExamId: string,
  sourcePath: string,
): Promise<string | null> {
  const absolute = resolveUploadPath(sourcePath);
  if (!absolute) return null;

  let data: Buffer;
  try {
    data = await fs.readFile(absolute);
  } catch {
    return null;
  }

  const contentType = contentTypeFor(absolute);
  if (contentType !== "application/octet-stream") {
    return (await saveExamImage(targetExamId, data, contentType)).path;
  }

  // saveExamImage derives the extension from the MIME type, and contentTypeFor
  // does not know .emf/.wmf — round-tripping those through it would rename them
  // to .bin. Write them here instead, keeping the extension and the same
  // content-addressed filename.
  const dirRelative = path.join(examDir(targetExamId), "images");
  const dirAbsolute = resolveUploadPath(dirRelative);
  if (!dirAbsolute) return null;
  await ensureDir(dirAbsolute);

  const extension = path.extname(absolute).toLowerCase() || ".bin";
  const filename = `${createHash("sha1").update(data).digest("hex").slice(0, 16)}${extension}`;
  const target = path.join(dirAbsolute, filename);
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, data);
  }

  return `${dirRelative.split(path.sep).join("/")}/${filename}`;
}

/**
 * Copies a stored source document (the .docx or .xlsx) onto another exam, so a
 * reused paper keeps its own copy when the original's uploads are cleared.
 */
export async function copyExamDocument(
  targetExamId: string,
  sourcePath: string,
): Promise<string | null> {
  const absolute = resolveUploadPath(sourcePath);
  if (!absolute) return null;

  const dirRelative = examDir(targetExamId);
  const dirAbsolute = resolveUploadPath(dirRelative);
  if (!dirAbsolute) return null;
  await ensureDir(dirAbsolute);

  const extension = path.extname(absolute).toLowerCase().slice(0, 10) || ".bin";
  const filename = `${randomUUID()}${extension}`;
  try {
    await fs.copyFile(absolute, path.join(dirAbsolute, filename));
  } catch {
    return null;
  }

  return `${dirRelative.split(path.sep).join("/")}/${filename}`;
}

// ---------------------------------------------------------------- study notes

/**
 * PDF only, and no larger than the cap: the student side hands the file straight
 * to the browser's viewer, so accepting arbitrary types would mean serving
 * whatever an admin picked back to a class.
 *
 * The rule itself lives in a module the browser can import too, because a file
 * over the cap never arrives whole for the server to reject.
 */
export { NOTE_MAX_BYTES, formatFileSize, noteFileError };

/** Directory holding one batch's study notes, relative to the upload root. */
export function noteDir(batchId: string): string {
  return path.join("notes", sanitiseSegment(batchId));
}

/**
 * Writes a note's PDF and returns its upload-root-relative path. Throws with a
 * message meant for the admin, so the caller can surface it as a form error.
 */
export async function saveNoteFile(batchId: string, file: File): Promise<string> {
  const problem = noteFileError(file);
  if (problem) throw new Error(problem);

  const data = Buffer.from(await file.arrayBuffer());
  // Content-Type is client-supplied; the header is what actually decides
  // whether a browser will render this, so verify it really is a PDF.
  if (data.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("That file is not a readable PDF — it may be renamed or corrupted.");
  }

  const dirRelative = noteDir(batchId);
  const dirAbsolute = resolveUploadPath(dirRelative);
  if (!dirAbsolute) throw new Error("Invalid upload path");
  await ensureDir(dirAbsolute);

  const filename = `${randomUUID()}.pdf`;
  await fs.writeFile(path.join(dirAbsolute, filename), data);

  // Always forward slashes: this value ends up in URLs.
  return `${dirRelative.split(path.sep).join("/")}/${filename}`;
}

/**
 * Removes one note's file. Best-effort: a missing file must not stop the row
 * from being deleted, or a half-cleaned note would be undeletable.
 */
export async function deleteNoteFile(relative: string): Promise<void> {
  const absolute = resolveUploadPath(relative);
  if (!absolute) return;
  await fs.rm(absolute, { force: true });
}
