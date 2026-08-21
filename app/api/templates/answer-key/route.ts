import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildWorkbook, xlsxHeaders } from "@/lib/xlsx";

export const runtime = "nodejs";

/**
 * The answer-key template, pre-filled with one row per question the exam
 * expects, so the admin only has to type the correct letters.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const examId = new URL(request.url).searchParams.get("examId");

  const rows: Record<string, string | number>[] = [];
  let examName = "answer-key";

  if (examId) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        examSubjects: { include: { subject: true }, orderBy: { order: "asc" } },
      },
    });
    if (exam) {
      examName = exam.name;
      for (const es of exam.examSubjects) {
        for (let n = 1; n <= es.questionCount; n++) {
          rows.push({ subject: es.subject.name, qno: n, answer: "" });
        }
      }
    }
  }

  if (rows.length === 0) {
    rows.push(
      { subject: "Mathematics", qno: 1, answer: "A" },
      { subject: "Mathematics", qno: 2, answer: "C" },
    );
  }

  const buffer = await buildWorkbook(
    "Answer Key",
    [
      { header: "Subject", key: "subject", width: 22 },
      { header: "Q.No", key: "qno", width: 10 },
      { header: "Correct Option", key: "answer", width: 16 },
      { header: "Marks", key: "marks", width: 12 },
      { header: "Negative", key: "negative", width: 12 },
    ],
    rows,
  );

  const safeName = examName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return new NextResponse(new Uint8Array(buffer), {
    headers: xlsxHeaders(`${safeName}-answer-key.xlsx`),
  });
}
