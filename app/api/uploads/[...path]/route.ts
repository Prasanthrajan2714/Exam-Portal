import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { contentTypeFor, resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Serves question-paper images.
 *
 * These are never public files: anyone who could enumerate them could read a
 * paper before the exam opens. Every request is authenticated, and
 * `resolveUploadPath` refuses anything that escapes the upload directory.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path: segments } = await params;
  const relative = segments.map(decodeURIComponent).join("/");

  const absolute = resolveUploadPath(relative);
  if (!absolute) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const file = await fs.readFile(absolute);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": contentTypeFor(absolute),
        // Content-addressed filenames never change, so this is safe to cache —
        // but keep it private so a shared proxy can't serve it to a stranger.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
