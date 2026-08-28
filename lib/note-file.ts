/**
 * What counts as an acceptable piece of study material.
 *
 * Deliberately outside the server-only upload module so the browser can apply
 * the same rule before sending anything. That is not a nicety: a file past the
 * limit is truncated in transit rather than rejected, so by the time the server
 * sees it there is nothing left to check — the multipart body simply ends early
 * and the parser reports "Unexpected end of form", naming neither the file nor
 * its size. Refusing it before it leaves the browser is the only place a useful
 * message can be produced.
 */

/** Matches the transport limits in next.config.ts, which sit just above it. */
export const NOTE_MAX_BYTES = 50 * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function noteFileError(file: unknown): string | null {
  if (!(file instanceof File) || file.size === 0) {
    return "Choose a PDF file to upload.";
  }
  if (file.size > NOTE_MAX_BYTES) {
    return (
      `That file is ${formatFileSize(file.size)}. Study material must be ` +
      `${formatFileSize(NOTE_MAX_BYTES)} or smaller — split it into parts if it is bigger.`
    );
  }
  // Some browsers send an empty type for a drag-dropped file, so the name is a
  // fallback rather than the only check; the server checks the magic bytes.
  const looksPdf =
    file.type === "application/pdf" ||
    (file.type === "" && file.name.toLowerCase().endsWith(".pdf"));
  if (!looksPdf) {
    return "Study material must be a PDF. Save or export the document as PDF and try again.";
  }
  return null;
}
