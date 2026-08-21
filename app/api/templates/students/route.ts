import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildWorkbook, xlsxHeaders } from "@/lib/xlsx";

export const runtime = "nodejs";

/**
 * The sample sheet for bulk student upload. Generated rather than shipped as a
 * static file so the example rows use batch names that actually exist in this
 * installation — the commonest import error is a batch name that doesn't match.
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batches = await prisma.batch.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    take: 3,
  });
  const example = batches[0]?.name ?? "Class 6";
  const second = batches[1]?.name ?? example;

  const buffer = await buildWorkbook(
    "Students",
    [
      { header: "Name", key: "name", width: 26 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Email", key: "email", width: 30 },
      { header: "School Name", key: "school", width: 30 },
      { header: "Batch", key: "batch", width: 20 },
    ],
    [
      {
        name: "Arjun Kumar",
        phone: "9876543210",
        email: "arjun.kumar@example.com",
        school: "St. Joseph Higher Secondary School",
        batch: example,
      },
      {
        name: "Priya Sharma",
        phone: "9876501234",
        email: "priya.sharma@example.com",
        school: "Kendriya Vidyalaya",
        batch: second,
      },
    ],
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: xlsxHeaders("firstbench-students-template.xlsx"),
  });
}
