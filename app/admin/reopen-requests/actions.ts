"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { type ActionResult, authErrorMessage, fail, ok } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { extendDeadline } from "@/lib/exam-window";

/**
 * The admin half of the spec's reopen flow: validate the student's story, then
 * let them back in from where they stopped.
 */
export async function approveReopen(
  requestId: string,
  extraMinutes: number,
  note?: string,
): Promise<ActionResult> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const request = await prisma.reopenRequest.findUnique({
    where: { id: requestId },
    include: { attempt: { include: { exam: true } }, student: true },
  });
  if (!request) return fail("Request not found.");
  if (request.status !== "PENDING") return fail("This request has already been handled.");

  const { attempt } = request;
  const now = new Date();

  if (attempt.status !== "IN_PROGRESS") {
    await prisma.reopenRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        adminNote: "The exam had already been graded when this was reviewed.",
        resolvedAt: now,
        resolvedBy: admin.userId,
      },
    });
    revalidatePath("/admin/reopen-requests");
    return fail("That attempt has already been submitted or expired — nothing to reopen.");
  }

  if (now > attempt.exam.endsAt) {
    return fail(
      `The exam window for "${attempt.exam.name}" has closed, so it cannot be reopened. ` +
        `The answers saved before the interruption have been graded.`,
    );
  }

  const minutes = Math.max(0, Math.min(180, Math.round(extraMinutes)));

  await prisma.$transaction([
    prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        // extendDeadline re-bases from now when the old deadline already passed,
        // so a student offline for an hour doesn't get an expired extension —
        // and it still never runs past the exam window.
        deadlineAt: extendDeadline(attempt.exam, attempt.deadlineAt, minutes, now),
        extraTimeMinutes: { increment: minutes },
        reopenCount: { increment: 1 },
        // A fresh token invalidates any tab still holding the old one, and
        // clearing the claim is what actually lets them back in.
        sessionToken: randomUUID(),
        sessionClaimedAt: null,
      },
    }),
    prisma.reopenRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        adminNote: note?.trim() || null,
        grantExtraMinutes: minutes,
        resolvedAt: now,
        resolvedBy: admin.userId,
      },
    }),
    prisma.activityLog.create({
      data: {
        attemptId: attempt.id,
        type: "REOPEN_APPROVED",
        meta: `extraMinutes=${minutes}`,
      },
    }),
  ]);

  revalidatePath("/admin/reopen-requests");
  revalidatePath("/student/dashboard");
  return ok(
    `${request.student.name} can continue${minutes > 0 ? ` with ${minutes} extra minute(s)` : ""}.`,
  );
}

export async function rejectReopen(
  requestId: string,
  note?: string,
): Promise<ActionResult> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const request = await prisma.reopenRequest.findUnique({
    where: { id: requestId },
    include: { student: true },
  });
  if (!request) return fail("Request not found.");
  if (request.status !== "PENDING") return fail("This request has already been handled.");

  await prisma.$transaction([
    prisma.reopenRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        adminNote: note?.trim() || null,
        resolvedAt: new Date(),
        resolvedBy: admin.userId,
      },
    }),
    prisma.activityLog.create({
      data: { attemptId: request.attemptId, type: "REOPEN_REJECTED" },
    }),
  ]);

  revalidatePath("/admin/reopen-requests");
  revalidatePath("/student/dashboard");
  return ok(`Request from ${request.student.name} rejected.`);
}
