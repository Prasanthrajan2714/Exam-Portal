import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Serves a study note's PDF.
 *
 * Authorisation is per-note rather than per-path: an admin may read anything,
 * a student may read only a visible note belonging to their own batch, and a
 * note they are not entitled to is a 404 rather than a 403 — otherwise the
 * response would confirm which material other batches have been given.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (session.role !== "ADMIN") {
    // Re-read the student rather than trusting the JWT's batch: a transfer or a
    // disabled account must take effect on the next request.
    const student = session.studentId
      ? await prisma.student.findUnique({ where: { id: session.studentId } })
      : null;
    const allowed =
      student !== null &&
      student.status === "ACTIVE" &&
      student.batchId === note.batchId &&
      note.active;
    if (!allowed) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const absolute = resolveUploadPath(note.filePath);
  if (!absolute) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let size: number;
  try {
    size = (await fs.stat(absolute)).size;
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  // Streamed, not read into memory: study material runs to tens of megabytes and
  // several students open the same file at once.
  const body = Readable.toWeb(
    createReadStream(absolute),
  ) as unknown as ReadableStream<Uint8Array>;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(size),
      "Content-Disposition": contentDisposition(download, note.originalName),
      // Private: the file is behind auth, so no shared proxy may keep a copy.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

/**
 * Inline by default so "View" opens the browser's PDF viewer. The filename is
 * both ASCII-stripped and percent-encoded because it is admin-supplied text
 * going into a response header.
 */
function contentDisposition(download: boolean, filename: string): string {
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 100) || "note.pdf";
  const type = download ? "attachment" : "inline";
  return `${type}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
