import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { examPhase } from "@/lib/exam-window";
import { formatDate } from "@/lib/utils";
import {
  buildMultiSheetWorkbook,
  type ExportColumn,
  type WorkbookSheet,
  xlsxHeaders,
} from "@/lib/xlsx";
import { buildExamSheetData } from "../exam-sheet";

export const runtime = "nodejs";

/**
 * Consolidated class report: every closed exam of one batch in a single .xlsx,
 * one worksheet per exam plus a leading summary. Same columns as the per-exam
 * export, so this is the "whole term in one file" version of that download.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { batchId } = await params;

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, name: true },
  });
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const published = await prisma.exam.findMany({
    where: { batchId, status: "PUBLISHED" },
    orderBy: [{ examDate: "desc" }, { startsAt: "desc" }],
    select: { id: true, startsAt: true, endsAt: true, durationMinutes: true },
  });

  // "Closed" has to mean the same thing here as everywhere else in the app.
  const closed = published.filter((exam) => examPhase(exam) === "CLOSED");
  if (closed.length === 0) {
    return NextResponse.json(
      { error: "This class has no closed exams yet." },
      { status: 404 },
    );
  }

  const summaryColumns: ExportColumn[] = [
    { header: "#", key: "index", width: 6 },
    { header: "Exam", key: "exam", width: 34 },
    { header: "Exam date", key: "examDate", width: 16 },
    { header: "Students appeared", key: "attempts", width: 18 },
    { header: "Absent", key: "absent", width: 10 },
    { header: "Average", key: "average", width: 12 },
    { header: "Highest", key: "highest", width: 12 },
    { header: "Out of", key: "maxScore", width: 12 },
  ];

  const summaryRows: WorkbookSheet["rows"] = [];
  const examSheets: WorkbookSheet[] = [];

  // Sequential rather than Promise.all: each exam is swept and graded before it
  // is read, and hammering the pool with every exam at once buys nothing here.
  for (const [index, exam] of closed.entries()) {
    const data = await buildExamSheetData(exam.id);
    if (!data) continue;

    // Numbered so the tabs stay in the same newest-first order as the page,
    // even after Excel truncates a long exam name.
    const sheetName = `${index + 1}. ${data.examName}`;
    summaryRows.push({
      // Matches the worksheet tab, whose name Excel may have to truncate.
      index: index + 1,
      exam: data.examName,
      examDate: formatDate(data.examDate),
      attempts: data.attemptCount,
      absent: data.absentCount,
      average: data.averageScore,
      highest: data.highestScore,
      maxScore: data.maxScore,
    });
    examSheets.push({
      name: sheetName,
      columns: data.columns,
      rows: data.rows,
    });
  }

  const buffer = await buildMultiSheetWorkbook([
    { name: "Summary", columns: summaryColumns, rows: summaryRows },
    ...examSheets,
  ]);

  const safeName =
    batch.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "class";

  return new NextResponse(new Uint8Array(buffer), {
    headers: xlsxHeaders(`${safeName}-closed-exam-marks.xlsx`),
  });
}
