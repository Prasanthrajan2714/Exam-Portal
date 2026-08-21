import { NextResponse } from "next/server";
import { finaliseAttempt } from "@/lib/attempts";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canShowResult, isAttemptExpired } from "@/lib/exam-window";

export const runtime = "nodejs";

/**
 * Ends an attempt and grades it.
 *
 * The elapsed time is recomputed here rather than trusted from the client: a
 * late submit is still accepted (the answers are real) but is recorded as
 * EXPIRED, so a tampered browser clock cannot buy extra minutes.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const attempt = await prisma.attempt.findUnique({
    where: { id },
    include: { exam: true },
  });
  if (!attempt || attempt.studentId !== student.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (attempt.status !== "IN_PROGRESS") {
    // Already finished — treat as success so a double-click or a retry after a
    // dropped connection doesn't show the student an error.
    return NextResponse.json({
      ok: true,
      alreadySubmitted: true,
      resultAvailable: canShowResult(attempt.exam),
    });
  }

  const expired = isAttemptExpired(attempt);
  await finaliseAttempt(id, expired ? "EXPIRED" : "SUBMITTED");

  return NextResponse.json({
    ok: true,
    expired,
    resultAvailable: canShowResult(attempt.exam),
  });
}
