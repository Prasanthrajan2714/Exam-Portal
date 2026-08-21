"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResult,
  authErrorMessage,
  fail,
  ok,
  zodFieldErrors,
} from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const subjectEntry = z.object({
  subjectId: z.string().min(1),
  questionCount: z.number().int().min(1, "At least one question").max(300),
});

const examSchema = z
  .object({
    name: z.string().trim().min(3, "Give the exam a name").max(120),
    batchId: z.string().min(1, "Choose a batch"),
    // ISO instants built in the browser from the date + time pickers, so the
    // admin's local wall-clock time is what gets stored.
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(1, "Duration must be at least a minute").max(600),
    marksPerCorrect: z.number().min(0.25, "Marks per correct answer must be positive").max(100),
    negativeMarks: z.number().min(0, "Negative marks cannot be less than zero").max(100),
    resultVisibility: z.enum(["IMMEDIATE", "AFTER_WINDOW"]),
    subjects: z.array(subjectEntry).min(1, "Select at least one subject"),
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startsAt);
    const end = new Date(data.endsAt);

    if (end <= start) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The exam must close after it opens.",
      });
      return;
    }

    // A 3-hour paper inside a 1-hour window would silently truncate every
    // attempt, so refuse it at creation rather than surprising students.
    const windowMinutes = (end.getTime() - start.getTime()) / 60_000;
    if (data.durationMinutes > windowMinutes) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMinutes"],
        message: `The window is only ${Math.floor(windowMinutes)} minutes long.`,
      });
    }
  });

function parseForm(formData: FormData) {
  const rawSubjects = String(formData.get("subjects") ?? "[]");
  let subjects: unknown = [];
  try {
    subjects = JSON.parse(rawSubjects);
  } catch {
    subjects = [];
  }

  return examSchema.safeParse({
    name: formData.get("name"),
    batchId: formData.get("batchId"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    durationMinutes: Number(formData.get("durationMinutes")),
    marksPerCorrect: Number(formData.get("marksPerCorrect")),
    negativeMarks: Number(formData.get("negativeMarks")),
    resultVisibility: formData.get("resultVisibility"),
    subjects,
  });
}

export async function createExam(
  _prev: ActionResult<{ examId: string }>,
  formData: FormData,
): Promise<ActionResult<{ examId: string }>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const batch = await prisma.batch.findUnique({ where: { id: input.batchId } });
  if (!batch) return fail("That batch no longer exists.", { batchId: "Unknown batch" });

  const startsAt = new Date(input.startsAt);

  const exam = await prisma.exam.create({
    data: {
      name: input.name,
      batchId: input.batchId,
      // Stored for display and grouping; the window itself is startsAt/endsAt.
      examDate: new Date(
        Date.UTC(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate()),
      ),
      startsAt,
      endsAt: new Date(input.endsAt),
      durationMinutes: input.durationMinutes,
      marksPerCorrect: input.marksPerCorrect,
      negativeMarks: input.negativeMarks,
      resultVisibility: input.resultVisibility,
      status: "DRAFT",
      examSubjects: {
        create: input.subjects.map((s, index) => ({
          subjectId: s.subjectId,
          questionCount: s.questionCount,
          order: index,
        })),
      },
    },
  });

  revalidatePath("/admin/exams");
  return ok(`"${exam.name}" created. Now upload its question paper.`, {
    examId: exam.id,
  });
}

export async function updateExam(
  _prev: ActionResult<{ examId: string }>,
  formData: FormData,
): Promise<ActionResult<{ examId: string }>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return fail("Missing exam.");

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const exam = await prisma.exam.findUnique({
    where: { id },
    include: { _count: { select: { attempts: true, questions: true } } },
  });
  if (!exam) return fail("Exam not found.");

  // Changing the paper's shape after students have sat it would invalidate the
  // results already recorded against it.
  if (exam._count.attempts > 0) {
    return fail(
      "Students have already attempted this exam, so its structure can no longer be changed.",
    );
  }

  const startsAt = new Date(input.startsAt);

  // Subject counts can only be edited while no questions exist; once a paper is
  // uploaded, changing counts would orphan questions.
  const subjectsChangeable = exam._count.questions === 0;

  await prisma.$transaction(async (tx) => {
    if (subjectsChangeable) {
      await tx.examSubject.deleteMany({ where: { examId: id } });
      await tx.examSubject.createMany({
        data: input.subjects.map((s, index) => ({
          examId: id,
          subjectId: s.subjectId,
          questionCount: s.questionCount,
          order: index,
        })),
      });
    }

    await tx.exam.update({
      where: { id },
      data: {
        name: input.name,
        batchId: input.batchId,
        examDate: new Date(
          Date.UTC(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate()),
        ),
        startsAt,
        endsAt: new Date(input.endsAt),
        durationMinutes: input.durationMinutes,
        marksPerCorrect: input.marksPerCorrect,
        negativeMarks: input.negativeMarks,
        resultVisibility: input.resultVisibility,
      },
    });
  });

  revalidatePath("/admin/exams");
  revalidatePath(`/admin/exams/${id}`);
  return ok(
    subjectsChangeable
      ? "Exam updated."
      : "Exam updated. Subject question counts were left alone because a paper is already uploaded.",
    { examId: id },
  );
}

export async function deleteExam(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const exam = await prisma.exam.findUnique({
    where: { id },
    include: { _count: { select: { attempts: true } } },
  });
  if (!exam) return fail("Exam not found.");

  if (exam._count.attempts > 0) {
    return fail(
      `${exam._count.attempts} student(s) have already attempted "${exam.name}". ` +
        `Deleting it would erase their results.`,
    );
  }

  await prisma.exam.delete({ where: { id } });
  revalidatePath("/admin/exams");
  return ok(`"${exam.name}" deleted.`);
}

/** Pulls a published exam back to draft so it disappears from student dashboards. */
/**
 * Publishes an exam whose paper is already in place. Publishing used to happen
 * only as the last step of an upload, which left no way forward for a draft that
 * already had its questions — reusing a paper for another batch produces exactly
 * that, and the admin was told to "publish from the question paper screen" where
 * no such button existed.
 */
export async function publishExam(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const exam = await prisma.exam.findUnique({
    where: { id },
    include: {
      examSubjects: true,
      _count: { select: { questions: true } },
    },
  });
  if (!exam) return fail("Exam not found.");
  if (exam.status === "PUBLISHED") return fail("This exam is already published.");
  if (exam._count.questions === 0) {
    return fail("Upload the question paper before publishing this exam.");
  }

  // The same completeness rule the upload step applies: a half-filled paper
  // reaching students is worse than a blocked publish.
  const expected = exam.examSubjects.reduce((sum, s) => sum + s.questionCount, 0);
  if (expected > 0 && exam._count.questions !== expected) {
    return fail(
      `This paper has ${exam._count.questions} of the ${expected} questions the exam expects. ` +
        `Fix the paper before publishing it.`,
    );
  }

  await prisma.exam.update({ where: { id }, data: { status: "PUBLISHED" } });
  revalidatePath("/admin/exams");
  revalidatePath(`/admin/exams/${id}`);
  revalidatePath("/admin/papers");
  revalidatePath(`/admin/papers/${id}`);
  return ok(`"${exam.name}" is published and visible to its batch.`);
}

export async function unpublishExam(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const exam = await prisma.exam.findUnique({
    where: { id },
    include: { _count: { select: { attempts: true } } },
  });
  if (!exam) return fail("Exam not found.");
  if (exam._count.attempts > 0) {
    return fail(
      "Students have already started this exam — unpublishing now would strand them mid-paper.",
    );
  }

  await prisma.exam.update({ where: { id }, data: { status: "DRAFT" } });
  revalidatePath("/admin/exams");
  revalidatePath(`/admin/exams/${id}`);
  revalidatePath("/admin/papers");
  revalidatePath(`/admin/papers/${id}`);
  return ok(`"${exam.name}" is back to draft and hidden from students.`);
}
