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
  type SolvedQuestion,
  SolutionConfigError,
  publishBlockMessage,
  solutionsBlockingPublish,
  solveBatch,
} from "@/lib/solutions";
import {
  type TranslatedQuestion,
  TranslationConfigError,
  translateBatch,
} from "@/lib/translate";
import {
  clearExamUploads,
  copyExamDocument,
  copyExamImage,
  saveExamDocument,
} from "@/lib/uploads";

export type { SolvedQuestion, TranslatedQuestion };

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
  images: {
    path: string;
    target: "STEM" | "A" | "B" | "C" | "D";
    /** Size the document lays the image out at, in CSS pixels; 0 when unknown. */
    width: number;
    height: number;
  }[];
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

// ---------------------------------------------------------------- translate

/**
 * One batch of a Tamil paper, not the whole thing.
 *
 * A paper runs to 180 questions; one request for all of them is a single point
 * of failure minutes long, and one request per question pays the model's
 * per-call overhead 180 times. The client walks the paper in small batches so
 * it can show progress, and so a batch that fails costs only that batch — the
 * questions already translated stay translated and only the rest are retried.
 */
const translateSchema = z.object({
  examId: z.string().min(1),
  questions: z
    .array(
      z.object({
        index: z.number().int().min(0),
        subjectName: z.string(),
        text: z.string(),
        optionA: z.string(),
        optionB: z.string(),
        optionC: z.string(),
        optionD: z.string(),
      }),
    )
    .min(1, "There is nothing to translate.")
    .max(25, "Translate in smaller batches — 25 questions at a time at most."),
});

export async function translateQuestions(
  input: z.input<typeof translateSchema>,
): Promise<ActionResult<{ translations: TranslatedQuestion[] }>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = translateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That batch could not be translated.");
  }

  try {
    const translations = await translateBatch(parsed.data.questions);
    return ok(`${translations.length} question(s) translated.`, { translations });
  } catch (error) {
    // A missing key is a setup problem, not a failure of this paper: say so in
    // the module's own words rather than dressing it up as a translation error.
    if (error instanceof TranslationConfigError) return fail(error.message);
    return fail(
      `That batch could not be translated: ${(error as Error).message} ` +
        `The questions already translated have been kept — retry the rest.`,
    );
  }
}

// ---------------------------------------------------------------- solve

/**
 * One batch of worked solutions, not the whole paper.
 *
 * Batched for the same reasons translation is, only more so: solving runs Opus
 * at high effort, so a batch is minutes rather than seconds and a 180-question
 * paper in one request would be a single point of failure the admin watches for
 * half an hour. Batches are smaller than the translation ones because each
 * question costs far more thinking, and because a failure should throw away as
 * little of that as possible — everything already solved is kept client-side
 * and only the rest is retried.
 *
 * The answer key never leaves the server on this path. The client sends the
 * question and its options; the value of the check is that the model reaches an
 * answer without having seen the one the admin uploaded.
 */
const solveSchema = z.object({
  examId: z.string().min(1),
  questions: z
    .array(
      z.object({
        index: z.number().int().min(0),
        subjectName: z.string(),
        text: z.string(),
        optionA: z.string(),
        optionB: z.string(),
        optionC: z.string(),
        optionD: z.string(),
        /** Lets the model say "I cannot see this diagram" instead of guessing. */
        hasImages: z.boolean(),
      }),
    )
    .min(1, "There is nothing to solve.")
    .max(8, "Solve in smaller batches — 8 questions at a time at most."),
});

export async function solveQuestions(
  input: z.input<typeof solveSchema>,
): Promise<ActionResult<{ solutions: SolvedQuestion[] }>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = solveSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That batch could not be solved.");
  }

  // The language of the solution is the exam's, not the client's — same rule as
  // publishPaper. A Tamil paper's students read Tamil solutions.
  const exam = await prisma.exam.findUnique({
    where: { id: parsed.data.examId },
    select: { medium: true },
  });
  if (!exam) return fail("Exam not found.");

  try {
    const solutions = await solveBatch(parsed.data.questions, exam.medium);
    return ok(`${solutions.length} question(s) worked out.`, { solutions });
  } catch (error) {
    // A missing key is a setup problem, not a failure of this paper: say so in
    // the module's own words rather than dressing it up as a solving error.
    if (error instanceof SolutionConfigError) return fail(error.message);
    return fail(
      `That batch could not be solved: ${(error as Error).message} ` +
        `The questions already solved have been kept — retry the rest.`,
    );
  }
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
        // On a Tamil paper the four above carry the Tamil the students sit and
        // these carry the English it came from. Optional, because an English
        // paper never has them.
        sourceText: z.string().nullish(),
        sourceOptionA: z.string().nullish(),
        sourceOptionB: z.string().nullish(),
        sourceOptionC: z.string().nullish(),
        sourceOptionD: z.string().nullish(),
        correctOption: z.enum(["A", "B", "C", "D"]),
        // The worked solution and the answer that working arrived at. Optional
        // here because a draft may be saved before the paper has been solved —
        // only publishing needs them, and only complete.
        solution: z.string().nullish(),
        solvedOption: z.enum(["A", "B", "C", "D"]).nullish(),
        marks: z.number().nullable(),
        negativeMarks: z.number().nullable(),
        images: z.array(
          z.object({
            path: z.string(),
            target: z.enum(["STEM", "A", "B", "C", "D"]),
            // Papers previewed before sizes were carried through have neither.
            width: z.number().nullish(),
            height: z.number().nullish(),
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

  // The medium is the exam's, not the client's: a Tamil paper may not be saved
  // with the English still in the columns the students read.
  const isTamil = exam.medium === "TAMIL";
  if (isTamil) {
    const untranslated = data.questions.filter(
      (q) =>
        q.sourceText == null &&
        q.sourceOptionA == null &&
        q.sourceOptionB == null &&
        q.sourceOptionC == null &&
        q.sourceOptionD == null,
    );
    if (untranslated.length > 0) {
      return fail(
        `${untranslated.length} question(s) have not been translated yet. ` +
          `Translate the whole paper and review the Tamil before saving it.`,
      );
    }
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

  // Publishing needs every question solved and every solution agreeing with the
  // key; saving a draft needs neither, so an admin can upload today and solve
  // tomorrow. The same pure rule runs in publishExam — a paper can be published
  // from three screens and the answer has to be the same from all of them.
  if (data.publish) {
    const block = solutionsBlockingPublish(
      data.questions.map((q) => ({
        number: q.number,
        solution: q.solution?.trim() ? q.solution : null,
        solvedOption: q.solvedOption ?? null,
        correctOption: q.correctOption,
      })),
    );
    if (block) return fail(publishBlockMessage(block));
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
          sourceText: isTamil ? (q.sourceText ?? null) : null,
          sourceOptionA: isTamil ? (q.sourceOptionA ?? null) : null,
          sourceOptionB: isTamil ? (q.sourceOptionB ?? null) : null,
          sourceOptionC: isTamil ? (q.sourceOptionC ?? null) : null,
          sourceOptionD: isTamil ? (q.sourceOptionD ?? null) : null,
          correctOption: q.correctOption,
          solution: q.solution?.trim() ? q.solution : null,
          solvedOption: q.solvedOption ?? null,
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          images: {
            create: q.images.map((image, order) => ({
              path: image.path,
              target: image.target,
              // 0 means the document never said; store null so the renderer
              // falls back rather than laying the image out at nothing.
              width: image.width || null,
              height: image.height || null,
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
            // The copy is the same paper, so it is sat in the same language —
            // the questions carried over below are already translated.
            medium: source.medium,
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
              sourceText: question.sourceText,
              sourceOptionA: question.sourceOptionA,
              sourceOptionB: question.sourceOptionB,
              sourceOptionC: question.sourceOptionC,
              sourceOptionD: question.sourceOptionD,
              correctOption: question.correctOption,
              // The solutions travel with the copy. Without them the clone
              // could not be published until the whole paper was solved a
              // second time, which is a baffling way for a reuse to fail.
              solution: question.solution,
              solvedOption: question.solvedOption,
              marks: question.marks,
              negativeMarks: question.negativeMarks,
              images: {
                create: question.images.flatMap((image, order) => {
                  const path = copiedPaths.get(image.path);
                  // An image whose file has vanished is dropped rather than
                  // recorded as a path that would 404 for every student.
                  // The size travels with the copy: without it a reused paper's
                  // equations go back to filling their options.
                  return path
                    ? [{
                        path,
                        target: image.target,
                        alt: image.alt,
                        width: image.width,
                        height: image.height,
                        order,
                      }]
                    : [];
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

const settleSchema = z.object({
  questionId: z.string().min(1),
  correctOption: z.enum(["A", "B", "C", "D"]),
  solvedOption: z.enum(["A", "B", "C", "D"]),
  solution: z.string().trim().min(1, "A solution is needed before publishing."),
});

/**
 * Settles a question whose answer key and worked solution disagree.
 *
 * Without this the gate is a wall rather than a check: publishing is refused,
 * and nothing anywhere lets an admin change the key or the working of a paper
 * that is already saved. The only exit was deleting the paper and starting over.
 *
 * Both directions are offered on purpose. The key is wrong often enough — the
 * disagreement that prompted this was a key of A against a correctly worked D —
 * but the model is wrong sometimes too, and an admin who knows the key is right
 * has to be able to rewrite the working instead. What is deliberately not
 * offered is dismissing the disagreement without resolving it.
 */
export async function settleQuestion(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = settleSchema.safeParse({
    questionId: formData.get("questionId"),
    correctOption: formData.get("correctOption"),
    solvedOption: formData.get("solvedOption"),
    solution: formData.get("solution"),
  });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const question = await prisma.question.findUnique({
    where: { id: input.questionId },
    select: {
      number: true,
      examId: true,
      exam: { select: { _count: { select: { attempts: true } } } },
    },
  });
  if (!question) return fail("Question not found.");

  // The same rule the rest of the paper follows: once anyone has sat it, the
  // marking cannot move underneath the results already recorded.
  if (question.exam._count.attempts > 0) {
    return fail(
      "Students have already attempted this exam, so its answers can no longer be changed.",
    );
  }

  if (input.correctOption !== input.solvedOption) {
    return fail(
      `The key and the working still disagree on question ${question.number}. ` +
        `Set both to the answer you have settled on.`,
    );
  }

  await prisma.question.update({
    where: { id: input.questionId },
    data: {
      correctOption: input.correctOption,
      solvedOption: input.solvedOption,
      solution: input.solution,
    },
  });

  revalidatePath(`/admin/papers/${question.examId}`);
  revalidatePath(`/admin/exams/${question.examId}`);
  return ok(`Question ${question.number} settled.`);
}

const solveSavedSchema = z.object({
  examId: z.string().min(1),
  questionIds: z.array(z.string().min(1)).min(1).max(8),
});

/**
 * Works out solutions for questions of a paper that is already saved.
 *
 * The upload screen can solve a paper on its way in, but a draft saved without
 * solutions could never acquire them: that screen operates on a parsed document
 * that no longer exists once the paper is stored, and nothing else offered to
 * solve anything. Publishing then refused the draft forever for want of the very
 * thing there was no way to produce.
 *
 * Same independence as the upload path — the questions go to the model without
 * their answer key, so the answer that comes back is still a real second opinion
 * and can still disagree.
 */
export async function solveSavedQuestions(
  input: z.input<typeof solveSavedSchema>,
): Promise<ActionResult<{ solved: number }>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = solveSavedSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That batch could not be solved.");
  }

  const exam = await prisma.exam.findUnique({
    where: { id: parsed.data.examId },
    select: { medium: true, _count: { select: { attempts: true } } },
  });
  if (!exam) return fail("Exam not found.");
  if (exam._count.attempts > 0) {
    return fail(
      "Students have already attempted this exam, so its answers can no longer be changed.",
    );
  }

  const questions = await prisma.question.findMany({
    where: { id: { in: parsed.data.questionIds }, examId: parsed.data.examId },
    orderBy: [{ subject: { order: "asc" } }, { number: "asc" }],
    select: {
      id: true,
      text: true,
      optionA: true,
      optionB: true,
      optionC: true,
      optionD: true,
      subject: { select: { name: true } },
      _count: { select: { images: true } },
    },
  });
  if (questions.length === 0) return fail("Those questions are no longer on file.");

  try {
    // The model echoes an index back, so position in this array is the link to
    // the row it belongs to. Never the question number: two subjects both start
    // at 1, and the answers would land on each other.
    const solutions = await solveBatch(
      questions.map((q, index) => ({
        index,
        subjectName: q.subject.name,
        text: q.text,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        hasImages: q._count.images > 0,
      })),
      exam.medium,
    );

    await prisma.$transaction(
      solutions
        .filter((s) => questions[s.index])
        .map((s) =>
          prisma.question.update({
            where: { id: questions[s.index].id },
            data: {
              solution: s.solution,
              // An answer the model itself is not confident in must not be
              // stored as one. It would be counted as an independent second
              // opinion it is not — the usual cause is an equation living in an
              // image it cannot see, where the "answer" is an admitted guess —
              // and worse, a solution reading "the equation is not available"
              // would be shown to the batch after the window closed. Keeping
              // the note without an option leaves the question unsolved, which
              // is the truth, and says why.
              solvedOption: s.confident ? s.answer : null,
            },
          }),
        ),
    );

    revalidatePath(`/admin/papers/${parsed.data.examId}`);
    revalidatePath(`/admin/exams/${parsed.data.examId}`);

    const answered = solutions.filter((s) => s.confident).length;
    const stuck = solutions.length - answered;
    return ok(
      stuck === 0
        ? `${answered} question(s) worked out.`
        : `${answered} worked out. ${stuck} could not be — read the note on each ` +
          `and write those yourself.`,
      { solved: answered },
    );
  } catch (error) {
    if (error instanceof SolutionConfigError) return fail(error.message);
    return fail(
      `That batch could not be solved: ${(error as Error).message} ` +
        `Anything already worked out has been kept — retry the rest.`,
    );
  }
}

const editSchema = z.object({
  questionId: z.string().min(1),
  text: z.string().trim(),
  optionA: z.string().trim(),
  optionB: z.string().trim(),
  optionC: z.string().trim(),
  optionD: z.string().trim(),
  correctOption: z.enum(["A", "B", "C", "D"]),
  solution: z.string().trim(),
});

/**
 * Corrects a saved question in place — its wording, its options, its key.
 *
 * A parser reading someone else's Word document gets things slightly wrong: a
 * stray character, an option that ran onto the wrong line, a key mistyped in the
 * spreadsheet. Until now the only remedy was replacing the entire paper, which
 * throws away every other question's worked solution to fix a typo in one.
 *
 * Editing the wording invalidates the working, which was written about the old
 * wording — so when the text or the options change, `solvedOption` is cleared
 * and the question falls back to unsolved. That reopens the publish gate on
 * purpose: a solution that agreed with the key before the question was reworded
 * is not evidence about the question as it now reads.
 */
export async function editQuestion(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = editSchema.safeParse({
    questionId: formData.get("questionId"),
    text: formData.get("text"),
    optionA: formData.get("optionA"),
    optionB: formData.get("optionB"),
    optionC: formData.get("optionC"),
    optionD: formData.get("optionD"),
    correctOption: formData.get("correctOption"),
    solution: formData.get("solution") ?? "",
  });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const question = await prisma.question.findUnique({
    where: { id: input.questionId },
    select: {
      number: true,
      examId: true,
      text: true,
      optionA: true,
      optionB: true,
      optionC: true,
      optionD: true,
      solvedOption: true,
      images: { select: { target: true } },
      exam: { select: { _count: { select: { attempts: true } } } },
    },
  });
  if (!question) return fail("Question not found.");

  if (question.exam._count.attempts > 0) {
    return fail(
      "Students have already attempted this exam, so its questions can no longer be changed.",
    );
  }

  // An option may be empty only when it carries a diagram instead — a
  // graph-choice question has four pictures and no words.
  const missing = (["A", "B", "C", "D"] as const).filter(
    (key) =>
      !input[`option${key}` as const] &&
      !question.images.some((i) => i.target === key),
  );
  if (missing.length > 0) {
    return fail(
      `Option ${missing.join(", ")} would be left empty, and ${
        missing.length > 1 ? "none of them carry" : "it does not carry"
      } an image instead.`,
    );
  }
  if (!input.text && !question.images.some((i) => i.target === "STEM")) {
    return fail("The question would be left with neither text nor a diagram.", {
      text: "Write the question, or keep its diagram.",
    });
  }

  const reworded =
    input.text !== question.text ||
    input.optionA !== question.optionA ||
    input.optionB !== question.optionB ||
    input.optionC !== question.optionC ||
    input.optionD !== question.optionD;

  await prisma.question.update({
    where: { id: input.questionId },
    data: {
      text: input.text,
      optionA: input.optionA,
      optionB: input.optionB,
      optionC: input.optionC,
      optionD: input.optionD,
      correctOption: input.correctOption,
      solution: input.solution || null,
      // The working was written about the wording that has just changed, so it
      // is no longer a second opinion on this question. Publishing asks for it
      // again rather than trusting the old agreement.
      solvedOption: reworded ? null : question.solvedOption,
    },
  });

  revalidatePath(`/admin/papers/${question.examId}`);
  revalidatePath(`/admin/exams/${question.examId}`);
  return ok(
    reworded
      ? `Question ${question.number} updated. Its worked solution needs checking again.`
      : `Question ${question.number} updated.`,
  );
}
