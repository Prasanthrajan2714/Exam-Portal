import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { computeDeadline, isAttemptExpired, isWindowOpen } from "./exam-window";
import { type GradableQuestion, gradeAttempt } from "./grading";

/**
 * Attempt lifecycle: start, auto-save, finalise.
 *
 * Every timing decision here reads the server clock and the stored instants.
 * The browser's countdown is a display of this, never an input to it.
 */

export type StartResult =
  | { ok: true; attemptId: string; sessionToken: string; resumed: boolean }
  | { ok: false; reason: string };

export async function startAttempt(
  examId: string,
  studentId: string,
): Promise<StartResult> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: { _count: { select: { questions: true } } },
  });
  if (!exam) return { ok: false, reason: "That exam no longer exists." };
  if (exam.status !== "PUBLISHED") {
    return { ok: false, reason: "This exam is not available yet." };
  }
  if (exam._count.questions === 0) {
    return { ok: false, reason: "This exam has no question paper yet." };
  }

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { ok: false, reason: "Student not found." };
  if (student.status !== "ACTIVE") {
    return { ok: false, reason: "Your account has been disabled." };
  }
  if (student.batchId !== exam.batchId) {
    return { ok: false, reason: "This exam is not assigned to your batch." };
  }

  const now = new Date();
  if (!isWindowOpen(exam, now)) {
    return {
      ok: false,
      reason:
        now < exam.startsAt
          ? "This exam has not opened yet."
          : "The exam window has closed.",
    };
  }

  const existing = await prisma.attempt.findUnique({
    where: { examId_studentId: { examId, studentId } },
  });

  if (existing) {
    if (existing.status !== "IN_PROGRESS") {
      return { ok: false, reason: "You have already completed this exam." };
    }
    if (isAttemptExpired(existing, now)) {
      await finaliseAttempt(existing.id, "EXPIRED");
      return { ok: false, reason: "Your time for this exam has run out." };
    }
    // An in-progress attempt is only re-enterable after an admin reopen, which
    // is what issues a fresh session token. Rejoining otherwise is the exact
    // case the spec says needs permission.
    return { ok: false, reason: "IN_PROGRESS" };
  }

  const sessionToken = randomUUID();
  const attempt = await prisma.attempt.create({
    data: {
      examId,
      studentId,
      status: "IN_PROGRESS",
      startedAt: now,
      deadlineAt: computeDeadline(exam, now),
      sessionToken,
      activityLogs: { create: { type: "START" } },
    },
  });

  return { ok: true, attemptId: attempt.id, sessionToken, resumed: false };
}

/**
 * Grades an attempt and writes the outcome. Idempotent: calling it twice for the
 * same attempt returns the already-stored result rather than re-grading, so the
 * expiry sweep and a racing manual submit cannot double-write.
 */
export async function finaliseAttempt(
  attemptId: string,
  status: "SUBMITTED" | "EXPIRED",
) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      exam: true,
      answers: true,
    },
  });
  if (!attempt) return null;
  if (attempt.status !== "IN_PROGRESS") return attempt;

  const questions = await prisma.question.findMany({
    where: { examId: attempt.examId },
    select: {
      id: true,
      subjectId: true,
      correctOption: true,
      marks: true,
      negativeMarks: true,
    },
  });

  const result = gradeAttempt(
    questions as GradableQuestion[],
    attempt.answers.map((a) => ({
      questionId: a.questionId,
      selectedOption: a.selectedOption,
    })),
    {
      marksPerCorrect: attempt.exam.marksPerCorrect,
      negativeMarks: attempt.exam.negativeMarks,
    },
  );

  const outcomeByQuestion = new Map(result.outcomes.map((o) => [o.questionId, o]));

  await prisma.$transaction(async (tx) => {
    // Store the per-answer verdict so scorecards and item analysis need no
    // recomputation later.
    for (const answer of attempt.answers) {
      const outcome = outcomeByQuestion.get(answer.questionId);
      if (!outcome) continue;
      await tx.answer.update({
        where: { id: answer.id },
        data: {
          isCorrect: outcome.isCorrect,
          scoreAwarded: outcome.scoreAwarded,
        },
      });
    }

    await tx.attempt.update({
      where: { id: attemptId },
      data: {
        status,
        submittedAt: new Date(),
        totalScore: result.totalScore,
        correctCount: result.correctCount,
        wrongCount: result.wrongCount,
        unansweredCount: result.unansweredCount,
      },
    });

    await tx.activityLog.create({
      data: {
        attemptId,
        type: status === "SUBMITTED" ? "SUBMIT" : "AUTO_SUBMIT",
        meta: `score=${result.totalScore}`,
      },
    });
  });

  return prisma.attempt.findUnique({ where: { id: attemptId } });
}

/**
 * Closes out an attempt whose deadline passed while nobody was looking.
 *
 * There is no background job: this runs whenever an attempt is read, which is
 * enough because an attempt only matters when someone looks at it. Returns true
 * if it finalised something.
 */
export async function sweepIfExpired(attempt: {
  id: string;
  status: string;
  deadlineAt: Date;
}): Promise<boolean> {
  if (attempt.status !== "IN_PROGRESS") return false;
  if (!isAttemptExpired(attempt)) return false;
  await finaliseAttempt(attempt.id, "EXPIRED");
  return true;
}

/** Sweeps every stale attempt for an exam — used before showing results. */
export async function sweepExamAttempts(examId: string): Promise<void> {
  const stale = await prisma.attempt.findMany({
    where: { examId, status: "IN_PROGRESS", deadlineAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const attempt of stale) {
    await finaliseAttempt(attempt.id, "EXPIRED");
  }
}
