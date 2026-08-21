"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, authErrorMessage, fail, ok } from "@/lib/action-result";
import { startAttempt } from "@/lib/attempts";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Begins an exam. Everything that decides whether this is allowed lives in
 * startAttempt, on the server — the dashboard button is only a hint.
 */
export async function beginExam(examId: string): Promise<ActionResult> {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Please sign in again.");
  }

  const result = await startAttempt(examId, student.id);

  if (!result.ok) {
    if (result.reason === "IN_PROGRESS") {
      return fail(
        "You already started this exam. Because it was closed before you " +
          "submitted, you need your administrator's permission to continue — " +
          "use “Request to resume” below.",
      );
    }
    return fail(result.reason);
  }

  revalidatePath("/student/dashboard");
  // The runner lives outside /student so it can render full-screen.
  redirect(`/exam/${result.attemptId}`);
}

const reopenSchema = z.object({
  examId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(10, "Please describe what happened in a little more detail")
    .max(500),
});

/**
 * The student side of the spec's reopen flow: an interrupted exam can only be
 * resumed after an administrator validates the request.
 */
export async function requestReopen(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Please sign in again.");
  }

  const parsed = reopenSchema.safeParse({
    examId: formData.get("examId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Please describe what happened.");
  }

  const attempt = await prisma.attempt.findUnique({
    where: {
      examId_studentId: { examId: parsed.data.examId, studentId: student.id },
    },
    include: { exam: { select: { name: true, endsAt: true } } },
  });
  if (!attempt) {
    return fail("You have not started this exam, so there is nothing to resume.");
  }
  if (attempt.status !== "IN_PROGRESS") {
    return fail("This exam is already finished — it cannot be reopened.");
  }
  if (new Date() > attempt.exam.endsAt) {
    return fail(
      "The exam window has closed, so this exam can no longer be resumed. " +
        "Your answers up to the interruption have been graded.",
    );
  }

  const pending = await prisma.reopenRequest.findFirst({
    where: { attemptId: attempt.id, status: "PENDING" },
  });
  if (pending) {
    return fail("You already have a request waiting for approval.");
  }

  await prisma.$transaction([
    prisma.reopenRequest.create({
      data: {
        attemptId: attempt.id,
        studentId: student.id,
        examId: parsed.data.examId,
        reason: parsed.data.reason,
      },
    }),
    prisma.activityLog.create({
      data: { attemptId: attempt.id, type: "REOPEN_REQUESTED" },
    }),
  ]);

  revalidatePath("/student/dashboard");
  revalidatePath("/admin/reopen-requests");
  return ok(
    "Request sent. Your administrator will review it — refresh this page once they approve.",
  );
}
