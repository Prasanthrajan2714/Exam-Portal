import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Clock,
  FileUp,
  Pencil,
  Scale,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
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
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { adminExamStatus } from "@/lib/exam-window";
import { publishBlockMessage, solutionsBlockingPublish } from "@/lib/solutions";
import { formatDate, formatTime } from "@/lib/utils";
import { PaperUploader } from "../../papers/paper-uploader";
import { deleteExam, publishExam, unpublishExam } from "../actions";

export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const exam = await prisma.exam.findUnique({
    where: { id },
    include: {
      batch: { select: { id: true, name: true, _count: { select: { students: true } } } },
      examSubjects: {
        include: { subject: { select: { name: true } } },
        orderBy: { order: "asc" },
      },
      _count: { select: { questions: true, attempts: true } },
    },
  });
  if (!exam) notFound();

  const questionsBySubject = await prisma.question.groupBy({
    by: ["subjectId"],
    where: { examId: id },
    _count: { _all: true },
  });
  const uploadedFor = new Map(
    questionsBySubject.map((q) => [q.subjectId, q._count._all]),
  );

  const expected = exam.examSubjects.reduce((sum, s) => sum + s.questionCount, 0);
  const status = adminExamStatus({ ...exam, questionCount: exam._count.questions });
  const published = exam.status === "PUBLISHED";
  const paperComplete = exam._count.questions === expected && expected > 0;

  // Publishing is also refused while the answer key and a question's own worked
  // solution disagree. The settling happens on the paper page, so this page only
  // needs to know whether any remain — and must not offer a Publish that will
  // bounce off a rule it can see from here.
  const answers = await prisma.question.findMany({
    where: { examId: id },
    select: {
      number: true,
      solution: true,
      solvedOption: true,
      correctOption: true,
    },
  });
  const block = paperComplete ? solutionsBlockingPublish(answers) : null;
  const readyToPublish = paperComplete && block === null;

  return (
    <>
      <PageHeader
        title={exam.name}
        description={`${exam.batch.name} · ${exam.examSubjects
          .map((s) => s.subject.name)
          .join(", ")}`}
        actions={
          <Button asChild variant="ghost">
            <Link href="/admin/exams">
              <ArrowLeft /> All exams
            </Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* Same wording as the exams list and the dashboard — three pages
            naming the same state differently is how "Live now" survived here. */}
        <Badge tone={status.tone}>
          {status.label === "Draft" ? "Draft — not visible to students" : status.label}
        </Badge>
        {exam.resultVisibility === "IMMEDIATE" ? (
          <Badge tone="primary">Results shown immediately</Badge>
        ) : (
          <Badge tone="primary">Results after the window closes</Badge>
        )}
        {/* Shown for English too: an absent badge would be ambiguous next to the
            two badges beside it, which always state their setting. */}
        {exam.medium === "TAMIL" ? (
          <Badge tone="info">Tamil medium</Badge>
        ) : (
          <Badge tone="neutral">English medium</Badge>
        )}
      </div>

      {!published && (
        <Alert tone="warning" className="mb-6" title="This exam is still a draft">
          {!paperComplete ? (
            "Upload the question paper and answer key, then publish it so students can see it."
          ) : block ? (
            <>
              {/* The exact reason publishing would fail, in the gate's own
                  words, and a way to act on it — both the solving and the
                  settling happen on the paper page. */}
              <p>{publishBlockMessage(block)}</p>
              <Button asChild variant="secondary" size="sm" className="mt-3">
                <Link href={`/admin/papers/${exam.id}`}>
                  <Scale />
                  {block.kind === "UNSOLVED"
                    ? "Work the solutions out"
                    : "Settle them on the paper"}
                </Link>
              </Button>
            </>
          ) : (
            "The paper is complete — publish it below to make it visible to this batch."
          )}
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Questions"
          value={`${exam._count.questions} / ${expected}`}
          tone={paperComplete ? "success" : exam._count.questions > 0 ? "danger" : undefined}
          hint={paperComplete ? "Paper complete" : "Awaiting upload"}
        />
        <Stat label="Maximum score" value={expected * exam.marksPerCorrect} />
        <Stat
          label="Students in batch"
          value={exam.batch._count.students}
          hint={exam.batch.name}
        />
        <Stat
          label="Attempts so far"
          value={exam._count.attempts}
          tone={exam._count.attempts > 0 ? "primary" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Schedule and marking</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Row icon={<CalendarDays className="size-4" />} label="Date">
              {formatDate(exam.startsAt)}
            </Row>
            <Row icon={<Clock className="size-4" />} label="Window">
              {formatTime(exam.startsAt)} – {formatTime(exam.endsAt)}
            </Row>
            <Row icon={<Clock className="size-4" />} label="Duration per student">
              {exam.durationMinutes} minutes
            </Row>
            <Row icon={<Users className="size-4" />} label="Marking">
              +{exam.marksPerCorrect} correct · −{exam.negativeMarks} wrong · 0
              unanswered
            </Row>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Paper structure</CardTitle>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>Subject</Th>
                <Th>Expected</Th>
                <Th>Uploaded</Th>
              </tr>
            </thead>
            <tbody>
              {exam.examSubjects.map((es) => {
                const got = uploadedFor.get(es.subjectId) ?? 0;
                return (
                  <tr key={es.id}>
                    <Td className="font-medium">{es.subject.name}</Td>
                    <Td className="tabular-nums text-muted-foreground">
                      {es.questionCount}
                    </Td>
                    <Td
                      className={
                        got === es.questionCount
                          ? "tabular-nums text-success"
                          : "tabular-nums text-warning"
                      }
                    >
                      {got}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>

      {/* An exam without a paper gets one here rather than being sent to the
          papers section — that section is for looking at and reusing papers. */}
      {exam._count.questions === 0 && exam._count.attempts === 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">Question paper</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Upload the paper and its answer key. Nothing is saved until you have
            reviewed every question that was read.
          </p>
          <PaperUploader
            examId={exam.id}
            examName={exam.name}
            medium={exam.medium}
            redirectTo={`/admin/exams/${exam.id}`}
          />
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {exam._count.questions > 0 && (
          <Button asChild>
            <Link href={`/admin/papers/${exam.id}`}>
              <FileUp /> Manage question paper
            </Link>
          </Button>
        )}

        {exam._count.attempts > 0 && (
          <Button asChild variant="secondary">
            <Link href={`/admin/reports/${exam.id}`}>
              <BarChart3 /> Results
            </Link>
          </Button>
        )}

        {exam._count.attempts === 0 && (
          <Button asChild variant="secondary">
            <Link href={`/admin/exams/${exam.id}/edit`}>
              <Pencil /> Edit details
            </Link>
          </Button>
        )}

        {!published && readyToPublish && (
          <ConfirmButton
            title="Publish this exam?"
            description={`${exam._count.questions} question(s) go live for ${exam.batch.name}. Students can sit it during its scheduled window.`}
            confirmLabel="Publish"
            action={publishExam.bind(null, exam.id)}
          >
            Publish
          </ConfirmButton>
        )}

        {published && exam._count.attempts === 0 && (
          <ConfirmButton
            variant="secondary"
            title="Unpublish this exam?"
            description="It disappears from student dashboards until you publish it again."
            confirmLabel="Unpublish"
            action={unpublishExam.bind(null, exam.id)}
          >
            Unpublish
          </ConfirmButton>
        )}

        {exam._count.attempts === 0 && (
          <ConfirmButton
            variant="ghost"
            title={`Delete "${exam.name}"?`}
            description="This removes the exam and its question paper. It cannot be undone."
            confirmLabel="Delete exam"
            action={deleteExam.bind(null, exam.id)}
          >
            <Trash2 /> Delete
          </ConfirmButton>
        )}
      </div>
    </>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="font-medium">{children}</p>
      </div>
    </div>
  );
}
