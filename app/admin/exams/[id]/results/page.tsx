import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { sweepExamAttempts } from "@/lib/attempts";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rankScores } from "@/lib/grading";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Results · Admin" };
export const dynamic = "force-dynamic";

export default async function ExamResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  // Grade anything whose timer expired while nobody was looking, so the numbers
  // on this page are final rather than "final except for three stragglers".
  await sweepExamAttempts(id);

  const exam = await prisma.exam.findUnique({
    where: { id },
    include: {
      batch: { select: { name: true, _count: { select: { students: true } } } },
      examSubjects: {
        include: { subject: { select: { id: true, name: true } } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!exam) notFound();

  const [attempts, questions] = await Promise.all([
    prisma.attempt.findMany({
      where: { examId: id },
      include: {
        student: { select: { id: true, name: true, schoolName: true } },
        answers: {
          select: { questionId: true, selectedOption: true, isCorrect: true, scoreAwarded: true },
        },
      },
    }),
    prisma.question.findMany({
      where: { examId: id },
      orderBy: [{ subject: { order: "asc" } }, { number: "asc" }],
      include: { subject: { select: { id: true, name: true } } },
    }),
  ]);

  if (attempts.length === 0) {
    return (
      <>
        <PageHeader
          title="Results"
          description={exam.name}
          actions={
            <Button asChild variant="ghost">
              <Link href={`/admin/exams/${id}`}>
                <ArrowLeft /> Back to exam
              </Link>
            </Button>
          }
        />
        <EmptyState
          title="Nobody has attempted this exam yet"
          description="Results appear here as soon as students start submitting."
        />
      </>
    );
  }

  const maxScore = questions.reduce((sum, q) => sum + (q.marks ?? exam.marksPerCorrect), 0);

  // ------------------------------------------------------------- per student
  const rows = attempts.map((attempt) => {
    const answerByQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const subjectScores: Record<string, number> = {};

    for (const es of exam.examSubjects) {
      const pool = questions.filter((q) => q.subjectId === es.subjectId);
      subjectScores[es.subject.name] = Math.round(
        pool.reduce((sum, q) => sum + (answerByQuestion.get(q.id)?.scoreAwarded ?? 0), 0) * 100,
      ) / 100;
    }

    return {
      studentId: attempt.student.id,
      name: attempt.student.name,
      school: attempt.student.schoolName ?? "",
      status: attempt.status,
      totalScore: attempt.totalScore,
      correct: attempt.correctCount ?? 0,
      wrong: attempt.wrongCount ?? 0,
      unanswered: attempt.unansweredCount ?? 0,
      submittedAt: attempt.submittedAt,
      tabSwitchCount: attempt.tabSwitchCount,
      subjectScores,
    };
  });

  const ranked = rankScores(rows);
  const graded = ranked.filter((r) => r.totalScore !== null);

  const average =
    graded.length > 0
      ? Math.round((graded.reduce((s, r) => s + (r.totalScore ?? 0), 0) / graded.length) * 100) / 100
      : 0;
  const highest = graded.length > 0 ? Math.max(...graded.map((r) => r.totalScore ?? 0)) : 0;

  // ------------------------------------------------------------- item analysis
  const analysis = questions.map((q) => {
    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    for (const attempt of attempts) {
      const answer = attempt.answers.find((a) => a.questionId === q.id);
      if (!answer?.selectedOption) skipped++;
      else if (answer.isCorrect) correct++;
      else wrong++;
    }
    const attempted = correct + wrong;
    return {
      id: q.id,
      subject: q.subject.name,
      number: q.number,
      text: q.text,
      correctOption: q.correctOption,
      correct,
      wrong,
      skipped,
      // Percentage of those who actually answered — a question everybody skipped
      // is a different problem from one everybody got wrong.
      successRate: attempted > 0 ? Math.round((correct / attempts.length) * 100) : 0,
    };
  });

  const hardest = [...analysis].sort((a, b) => a.successRate - b.successRate).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Results"
        description={`${exam.name} · ${exam.batch.name}`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button asChild variant="ghost">
              <Link href={`/admin/exams/${id}`}>
                <ArrowLeft /> Back to exam
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <a href={`/api/admin/exams/${id}/results-export`}>
                <Download /> Export to Excel
              </a>
            </Button>
            <PrintButton />
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Attempted"
          value={`${attempts.length} / ${exam.batch._count.students}`}
          hint="of the batch"
        />
        <Stat label="Highest" value={`${highest} / ${maxScore}`} tone="success" />
        <Stat label="Average" value={`${average} / ${maxScore}`} />
        <Stat
          label="Auto-submitted"
          value={rows.filter((r) => r.status === "EXPIRED").length}
          hint="ran out of time"
          tone={rows.some((r) => r.status === "EXPIRED") ? "danger" : undefined}
        />
      </div>

      {/* --------------------------------------------------------- leaderboard */}
      <Card className="print-plain mb-6">
        <CardHeader>
          <CardTitle>Scorecard and rank</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Rank</Th>
              <Th>Student</Th>
              {exam.examSubjects.map((es) => (
                <Th key={es.id}>{es.subject.name}</Th>
              ))}
              <Th>Total</Th>
              <Th>Right / Wrong / Skipped</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <tr key={row.studentId}>
                <Td>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      row.rank === 1 && "text-success",
                    )}
                  >
                    {row.rank}
                  </span>
                </Td>
                <Td>
                  <p className="font-medium">{row.name}</p>
                  {row.school && (
                    <p className="text-xs text-muted-foreground">{row.school}</p>
                  )}
                </Td>
                {exam.examSubjects.map((es) => (
                  <Td key={es.id} className="tabular-nums text-muted-foreground">
                    {row.subjectScores[es.subject.name] ?? 0}
                  </Td>
                ))}
                <Td className="font-semibold tabular-nums">
                  {row.totalScore ?? "—"} / {maxScore}
                </Td>
                <Td className="tabular-nums text-xs">
                  <span className="text-success">{row.correct}</span>
                  {" / "}
                  <span className="text-danger">{row.wrong}</span>
                  {" / "}
                  <span className="text-muted-foreground">{row.unanswered}</span>
                </Td>
                <Td>
                  {row.status === "EXPIRED" ? (
                    <Badge tone="warning">Time expired</Badge>
                  ) : row.status === "IN_PROGRESS" ? (
                    <Badge tone="info">In progress</Badge>
                  ) : (
                    <Badge tone="success">Submitted</Badge>
                  )}
                  {row.tabSwitchCount > 0 && (
                    <p className="mt-1 text-xs text-warning">
                      left screen {row.tabSwitchCount}×
                    </p>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* ------------------------------------------------------ item analysis */}
      {hardest.length > 0 && hardest[0].successRate < 100 && (
        <Alert tone="info" className="mb-4" title="Questions worth a second look">
          These had the lowest success rate across the batch — often a sign the
          question was ambiguous or the answer key is wrong.
        </Alert>
      )}

      <Card className="print-plain">
        <CardHeader>
          <CardTitle>Question-wise analysis</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Subject</Th>
              <Th>No.</Th>
              <Th>Question</Th>
              <Th>Key</Th>
              <Th>Correct</Th>
              <Th>Wrong</Th>
              <Th>Skipped</Th>
              <Th>Success</Th>
            </tr>
          </thead>
          <tbody>
            {analysis.map((q) => (
              <tr key={q.id}>
                <Td className="text-muted-foreground">{q.subject}</Td>
                <Td className="tabular-nums">{q.number}</Td>
                <Td>
                  <span className="line-clamp-1 max-w-md text-xs">{q.text}</span>
                </Td>
                <Td>
                  <Badge tone="neutral">{q.correctOption}</Badge>
                </Td>
                <Td className="tabular-nums text-success">{q.correct}</Td>
                <Td className="tabular-nums text-danger">{q.wrong}</Td>
                <Td className="tabular-nums text-muted-foreground">{q.skipped}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          q.successRate >= 60
                            ? "bg-success"
                            : q.successRate >= 30
                              ? "bg-warning"
                              : "bg-danger",
                        )}
                        style={{ width: `${q.successRate}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums">{q.successRate}%</span>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Generated {formatDateTime(new Date())}
      </p>
    </>
  );
}
