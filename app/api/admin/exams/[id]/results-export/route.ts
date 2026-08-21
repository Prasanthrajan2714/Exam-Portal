import { NextResponse } from "next/server";
import { buildExamSheetData } from "@/app/api/admin/reports/exam-sheet";
import { getSession } from "@/lib/auth";
import { buildWorkbook, xlsxHeaders } from "@/lib/xlsx";

export const runtime = "nodejs";

/**
 * Exam results as an .xlsx: one row per student of the class, with a column per
 * subject so the sheet matches the on-screen scorecard. Students who never sat
 * the exam are listed too, marked Absent — a mark sheet that quietly omits them
 * cannot be used to chase anybody up.
 *
 * The rows come from the same builder as the class report, so the two downloads
 * can be read side by side.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const sheet = await buildExamSheetData(id);
  if (!sheet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await buildWorkbook("Results", sheet.columns, sheet.rows);

  const safeName = `${sheet.examName}-${sheet.batchName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return new NextResponse(new Uint8Array(buffer), {
    headers: xlsxHeaders(`${safeName}-results.xlsx`),
  });
}
