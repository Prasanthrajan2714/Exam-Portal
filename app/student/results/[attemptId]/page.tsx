import { ArrowLeft, CheckCircle2, Clock, MinusCircle, XCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { PrintButton } from "@/components/print-button";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { sweepIfExpired } from "@/lib/attempts";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canShowResult } from "@/lib/exam-window";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Result · FirstBench" };
export const dynamic = "force-dynamic";

export default async function StudentResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { student } = await requireStudent();
  const { attemptId } = await params;

  const found = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, studentId: true, status: true, deadlineAt: true },
  });
  if (!found || found.studentId !== student.id) notFound();

  // Grade it now if the clock ran out while nobody was looking.
  await sweepIfExpired(found);

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
      answers: {
        include: {
          question: {
            include: {
              subject: { select: { id: true, name: true } },
              images: { orderBy: { order: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!attempt) notFound();

  const { exam } = attempt;

  // ------------------------------------------------------------- gating
  if (attempt.status === "IN_PROGRESS") {
    return (
      <>
        <PageHeader title={exam.name} />
        <Alert tone="info" title="This exam is still in progress">
          Your result will appear here once you submit.
        </Alert>
      </>
    );
  }

  if (!canShowResult(exam)) {
    return (
      <>
        <PageHeader title={exam.name} description="Submitted" />
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
            <Clock className="size-8 text-muted-foreground" />
            <p className="font-medium">Your answers have been recorded</p>
            <p className="max-w-md text-sm text-muted-foreground">
              This exam is set to release results only after the window closes.
              Come back after{" "}
              <strong className="text-foreground">
                {formatDateTime(exam.endsAt)}
              </strong>{" "}
              to see your score.
            </p>
            <Button asChild variant="secondary" className="mt-2">
              <Link href="/student/dashboard">
                <ArrowLeft /> Back to my exams
              </Link>
            </Button>
          </CardBody>
        </Card>
      </>
    );
  }

  // ------------------------------------------------------------- totals
  const allQuestions = await prisma.question.findMany({
    where: { examId: exam.id },
    orderBy: [{ subject: { order: "asc" } }, { number: "asc" }],
    include: {
      subject: { select: { id: true, name: true } },
      images: { orderBy: { order: "asc" } },
    },
  });

  const answerByQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const maxScore = allQuestions.reduce(
    (sum, q) => sum + (q.marks ?? exam.marksPerCorrect),
    0,
  );

  const bySubject = exam.examSubjects.map((es) => {
    const pool = allQuestions.filter((q) => q.subjectId === es.subjectId);
    let correct = 0;
    let wrong = 0;
    let unanswered = 0;
    let score = 0;
    for (const q of pool) {
      const answer = answerByQuestion.get(q.id);
      if (!answer?.selectedOption) unanswered++;
      else if (answer.isCorrect) correct++;
      else wrong++;
      score += answer?.scoreAwarded ?? 0;
    }
    return {
      name: es.subject.name,
      total: pool.length,
      correct,
      wrong,
      unanswered,
      score: Math.round(score * 100) / 100,
      maxScore: pool.reduce((sum, q) => sum + (q.marks ?? exam.marksPerCorrect), 0),
    };
  });

  const percentage =
    maxScore > 0 ? Math.round(((attempt.totalScore ?? 0) / maxScore) * 1000) / 10 : 0;

  return (
    <>
      {/* Print only: the app chrome (and its logo) is hidden on paper, so the
          scorecard carries its own letterhead. */}
      <div className="mb-4 hidden items-center gap-3 border-b border-border pb-4 print:flex">
        <BrandMark size={40} />
        <div>
          <p className="text-sm font-semibold">FirstBench Exams</p>
          <p className="text-xs text-muted-foreground">Scorecard</p>
        </div>
      </div>

      <PageHeader
        title={exam.name}
        description={`${
          attempt.status === "EXPIRED" ? "Time expired" : "Submitted"
        } · ${attempt.submittedAt ? formatDateTime(attempt.submittedAt) : ""}`}
        actions={
          <div className="no-print flex gap-2">
            <Button asChild variant="ghost">
              <Link href="/student/dashboard">
                <ArrowLeft /> My exams
              </Link>
            </Button>
            <PrintButton />
          </div>
        }
      />

      {attempt.status === "EXPIRED" && (
        <Alert tone="warning" className="mb-6" title="Your time ran out">
          The exam was submitted automatically when the timer reached zero.
          Everything you had saved was graded.
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Score"
          value={`${attempt.totalScore ?? 0} / ${maxScore}`}
          hint={`${percentage}%`}
          tone="primary"
        />
        <Stat label="Correct" value={attempt.correctCount ?? 0} tone="success" />
        <Stat label="Wrong" value={attempt.wrongCount ?? 0} tone="danger" />
        <Stat label="Unanswered" value={attempt.unansweredCount ?? 0} />
      </div>

      <Card className="print-plain mb-6">
        <CardHeader>
          <CardTitle>Subject-wise breakdown</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Subject</Th>
              <Th>Correct</Th>
              <Th>Wrong</Th>
              <Th>Unanswered</Th>
              <Th>Score</Th>
            </tr>
          </thead>
          <tbody>
            {bySubject.map((s) => (
              <tr key={s.name}>
                <Td className="font-medium">{s.name}</Td>
                <Td className="tabular-nums text-success">{s.correct}</Td>
                <Td className="tabular-nums text-danger">{s.wrong}</Td>
                <Td className="tabular-nums text-muted-foreground">{s.unanswered}</Td>
                <Td className="font-semibold tabular-nums">
                  {s.score} / {s.maxScore}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">Question review</h2>
      <div className="space-y-3">
        {allQuestions.map((q) => {
          const answer = answerByQuestion.get(q.id);
          const selected = answer?.selectedOption ?? null;
          const correct = q.correctOption;
          const state = !selected ? "skipped" : selected === correct ? "correct" : "wrong";
          const stemImages = q.images.filter((i) => i.target === "STEM");

          return (
            <Card
              key={q.id}
              className={cn(
                "print-plain",
                state === "correct" && "border-success",
                state === "wrong" && "border-danger",
              )}
            >
              <CardBody>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="primary">{q.subject.name}</Badge>
                  <span className="text-sm font-semibold">Q{q.number}</span>
                  {state === "correct" && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                      <CheckCircle2 className="size-3.5" /> Correct ·{" "}
                      +{answer?.scoreAwarded ?? 0}
                    </span>
                  )}
                  {state === "wrong" && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
                      <XCircle className="size-3.5" /> Wrong ·{" "}
                      {answer?.scoreAwarded ?? 0}
                    </span>
                  )}
                  {state === "skipped" && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <MinusCircle className="size-3.5" /> Not answered · 0
                    </span>
                  )}
                </div>

                <p className="whitespace-pre-wrap text-sm leading-relaxed">{q.text}</p>

                {stemImages.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {stemImages.map((img) => (
                      <Image
                        key={img.id}
                        src={`/api/uploads/${img.path}`}
                        alt="Question diagram"
                        width={320}
                        height={240}
                        unoptimized
                        className="rounded border border-border bg-white object-contain"
                        style={{ maxHeight: 240, width: "auto" }}
                      />
                    ))}
                  </div>
                )}

                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {(["A", "B", "C", "D"] as const).map((key) => {
                    const text = { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD }[key];
                    const isCorrect = key === correct;
                    const isChosen = key === selected;
                    return (
                      <div
                        key={key}
                        className={cn(
                          "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                          isCorrect && "border-success bg-success-soft/50",
                          isChosen && !isCorrect && "border-danger bg-danger-soft/50",
                          !isCorrect && !isChosen && "border-border",
                        )}
                      >
                        <span className="font-semibold">{key}.</span>
                        <span className="flex-1">{text}</span>
                        {isCorrect && (
                          <span className="text-xs font-medium text-success">correct</span>
                        )}
                        {isChosen && !isCorrect && (
                          <span className="text-xs font-medium text-danger">your answer</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}

