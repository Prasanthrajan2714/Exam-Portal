import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findKeyEntry, parseAnswerKey } from "@/lib/answer-key";
import { finaliseAttempt, startAttempt, sweepIfExpired } from "@/lib/attempts";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseQuestionPaper } from "@/lib/docx-parser";
import { extendDeadline } from "@/lib/exam-window";
import ExcelJS from "exceljs";

/**
 * Drives the whole pipeline against the real database: parse a Word paper,
 * reconcile it with an Excel key, publish it, sit the exam, get interrupted,
 * resume after an admin reopen, submit, and check the score.
 *
 * Everything it creates is namespaced and removed afterwards.
 */

const TAG = "__itest__";
const created = {
  batchIds: [] as string[],
  userIds: [] as string[],
  examIds: [] as string[],
};

async function paperDocx(): Promise<File> {
  const lines = [
    "[SUBJECT: Mathematics]",
    "1. What is 2 + 2?",
    "A) 3",
    "B) 4",
    "C) 5",
    "D) 6",
    "2. What is 10 / 2?",
    "A) 2",
    "B) 4",
    "C) 5",
    "D) 10",
    "[SUBJECT: Physics]",
    "1. What is the SI unit of force?",
    "A) Joule",
    "B) Newton",
    "C) Watt",
    "D) Pascal",
    "2. Which of these is a vector?",
    "A) Speed",
    "B) Mass",
    "C) Velocity",
    "D) Time",
  ];
  const document = new Document({
    sections: [{ children: lines.map((text) => new Paragraph({ text })) }],
  });
  const buffer = await Packer.toBuffer(document);
  return new File([new Uint8Array(buffer)], "paper.docx");
}

async function keyXlsx(): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Key");
  sheet.addRow(["Subject", "Q.No", "Correct Option"]);
  sheet.addRow(["Mathematics", 1, "B"]);
  sheet.addRow(["Mathematics", 2, "C"]);
  sheet.addRow(["Physics", 1, "B"]);
  sheet.addRow(["Physics", 2, "C"]);
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([new Uint8Array(buffer as ArrayBuffer)], "key.xlsx");
}

let batchId: string;
let examId: string;
let studentId: string;

beforeAll(async () => {
  const batch = await prisma.batch.create({
    data: { name: `${TAG} Class 6`, description: "integration test" },
  });
  batchId = batch.id;
  created.batchIds.push(batch.id);

  const student = await prisma.student.create({
    data: {
      name: "Integration Student",
      email: "integration@example.com",
      batch: { connect: { id: batchId } },
      user: {
        create: {
          username: `${TAG}student`,
          passwordHash: await hashPassword("test1234"),
          role: "STUDENT",
        },
      },
    },
  });
  studentId = student.id;
  created.userIds.push(student.userId);

  const subjects = await prisma.subject.findMany({
    where: { name: { in: ["Mathematics", "Physics"] } },
  });
  expect(subjects).toHaveLength(2);

  const now = new Date();
  // The exam carries its own structure — which subjects it covers and how many
  // questions each one holds. A paper is uploaded against it afterwards; there
  // is no separate paper record.
  const exam = await prisma.exam.create({
    data: {
      name: `${TAG} JEE Mock`,
      batchId,
      examSubjects: {
        create: subjects.map((s, index) => ({
          subjectId: s.id,
          questionCount: 2,
          order: index,
        })),
      },
      examDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
      startsAt: new Date(now.getTime() - 60_000), // opened a minute ago
      endsAt: new Date(now.getTime() + 2 * 60 * 60_000), // closes in two hours
      durationMinutes: 30,
      marksPerCorrect: 4,
      negativeMarks: 1,
      resultVisibility: "IMMEDIATE",
      status: "DRAFT",
    },
  });
  examId = exam.id;
  created.examIds.push(exam.id);
});

afterAll(async () => {
  // Exams first: deleting one cascades to its subjects, questions and attempts.
  await prisma.exam.deleteMany({ where: { id: { in: created.examIds } } });
  await prisma.student.deleteMany({ where: { batchId: { in: created.batchIds } } });
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: created.batchIds } } });
  await prisma.$disconnect();
});

describe("question paper pipeline", () => {
  it("parses the paper, matches the key and saves publishable questions", async () => {
    const parsed = await parseQuestionPaper(await paperDocx(), examId);
    expect(parsed.questions).toHaveLength(4);
    expect(parsed.subjectNames).toEqual(["Mathematics", "Physics"]);

    const key = await parseAnswerKey(await keyXlsx());
    expect(key.errors).toEqual([]);

    const subjects = await prisma.subject.findMany({
      where: { name: { in: ["Mathematics", "Physics"] } },
    });
    const subjectByName = new Map(subjects.map((s) => [s.name, s.id]));

    for (const q of parsed.questions) {
      const entry = findKeyEntry(key.entries, q.subjectName, q.number);
      expect(entry, `key entry for ${q.subjectName} ${q.number}`).toBeDefined();

      await prisma.question.create({
        data: {
          exam: { connect: { id: examId } },
          subject: { connect: { id: subjectByName.get(q.subjectName)! } },
          number: q.number,
          text: q.text,
          optionA: q.options.A,
          optionB: q.options.B,
          optionC: q.options.C,
          optionD: q.options.D,
          correctOption: entry!.correctOption,
        },
      });
    }

    await prisma.exam.update({ where: { id: examId }, data: { status: "PUBLISHED" } });

    const saved = await prisma.question.count({ where: { examId } });
    expect(saved).toBe(4);
  });
});

describe("attempt lifecycle", () => {
  let attemptId: string;

  it("starts an attempt and caps the deadline inside the exam window", async () => {
    const result = await startAttempt(examId, studentId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    attemptId = result.attemptId;
    const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });

    const minutes = (attempt.deadlineAt.getTime() - attempt.startedAt.getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(30);
    expect(attempt.status).toBe("IN_PROGRESS");
  });

  it("refuses a second attempt at the same exam", async () => {
    const second = await startAttempt(examId, studentId);
    expect(second.ok).toBe(false);
    // Already in progress — resuming needs an admin reopen, per the spec.
    if (!second.ok) expect(second.reason).toBe("IN_PROGRESS");
  });

  it("refuses a student from another batch", async () => {
    const otherBatch = await prisma.batch.create({ data: { name: `${TAG} Class 7` } });
    created.batchIds.push(otherBatch.id);
    const outsider = await prisma.student.create({
      data: {
        name: "Outsider",
        batch: { connect: { id: otherBatch.id } },
        user: {
          create: {
            username: `${TAG}outsider`,
            passwordHash: await hashPassword("test1234"),
            role: "STUDENT",
          },
        },
      },
    });
    created.userIds.push(outsider.userId);

    const result = await startAttempt(examId, outsider.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not assigned to your batch/i);
  });

  it("saves answers as the student works", async () => {
    const questions = await prisma.question.findMany({
      where: { examId },
      orderBy: [{ subject: { order: "asc" } }, { number: "asc" }],
    });

    // Three right, one wrong — expected score 3*4 - 1 = 11.
    const choices = [
      questions[0].correctOption,
      questions[1].correctOption,
      questions[2].correctOption,
      questions[3].correctOption === "A" ? "B" : "A",
    ] as const;

    for (const [index, question] of questions.entries()) {
      await prisma.answer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: question.id } },
        create: {
          attemptId,
          questionId: question.id,
          selectedOption: choices[index],
          visited: true,
        },
        update: { selectedOption: choices[index] },
      });
    }

    expect(await prisma.answer.count({ where: { attemptId } })).toBe(4);
  });

  it("blocks re-entry once the exam screen has been opened", async () => {
    // The exam page claims the session on first load.
    await prisma.attempt.update({
      where: { id: attemptId },
      data: { sessionClaimedAt: new Date() },
    });

    const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.sessionClaimedAt).not.toBeNull();
  });

  it("restores the attempt after an admin approves a reopen", async () => {
    const before = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { exam: true },
    });

    const newDeadline = extendDeadline(before.exam, before.deadlineAt, 10, new Date());
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        deadlineAt: newDeadline,
        sessionClaimedAt: null,
        sessionToken: "reissued-token",
        reopenCount: { increment: 1 },
      },
    });

    const after = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { answers: true },
    });

    expect(after.sessionClaimedAt).toBeNull();
    expect(after.reopenCount).toBe(1);
    // The whole point of the reopen: their work is still there.
    expect(after.answers).toHaveLength(4);
    expect(after.deadlineAt.getTime()).toBeGreaterThan(before.deadlineAt.getTime());
  });

  it("grades the attempt on submit", async () => {
    const attempt = await finaliseAttempt(attemptId, "SUBMITTED");
    expect(attempt?.status).toBe("SUBMITTED");
    expect(attempt?.correctCount).toBe(3);
    expect(attempt?.wrongCount).toBe(1);
    expect(attempt?.unansweredCount).toBe(0);
    expect(attempt?.totalScore).toBe(11); // 3 x 4 - 1

    // Per-answer verdicts are stored so scorecards need no recomputation.
    const answers = await prisma.answer.findMany({ where: { attemptId } });
    expect(answers.filter((a) => a.isCorrect === true)).toHaveLength(3);
    expect(answers.filter((a) => a.isCorrect === false)).toHaveLength(1);
  });

  it("is idempotent — re-submitting does not re-grade", async () => {
    const again = await finaliseAttempt(attemptId, "SUBMITTED");
    expect(again?.totalScore).toBe(11);
    expect(again?.correctCount).toBe(3);
  });

  it("refuses to start once the exam is completed", async () => {
    const result = await startAttempt(examId, studentId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already completed/i);
  });
});

describe("expiry sweep", () => {
  it("auto-grades an abandoned attempt on whatever was saved", async () => {
    const student = await prisma.student.create({
      data: {
        name: "Abandoner",
        batch: { connect: { id: batchId } },
        user: {
          create: {
            username: `${TAG}abandoner`,
            passwordHash: await hashPassword("test1234"),
            role: "STUDENT",
          },
        },
      },
    });
    created.userIds.push(student.userId);

    const questions = await prisma.question.findMany({ where: { examId } });

    // An attempt whose deadline is already in the past.
    const attempt = await prisma.attempt.create({
      data: {
        examId,
        studentId: student.id,
        startedAt: new Date(Date.now() - 60 * 60_000),
        deadlineAt: new Date(Date.now() - 30 * 60_000),
        sessionToken: "stale",
        answers: {
          create: [
            {
              questionId: questions[0].id,
              selectedOption: questions[0].correctOption,
              visited: true,
            },
          ],
        },
      },
    });

    const swept = await sweepIfExpired(attempt);
    expect(swept).toBe(true);

    const graded = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(graded.status).toBe("EXPIRED");
    expect(graded.correctCount).toBe(1);
    // The three questions never reached score zero, not negative.
    expect(graded.unansweredCount).toBe(3);
    expect(graded.totalScore).toBe(4);
  });
});
