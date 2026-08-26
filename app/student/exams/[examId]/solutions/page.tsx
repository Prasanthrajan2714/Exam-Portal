import { ArrowLeft, BookOpenCheck, CalendarClock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { Formula } from "@/components/formula";
import { PrintButton } from "@/components/print-button";
import { QuestionText } from "@/components/question-text";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canReadSolutions } from "@/lib/exam-window";
import { cn, formatDate, formatTime } from "@/lib/utils";

export const metadata = { title: "Solutions · FirstBench" };

// Whether the solutions may be read at all depends on "now", so this page can
// never be cached.
export const dynamic = "force-dynamic";

const OPTIONS = ["A", "B", "C", "D"] as const;

/**
 * The worked solutions for one exam, open to the whole batch once the window
 * has closed — including students who never sat it, which is deliberate: the
 * paper is over, and the solutions are teaching material from that point on.
 *
 * Every refusal below is a `notFound()` rather than an explanation. A page that
 * said "this exam is still running" would confirm the exam exists and hand a
 * student outside the batch — or one mid-window in another room — a signal we
 * have no business giving them.
 */
export default async function ExamSolutionsPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { student } = await requireStudent();
  const { examId } = await params;

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      name: true,
      batchId: true,
      status: true,
      startsAt: true,
      endsAt: true,
      durationMinutes: true,
      examSubjects: {
        select: { subject: { select: { name: true } } },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!exam || !canReadSolutions(student, exam)) notFound();

  const questions = await prisma.question.findMany({
    where: { examId: exam.id },
    orderBy: [{ subject: { order: "asc" } }, { number: "asc" }],
    include: {
      subject: { select: { name: true } },
      images: { orderBy: { order: "asc" } },
    },
  });

  return (
    <>
      {/* Print only: the app chrome and its logo are hidden on paper. */}
      <div className="mb-4 hidden items-center gap-3 border-b border-border pb-4 print:flex">
        <BrandMark size={40} />
        <div>
          <p className="text-sm font-semibold">FirstBench Exams</p>
          <p className="text-xs text-muted-foreground">Solutions</p>
        </div>
      </div>

      <PageHeader
        title={`${exam.name} — solutions`}
        description={exam.examSubjects.map((es) => es.subject.name).join(" · ")}
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

      <p className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="size-3.5" />
        Held {formatDate(exam.startsAt)}, {formatTime(exam.startsAt)} –{" "}
        {formatTime(exam.endsAt)}
      </p>

      {questions.length === 0 ? (
        <EmptyState
          title="Nothing to show"
          description="No questions are on file for this exam."
        />
      ) : (
        <div className="space-y-3">
          {questions.map((q) => {
            const stemImages = q.images.filter((i) => i.target === "STEM");

            return (
              <Card key={q.id} className="print-plain">
                <CardBody>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone="primary">{q.subject.name}</Badge>
                    <span className="text-sm font-semibold">Q{q.number}</span>
                  </div>

                  <QuestionText
                    text={q.text}
                    images={stemImages}
                    alt="Part of the question"
                    fallbackWidth={320}
                    fallbackHeight={240}
                    className="block text-sm leading-relaxed"
                  />

                  <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {OPTIONS.map((key) => {
                      const text = {
                        A: q.optionA,
                        B: q.optionB,
                        C: q.optionC,
                        D: q.optionD,
                      }[key];
                      const isCorrect = key === q.correctOption;
                      const optionImages = q.images.filter((i) => i.target === key);

                      return (
                        <div
                          key={key}
                          className={cn(
                            "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                            isCorrect
                              ? "border-success bg-success-soft/50"
                              : "border-border",
                          )}
                        >
                          <span className="font-semibold">{key}.</span>
                          <QuestionText
                            text={text}
                            images={optionImages}
                            alt={`Option ${key}`}
                            fallbackWidth={200}
                            fallbackHeight={150}
                            className="flex-1"
                          />
                          {isCorrect && (
                            <span className="text-xs font-medium text-success">
                              correct
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 rounded-md border border-border bg-surface-muted px-3 py-2.5">
                    <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <BookOpenCheck className="size-3.5" /> Solution
                    </p>
                    {q.solution ? (
                      <Formula
                        text={q.solution}
                        className="block text-sm leading-relaxed"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No written solution was recorded for this question.
                      </p>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
