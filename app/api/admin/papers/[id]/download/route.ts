import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { examPhase } from "@/lib/exam-window";
import {
  buildPaperDocument,
  paperFileName,
  type PaperQuestion,
} from "@/lib/paper-document";

export const runtime = "nodejs";

/**
 * The finished paper as a Word document.
 *
 * Only once the exam window has closed. A document is the easiest thing in the
 * world to forward to somebody who has not sat the paper yet, so this is refused
 * rather than trusted to an admin's care — the same rule the student solutions
 * page follows, and enforced here rather than only by hiding the button.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const withSolutions = new URL(request.url).searchParams.get("solutions") === "1";

  const exam = await prisma.exam.findUnique({
    where: { id },
    include: { batch: { select: { name: true } } },
  });
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (exam.status !== "PUBLISHED" || examPhase(exam) !== "CLOSED") {
    return NextResponse.json(
      { error: "This exam has not finished yet." },
      { status: 409 },
    );
  }

  const questions = (await prisma.question.findMany({
    where: { examId: id },
    orderBy: [{ subject: { order: "asc" } }, { number: "asc" }],
    include: {
      subject: { select: { name: true } },
      images: { orderBy: { order: "asc" } },
    },
  })) as unknown as PaperQuestion[];

  const buffer = await buildPaperDocument(exam, questions, withSolutions);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${paperFileName(exam.name, withSolutions)}"`,
    },
  });
}
