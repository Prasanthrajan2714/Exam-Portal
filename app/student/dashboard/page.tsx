import { EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { sweepIfExpired } from "@/lib/attempts";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canShowResult, examCardSection, examCardStatus } from "@/lib/exam-window";
import { formatDate, formatTime } from "@/lib/utils";
import { ExamCard, type ExamCardData } from "./exam-card";

export const metadata = { title: "My exams · FirstBench" };

// Timing decisions depend on "now", so this page must never be cached.
export const dynamic = "force-dynamic";

export default async function StudentDashboard() {
  const { student } = await requireStudent();

  const exams = await prisma.exam.findMany({
    where: { batchId: student.batchId, status: "PUBLISHED" },
    orderBy: [{ startsAt: "desc" }],
    include: {
      examSubjects: {
        include: { subject: { select: { name: true } } },
        orderBy: { order: "asc" },
      },
      _count: { select: { questions: true } },
      attempts: {
        where: { studentId: student.id },
        include: {
          reopenRequests: {
            where: { status: "PENDING" },
            select: { id: true },
          },
        },
      },
    },
  });

  // Close out anything whose clock ran down while the student was away, so the
  // dashboard never shows a live timer for an exam that is really over.
  for (const exam of exams) {
    const attempt = exam.attempts[0];
    if (attempt) await sweepIfExpired(attempt);
  }

  // Re-read the attempts that the sweep may have changed.
  const attempts = await prisma.attempt.findMany({
    where: { studentId: student.id, examId: { in: exams.map((e) => e.id) } },
    include: { reopenRequests: { where: { status: "PENDING" }, select: { id: true } } },
  });
  const attemptByExam = new Map(attempts.map((a) => [a.examId, a]));

  const now = new Date();

  const cards: ExamCardData[] = exams.map((exam) => {
    const attempt = attemptByExam.get(exam.id) ?? null;
    const status = examCardStatus(
      exam,
      attempt
        ? {
            status: attempt.status,
            deadlineAt: attempt.deadlineAt,
            sessionClaimedAt: attempt.sessionClaimedAt,
          }
        : null,
      (attempt?.reopenRequests.length ?? 0) > 0,
      now,
    );

    return {
      examId: exam.id,
      attemptId: attempt?.id ?? null,
      name: exam.name,
      subjects: exam.examSubjects.map((s) => s.subject.name),
      questionCount: exam._count.questions,
      durationMinutes: exam.durationMinutes,
      marksPerCorrect: exam.marksPerCorrect,
      negativeMarks: exam.negativeMarks,
      dateLabel: formatDate(exam.startsAt),
      windowLabel: `${formatTime(exam.startsAt)} – ${formatTime(exam.endsAt)}`,
      status,
      resultAvailable: canShowResult(exam, now),
      totalScore: attempt?.totalScore ?? null,
      maxScore: exam._count.questions * exam.marksPerCorrect,
    };
  });

  // Sectioning lives in examCardSection, which switches over the whole union:
  // listing the statuses inline here is how NEEDS_REOPEN came to belong to no
  // section at all, dropping interrupted exams off the page entirely.
  const live = cards.filter((c) => examCardSection(c.status) === "LIVE");
  const upcoming = cards.filter((c) => examCardSection(c.status) === "UPCOMING");
  const past = cards.filter((c) => examCardSection(c.status) === "PAST");

  const completed = past.filter((c) => c.status === "COMPLETED");

  return (
    <>
      <PageHeader
        title={`Welcome, ${student.name.split(" ")[0]}`}
        description={`Exams for ${student.batch.name}.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Available now"
          value={live.filter((c) => c.status === "AVAILABLE").length}
          tone="success"
        />
        <Stat label="Scheduled" value={upcoming.length} />
        <Stat label="Completed" value={completed.length} />
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title="No exams yet"
          description={`Nothing has been scheduled for ${student.batch.name}. This page will update as soon as your administrator publishes an exam.`}
        />
      ) : (
        <div className="space-y-8">
          <Section title="Available and in progress" cards={live} />
          <Section title="Scheduled" cards={upcoming} />
          <Section title="Past exams" cards={past} />
        </div>
      )}
    </>
  );
}

function Section({ title, cards }: { title: string; cards: ExamCardData[] }) {
  if (cards.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-3">
        {cards.map((exam) => (
          <ExamCard key={exam.examId} exam={exam} />
        ))}
      </div>
    </section>
  );
}
