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
import { type AnswerKeyEntry, findKeyEntry, parseAnswerKey } from "@/lib/answer-key";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseQuestionPaper } from "@/lib/docx-parser";
import {
  clearExamUploads,
  copyExamDocument,
  copyExamImage,
  saveExamDocument,
} from "@/lib/uploads";

/**
 * Upload → parse → preview → publish.
 *
 * Nothing reaches the Question table until `publishPaper`. The admin always sees
 * exactly what was understood from their Word document first, because a
 * silently mis-parsed question is worse than a rejected upload.
 */

export type DraftQuestion = {
  index: number;
  subjectName: string;
  number: number;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: "A" | "B" | "C" | "D" | null;
  marks: number | null;
  negativeMarks: number | null;
  images: { path: string; target: "STEM" | "A" | "B" | "C" | "D" }[];
  issues: string[];
};

export type DraftPaper = {
  questions: DraftQuestion[];
  /** Per-subject reconciliation against what the exam expects. */
  subjectCounts: {
    subjectName: string;
    expected: number;
    parsed: number;
    matched: boolean;
  }[];
  warnings: string[];
  keyErrors: string[];
  unmatchedSubjects: string[];
};

// ---------------------------------------------------------------- parse

export async function parsePaper(
  formData: FormData,
): Promise<ActionResult<DraftPaper>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const examId = String(formData.get("examId") ?? "");
  const paperFile = formData.get("paper");
  const keyFile = formData.get("answerKey");

  if (!examId) return fail("Missing exam.");
  if (!(paperFile instanceof File) || paperFile.size === 0) {
    return fail("Choose the question paper (.docx).");
  }
  if (!paperFile.name.toLowerCase().endsWith(".docx")) {
    return fail("The question paper must be a Word .docx file.");
  }
  const hasKey = keyFile instanceof File && keyFile.size > 0;
  if (hasKey && !(keyFile as File).name.toLowerCase().endsWith(".xlsx")) {
    return fail("The answer key must be an Excel .xlsx file.");
  }

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      examSubjects: { include: { subject: true }, orderBy: { order: "asc" } },
      _count: { select: { attempts: true } },
    },
  });
  if (!exam) return fail("Exam not found.");
  if (exam._count.attempts > 0) {
    return fail(
      "Students have already attempted this exam — its paper can no longer be replaced.",
    );
  }

  // Re-uploading replaces the previous paper wholesale, so clear the old images
  // rather than leaving them orphaned on disk.
  await clearExamUploads(examId);

  let parsed;
  try {
    parsed = await parseQuestionPaper(paperFile, examId);
  } catch (error) {
    return fail(
      `That document could not be read: ${(error as Error).message}. ` +
        `Make sure it is a .docx saved by Word, not a .doc or a PDF renamed.`,
    );
  }

  let keyEntries: AnswerKeyEntry[] = [];
  let keyErrors: string[] = [];
  if (hasKey) {
    const key = await parseAnswerKey(keyFile as File);
    keyEntries = key.entries;
    keyErrors = key.errors;
  }

  const questions: DraftQuestion[] = parsed.questions.map((q) => {
    const entry = findKeyEntry(keyEntries, q.subjectName, q.number);
    const issues = [...q.issues];
    if (hasKey && !entry) {
      issues.push(
        `No answer in the key for ${q.subjectName || "this subject"} question ${q.number}`,
      );
    }
    return {
      index: q.index,
      subjectName: q.subjectName,
      number: q.number,
      text: q.text,
      optionA: q.options.A,
      optionB: q.options.B,
      optionC: q.options.C,
      optionD: q.options.D,
      correctOption: entry?.correctOption ?? null,
      marks: entry?.marks ?? null,
      negativeMarks: entry?.negativeMarks ?? null,
      images: q.images,
      issues,
    };
  });

  // Reconcile against the structure the exam was created with.
  const parsedBySubject = new Map<string, number>();
  for (const q of questions) {
    const key = q.subjectName.toLowerCase();
    parsedBySubject.set(key, (parsedBySubject.get(key) ?? 0) + 1);
  }

  const subjectCounts = exam.examSubjects.map((es) => {
    const parsedCount = parsedBySubject.get(es.subject.name.toLowerCase()) ?? 0;
    return {
      subjectName: es.subject.name,
      expected: es.questionCount,
      parsed: parsedCount,
      matched: parsedCount === es.questionCount,
    };
  });

  const expectedNames = new Set(
    exam.examSubjects.map((es) => es.subject.name.toLowerCase()),
  );
  const unmatchedSubjects = [...new Set(questions.map((q) => q.subjectName))].filter(
    (name) => name && !expectedNames.has(name.toLowerCase()),
  );

  const questionPaperFile = await saveExamDocument(examId, paperFile).catch(() => null);
  const answerKeyFile = hasKey
    ? await saveExamDocument(examId, keyFile as File).catch(() => null)
    : null;
  await prisma.exam.update({
    where: { id: examId },
    data: { questionPaperFile, answerKeyFile },
  });

  return ok(`${questions.length} question(s) read from the document.`, {
    questions,
    subjectCounts,
    warnings: parsed.warnings.map((w) =>
      w.line > 0 ? `Line ${w.line}: ${w.message}` : w.message,
    ),
    keyErrors,
    unmatchedSubjects,
  });
}

// ---------------------------------------------------------------- publish

const publishSchema = z.object({
  examId: z.string().min(1),
  publish: z.boolean(),
  questions: z
    .array(
      z.object({
        subjectName: z.string().min(1),
        number: z.number().int().min(1),
        text: z.string(),
        optionA: z.string(),
        optionB: z.string(),
        optionC: z.string(),
        optionD: z.string(),
        correctOption: z.enum(["A", "B", "C", "D"]),
        marks: z.number().nullable(),
        negativeMarks: z.number().nullable(),
        images: z.array(
          z.object({
            path: z.string(),
            target: z.enum(["STEM", "A", "B", "C", "D"]),
          }),
        ),
      }),
    )
    .min(1, "There are no questions to save."),
});

export async function publishPaper(
  input: z.input<typeof publishSchema>,
): Promise<ActionResult<{ examId: string }>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(
      first?.message === "Required"
        ? "Every question needs a correct answer before it can be saved."
        : (first?.message ?? "Some questions are incomplete."),
    );
  }
  const data = parsed.data;

  const exam = await prisma.exam.findUnique({
    where: { id: data.examId },
    include: {
      examSubjects: { include: { subject: true } },
      _count: { select: { attempts: true } },
    },
  });
  if (!exam) return fail("Exam not found.");
  if (exam._count.attempts > 0) {
    return fail("Students have already attempted this exam — the paper is locked.");
  }

  // Map subject names from the document onto this exam's subjects.
  const subjectByName = new Map(
    exam.examSubjects.map((es) => [es.subject.name.toLowerCase(), es.subject.id]),
  );

  const unknown = [
    ...new Set(
      data.questions
        .map((q) => q.subjectName)
        .filter((name) => !subjectByName.has(name.toLowerCase())),
    ),
  ];
  if (unknown.length > 0) {
    return fail(
      `These subjects are not part of this exam: ${unknown.join(", ")}. ` +
        `Fix the [SUBJECT: …] headings, or add the subject to the exam.`,
    );
  }

  // Duplicate (subject, number) pairs would violate the unique index — catch it
  // here so the admin gets a readable message instead of a database error.
  const seen = new Set<string>();
  for (const q of data.questions) {
    const key = `${q.subjectName.toLowerCase()}#${q.number}`;
    if (seen.has(key)) {
      return fail(`${q.subjectName} question ${q.number} appears twice.`);
    }
    seen.add(key);
  }

  await prisma.$transaction(async (tx) => {
    // A re-upload replaces the paper entirely.
    await tx.question.deleteMany({ where: { examId: data.examId } });

    for (const q of data.questions) {
      const subjectId = subjectByName.get(q.subjectName.toLowerCase())!;
      await tx.question.create({
        data: {
          exam: { connect: { id: data.examId } },
          subject: { connect: { id: subjectId } },
          number: q.number,
          text: q.text,
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
          correctOption: q.correctOption,
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          images: {
            create: q.images.map((image, order) => ({
              path: image.path,
              target: image.target,
              order,
            })),
          },
        },
      });
    }

    await tx.exam.update({
      where: { id: data.examId },
      data: {
        status: data.publish ? "PUBLISHED" : "DRAFT",
      },
    });
  });

  revalidatePath("/admin/exams");
  revalidatePath(`/admin/exams/${data.examId}`);
  revalidatePath("/admin/papers");
  revalidatePath(`/admin/papers/${data.examId}`);

  return ok(
    data.publish
      ? `Paper saved and published — ${data.questions.length} questions are now live for this batch.`
      : `Paper saved as a draft with ${data.questions.length} questions.`,
    { examId: data.examId },
  );
}

// ---------------------------------------------------------------- remove

export async function deletePaper(examId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: { _count: { select: { attempts: true } } },
  });
  if (!exam) return fail("Exam not found.");
  if (exam._count.attempts > 0) {
    return fail("Students have already attempted this exam — the paper cannot be removed.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.question.deleteMany({ where: { examId } });
    await tx.exam.update({
      where: { id: examId },
      data: { status: "DRAFT", questionPaperFile: null, answerKeyFile: null },
    });
  });
  await clearExamUploads(examId);

  revalidatePath("/admin/exams");
  revalidatePath(`/admin/exams/${examId}`);
  revalidatePath("/admin/papers");
  revalidatePath(`/admin/papers/${examId}`);
  return ok("Question paper removed. The exam is back to draft.");
}

// ---------------------------------------------------------------- reuse

/**
 * Same paper, another batch. Everything that defines the paper — questions,
 * images, marking — is copied onto a brand new exam so the two runs can drift
 * apart afterwards without either affecting the other.
 */
const reuseSchema = z
  .object({
    sourceExamId: z.string().min(1),
    // Deliberately the same rules and wording as createExam: an admin sees one
    // set of messages whether they build an exam or clone one.
    name: z.string().trim().min(3, "Give the exam a name").max(120),
    batchId: z.string().min(1, "Choose a batch"),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(1, "Duration must be at least a minute").max(600),
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

    const windowMinutes = (end.getTime() - start.getTime()) / 60_000;
    if (data.durationMinutes > windowMinutes) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMinutes"],
        message: `The window is only ${Math.floor(windowMinutes)} minutes long.`,
      });
    }
  });

export async function reusePaperForBatch(
  _prev: ActionResult<{ examId: string }>,
  formData: FormData,
): Promise<ActionResult<{ examId: string }>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = reuseSchema.safeParse({
    sourceExamId: formData.get("sourceExamId"),
    name: formData.get("name"),
    batchId: formData.get("batchId"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    durationMinutes: Number(formData.get("durationMinutes")),
  });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const source = await prisma.exam.findUnique({
    where: { id: input.sourceExamId },
    include: {
      examSubjects: { orderBy: { order: "asc" } },
      questions: {
        orderBy: [{ subjectId: "asc" }, { number: "asc" }],
        include: { images: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!source) return fail("Exam not found.");
  if (source.questions.length === 0) {
    return fail(
      "This exam has no question paper yet — upload one before reusing it for another batch.",
    );
  }

  const batch = await prisma.batch.findUnique({ where: { id: input.batchId } });
  if (!batch) return fail("That batch no longer exists.", { batchId: "Unknown batch" });

  const startsAt = new Date(input.startsAt);
  let newExamId = "";

  try {
    await prisma.$transaction(
      async (tx) => {
        const exam = await tx.exam.create({
          data: {
            name: input.name,
            batchId: input.batchId,
            examDate: new Date(
              Date.UTC(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate()),
            ),
            startsAt,
            endsAt: new Date(input.endsAt),
            durationMinutes: input.durationMinutes,
            marksPerCorrect: source.marksPerCorrect,
            negativeMarks: source.negativeMarks,
            resultVisibility: source.resultVisibility,
            // Always a draft: the admin reviews the new window before students see it.
            status: "DRAFT",
            examSubjects: {
              create: source.examSubjects.map((es) => ({
                subjectId: es.subjectId,
                questionCount: es.questionCount,
                order: es.order,
              })),
            },
          },
        });
        newExamId = exam.id;

        // The copy must own its image files. Sharing the originals would mean
        // replacing or deleting the source paper (which calls clearExamUploads
        // on the source exam's directory) silently blanking this exam's diagrams.
        const copiedPaths = new Map<string, string>();
        for (const question of source.questions) {
          for (const image of question.images) {
            if (copiedPaths.has(image.path)) continue;
            const copied = await copyExamImage(exam.id, image.path);
            if (copied) copiedPaths.set(image.path, copied);
          }
        }

        for (const question of source.questions) {
          await tx.question.create({
            data: {
              exam: { connect: { id: exam.id } },
              subject: { connect: { id: question.subjectId } },
              number: question.number,
              text: question.text,
              optionA: question.optionA,
              optionB: question.optionB,
              optionC: question.optionC,
              optionD: question.optionD,
              correctOption: question.correctOption,
              marks: question.marks,
              negativeMarks: question.negativeMarks,
              images: {
                create: question.images.flatMap((image, order) => {
                  const path = copiedPaths.get(image.path);
                  // An image whose file has vanished is dropped rather than
                  // recorded as a path that would 404 for every student.
                  return path ? [{ path, target: image.target, alt: image.alt, order }] : [];
                }),
              },
            },
          });
        }

        const [questionPaperFile, answerKeyFile] = await Promise.all([
          source.questionPaperFile
            ? copyExamDocument(exam.id, source.questionPaperFile)
            : null,
          source.answerKeyFile ? copyExamDocument(exam.id, source.answerKeyFile) : null,
        ]);
        if (questionPaperFile || answerKeyFile) {
          await tx.exam.update({
            where: { id: exam.id },
            data: { questionPaperFile, answerKeyFile },
          });
        }
      },
      // A few hundred question inserts plus the image copies comfortably exceed
      // Prisma's 5s default, exactly as the publish path found.
      { timeout: 120_000, maxWait: 15_000 },
    );
  } catch (error) {
    // Roll the files back too, or a failed clone leaves an orphan upload folder.
    if (newExamId) await clearExamUploads(newExamId).catch(() => {});
    return fail(
      `The paper could not be copied: ${(error as Error).message}`,
    );
  }

  revalidatePath("/admin/exams");
  revalidatePath("/admin/papers");
  revalidatePath(`/admin/papers/${input.sourceExamId}`);

  return ok(
    `"${input.name}" created as a draft for ${batch.name} with ${source.questions.length} questions copied across.`,
    { examId: newExamId },
  );
}
