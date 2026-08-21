import "server-only";
import { sweepExamAttempts } from "@/lib/attempts";
import { prisma } from "@/lib/db";
import { rankScores } from "@/lib/grading";
import type { ExportColumn, ExportRow } from "@/lib/xlsx";

/**
 * One exam's marks in export shape — deliberately the same columns and ordering
 * as /api/admin/exams/[id]/results-export, so a class report and a single-exam
 * download can be read side by side without re-learning the sheet.
 */
export type ExamSheetData = {
  examName: string;
  batchName: string;
  examDate: Date;
  maxScore: number;
  /** Students who sat the exam. */
  attemptCount: number;
  /** Students of the class who never started it — one row each, marked Absent. */
  absentCount: number;
  averageScore: number;
  highestScore: number;
  columns: ExportColumn[];
  rows: ExportRow[];
};

/** Subject names become column keys, so they must be safe identifiers. */
function subjectKey(name: string): string {
  return `subject_${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export async function buildExamSheetData(
  examId: string,
): Promise<ExamSheetData | null> {
  // Marks must be settled before they are reported: an attempt whose timer ran
  // out while nobody was looking is still IN_PROGRESS until it is swept.
  await sweepExamAttempts(examId);

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      batch: { select: { id: true, name: true } },
      examSubjects: {
        include: { subject: { select: { id: true, name: true } } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!exam) return null;

  const [attempts, questions, classmates] = await Promise.all([
    prisma.attempt.findMany({
      where: { examId },
      include: {
        student: {
          select: {
            name: true,
            schoolName: true,
            phone: true,
            email: true,
            user: { select: { username: true } },
          },
        },
        answers: { select: { questionId: true, scoreAwarded: true } },
      },
    }),
    prisma.question.findMany({
      where: { examId },
      select: { id: true, subjectId: true, marks: true },
    }),
    // The whole class, so the report answers "who did not sit this?" as well as
    // "how did the others do?".
    prisma.student.findMany({
      where: { batchId: exam.batchId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        schoolName: true,
        phone: true,
        email: true,
        user: { select: { username: true } },
      },
    }),
  ]);

  const maxScore = questions.reduce(
    (sum, q) => sum + (q.marks ?? exam.marksPerCorrect),
    0,
  );

  const attemptRows = attempts.map((attempt) => {
    const scoreByQuestion = new Map(
      attempt.answers.map((a) => [a.questionId, a.scoreAwarded ?? 0]),
    );
    const subjectScores: Record<string, number> = {};
    for (const es of exam.examSubjects) {
      const pool = questions.filter((q) => q.subjectId === es.subjectId);
      subjectScores[subjectKey(es.subject.name)] =
        Math.round(
          pool.reduce((sum, q) => sum + (scoreByQuestion.get(q.id) ?? 0), 0) * 100,
        ) / 100;
    }

    return {
      name: attempt.student.name,
      username: attempt.student.user.username,
      school: attempt.student.schoolName ?? "",
      phone: attempt.student.phone ?? "",
      email: attempt.student.email ?? "",
      totalScore: attempt.totalScore,
      correct: attempt.correctCount ?? 0,
      wrong: attempt.wrongCount ?? 0,
      unanswered: attempt.unansweredCount ?? 0,
      status:
        attempt.status === "EXPIRED"
          ? "Time expired"
          : attempt.status === "IN_PROGRESS"
            ? "In progress"
            : "Submitted",
      submittedAt: attempt.submittedAt
        ? new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(attempt.submittedAt)
        : "",
      tabSwitches: attempt.tabSwitchCount,
      ...subjectScores,
    };
  });

  const ranked = rankScores(attemptRows);

  // Absentees are listed too, but they are not ranked: a student who never sat
  // the exam has not come last, and giving them a rank would push everyone who
  // did sit it down the order.
  const attempted = new Set(attempts.map((attempt) => attempt.studentId));
  const absentRows: ExportRow[] = classmates
    .filter((student) => !attempted.has(student.id))
    .map((student) => ({
      rank: "",
      name: student.name,
      username: student.user.username,
      school: student.schoolName ?? "",
      phone: student.phone ?? "",
      email: student.email ?? "",
      totalScore: null,
      correct: "",
      wrong: "",
      unanswered: "",
      status: "Absent",
      submittedAt: "",
      tabSwitches: "",
    }));

  const columns: ExportColumn[] = [
    { header: "Rank", key: "rank", width: 8 },
    { header: "Student", key: "name", width: 26 },
    { header: "Username", key: "username", width: 18 },
    { header: "School", key: "school", width: 28 },
    ...exam.examSubjects.map((es) => ({
      header: es.subject.name,
      key: subjectKey(es.subject.name),
      width: 14,
    })),
    { header: `Total (out of ${maxScore})`, key: "totalScore", width: 18 },
    { header: "Correct", key: "correct", width: 10 },
    { header: "Wrong", key: "wrong", width: 10 },
    { header: "Unanswered", key: "unanswered", width: 13 },
    { header: "Status", key: "status", width: 14 },
    { header: "Submitted at", key: "submittedAt", width: 20 },
    { header: "Left screen", key: "tabSwitches", width: 12 },
    { header: "Phone", key: "phone", width: 15 },
    { header: "Email", key: "email", width: 28 },
  ];

  const scores = ranked
    .map((r) => r.totalScore)
    .filter((s): s is number => s !== null);

  return {
    examName: exam.name,
    batchName: exam.batch.name,
    examDate: exam.examDate,
    maxScore,
    attemptCount: ranked.length,
    absentCount: absentRows.length,
    averageScore:
      scores.length > 0
        ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100
        : 0,
    highestScore: scores.length > 0 ? Math.max(...scores) : 0,
    columns,
    // Ranked first, then the absentees in name order underneath them.
    rows: [...(ranked as unknown as ExportRow[]), ...absentRows],
  };
}
