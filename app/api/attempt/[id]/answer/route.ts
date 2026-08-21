import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAttemptExpired, secondsRemaining } from "@/lib/exam-window";

export const runtime = "nodejs";

const schema = z.object({
  questionId: z.string().min(1),
  selectedOption: z.enum(["A", "B", "C", "D"]).nullable(),
  markedForReview: z.boolean().optional(),
  visited: z.boolean().optional(),
  sessionToken: z.string().min(1),
});

/**
 * Auto-save for a single answer.
 *
 * Every change the student makes lands here immediately, so a power cut loses at
 * most the click in flight. The response carries the authoritative time left,
 * which lets the browser's countdown re-sync on every interaction without a
 * separate polling endpoint.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const body = parsed.data;

  const attempt = await prisma.attempt.findUnique({ where: { id } });
  if (!attempt || attempt.studentId !== student.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (attempt.status !== "IN_PROGRESS") {
    return NextResponse.json(
      { error: "This exam has already been submitted.", finished: true },
      { status: 409 },
    );
  }
  // A second browser signing in gets a different token; the older tab is frozen
  // out rather than both writing to the same attempt.
  if (attempt.sessionToken !== body.sessionToken) {
    return NextResponse.json(
      { error: "This exam is open in another window.", conflict: true },
      { status: 409 },
    );
  }
  if (isAttemptExpired(attempt)) {
    return NextResponse.json(
      { error: "Your time has run out.", expired: true },
      { status: 409 },
    );
  }

  // Confirm the question is actually part of this exam before writing.
  const question = await prisma.question.findFirst({
    where: { id: body.questionId, examId: attempt.examId },
    select: { id: true },
  });
  if (!question) {
    return NextResponse.json({ error: "Unknown question" }, { status: 400 });
  }

  await prisma.answer.upsert({
    where: {
      attemptId_questionId: { attemptId: id, questionId: body.questionId },
    },
    create: {
      attemptId: id,
      questionId: body.questionId,
      selectedOption: body.selectedOption,
      markedForReview: body.markedForReview ?? false,
      visited: true,
    },
    update: {
      selectedOption: body.selectedOption,
      ...(body.markedForReview === undefined
        ? {}
        : { markedForReview: body.markedForReview }),
      visited: true,
    },
  });

  return NextResponse.json({
    ok: true,
    secondsRemaining: secondsRemaining(attempt),
  });
}
