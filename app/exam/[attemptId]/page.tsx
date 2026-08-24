import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody } from "@/components/ui/primitives";
import { sweepIfExpired } from "@/lib/attempts";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { secondsRemaining } from "@/lib/exam-window";
import { ExamRunner, type RunnerQuestion } from "./exam-runner";

export const metadata = { title: "Exam in progress" };
export const dynamic = "force-dynamic";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { student } = await requireStudent();
  const { attemptId } = await params;

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      exam: {
        include: {
          examSubjects: {
            include: { subject: { select: { id: true, name: true } } },
            orderBy: { order: "asc" },
          },
        },
      },
      answers: true,
    },
  });

  if (!attempt || attempt.studentId !== student.id) notFound();

  // Close it out if the clock ran down while they were away.
  if (await sweepIfExpired(attempt)) {
    redirect(`/student/results/${attemptId}`);
  }
  if (attempt.status !== "IN_PROGRESS") {
    redirect(`/student/results/${attemptId}`);
  }

  /**
   * The spec's core rule: an exam may be entered once. Coming back to this
   * screen after closing it needs an administrator to approve a reopen, which
   * is what clears sessionClaimedAt.
   */
  if (attempt.sessionClaimedAt) {
    return <ReentryBlocked examName={attempt.exam.name} />;
  }

  await prisma.attempt.update({
    where: { id: attemptId },
    data: { sessionClaimedAt: new Date() },
  });

  const questions = await prisma.question.findMany({
    where: { examId: attempt.examId },
    orderBy: [{ subject: { order: "asc" } }, { number: "asc" }],
    include: { images: { orderBy: { order: "asc" } } },
  });

  const answerByQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));

  const runnerQuestions: RunnerQuestion[] = questions.map((q) => ({
    id: q.id,
    subjectId: q.subjectId,
    number: q.number,
    text: q.text,
    options: {
      A: q.optionA,
      B: q.optionB,
      C: q.optionC,
      D: q.optionD,
    },
    images: q.images.map((i) => ({
      path: i.path,
      target: i.target,
      width: i.width,
      height: i.height,
    })),
    // Answers saved before the interruption come straight back.
    selectedOption: answerByQuestion.get(q.id)?.selectedOption ?? null,
    markedForReview: answerByQuestion.get(q.id)?.markedForReview ?? false,
  }));

  const subjects = attempt.exam.examSubjects.map((es) => ({
    id: es.subject.id,
    name: es.subject.name,
  }));

  return (
    <ExamRunner
      attemptId={attempt.id}
      sessionToken={attempt.sessionToken}
      examName={attempt.exam.name}
      studentName={student.name}
      subjects={subjects}
      questions={runnerQuestions}
      initialSecondsRemaining={secondsRemaining(attempt)}
      marksPerCorrect={attempt.exam.marksPerCorrect}
      negativeMarks={attempt.exam.negativeMarks}
    />
  );
}

function ReentryBlocked({ examName }: { examName: string }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="size-6 text-warning" />
            <h1 className="text-lg font-semibold">This exam is already open</h1>
          </div>

          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{examName}</strong> was started
            and this screen has already been opened once. An exam may only be
            entered a single time.
          </p>

          <Alert tone="info">
            If your exam was interrupted by a power cut or an internet problem,
            go back to your dashboard and choose{" "}
            <strong>Request to resume</strong>. Once your administrator approves
            it you will continue from exactly where you stopped — every answer
            you saved is still there.
          </Alert>

          <Button asChild>
            <Link href="/student/dashboard">
              <ArrowLeft /> Back to my exams
            </Link>
          </Button>
        </CardBody>
      </Card>
    </main>
  );
}
