import {
  ArrowLeft,
  CalendarDays,
  Clock,
  FilePlus2,
  ImageIcon,
  Scale,
  Send,
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
  EmptyState,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/utils";
import { publishExam } from "@/app/admin/exams/actions";
import { ReusePaperDialog } from "./reuse-form";

export const metadata = { title: "Question paper · Admin" };

/**
 * One paper's own page. `[id]` is the exam id: questions belong to an exam, so
 * the paper and its exam are the same record seen from the papers section.
 */
export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const exam = await prisma.exam.findUnique({
    where: { id },
    include: {
      batch: { select: { name: true } },
      examSubjects: { include: { subject: true }, orderBy: { order: "asc" } },
      _count: { select: { questions: true, attempts: true } },
    },
  });
  if (!exam) notFound();

  const existing =
    exam._count.questions > 0
      ? await prisma.question.findMany({
          where: { examId: id },
          orderBy: [{ subject: { order: "asc" } }, { number: "asc" }],
          include: {
            subject: { select: { name: true } },
            _count: { select: { images: true } },
          },
        })
      : [];

  // Reuse offers every active batch, this one included — a paper is often run
  // again for a repeat sitting of the same class.
  const batches = await prisma.batch.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const expected = exam.examSubjects.reduce((sum, s) => sum + s.questionCount, 0);
  const locked = exam._count.attempts > 0;
  const paperComplete = exam._count.questions === expected && expected > 0;

  return (
    <>
      <PageHeader
        title={exam.name}
        description={`${exam.batch.name} · ${
          exam.examSubjects.length === 0
            ? "No subjects set"
            : exam.examSubjects
                .map((es) => `${es.subject.name} ${es.questionCount}`)
                .join(" · ")
        }`}
        actions={
          <>
            {/* A draft whose paper is already complete has nowhere else to go —
                publishing is only otherwise offered at the end of an upload, and
                a reused paper never passes through one. */}
            {existing.length > 0 && exam.status !== "PUBLISHED" && (
              <ConfirmButton
                title="Publish this exam?"
                description={`${existing.length} question(s) go live for ${exam.batch.name}. Students can sit it during its scheduled window.`}
                confirmLabel="Publish"
                action={publishExam.bind(null, id)}
              >
                <Send /> Publish
              </ConfirmButton>
            )}
            {existing.length > 0 && (
              <ReusePaperDialog examId={id} examName={exam.name} batches={batches} />
            )}
            <Button asChild variant="ghost">
              <Link href="/admin/papers">
                <ArrowLeft /> All papers
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Questions"
          value={`${exam._count.questions} / ${expected}`}
          tone={paperComplete ? "success" : exam._count.questions > 0 ? "danger" : undefined}
          hint={paperComplete ? "Paper complete" : "Awaiting upload"}
        />
        <Stat label="Maximum score" value={expected * exam.marksPerCorrect} />
        <Stat
          label="Status"
          value={exam.status === "PUBLISHED" ? "Published" : "Draft"}
          tone={exam.status === "PUBLISHED" ? "success" : undefined}
          hint={exam.batch.name}
        />
        <Stat
          label="Attempts so far"
          value={exam._count.attempts}
          tone={locked ? "primary" : undefined}
          hint={locked ? "Paper is locked" : "Still editable"}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
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
            <Row icon={<Scale className="size-4" />} label="Marking">
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
                <Th>Saved</Th>
              </tr>
            </thead>
            <tbody>
              {exam.examSubjects.map((es) => {
                const got = existing.filter(
                  (q) => q.subject.name === es.subject.name,
                ).length;
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

      {locked ? (
        <>
          <Alert tone="info" className="mb-6" title="This paper is locked">
            {exam._count.attempts} student(s) have already attempted this exam, so
            the questions can no longer be changed — editing them would invalidate
            results that have already been recorded. The paper can still be run
            again for another batch.
          </Alert>
          <SavedQuestions questions={existing} />
        </>
      ) : existing.length > 0 ? (
        <>
          <Alert tone="success" className="mb-6" title="The paper is saved">
            {existing.length} question(s) are on file
            {exam.status === "PUBLISHED"
              ? " and published to students."
              : `, but the exam is still a draft — use Publish above to make it visible to ${exam.batch.name}.`}{" "}
            Nothing has to be uploaded again; use it as it is, or run it for
            another batch.
          </Alert>

          {/* View and reuse only: this section is not where a paper is changed
              or thrown away. */}
          <SavedQuestions questions={existing} />
        </>
      ) : (
        // A paper is attached while its exam is being set up, so an exam still
        // without one is sent back there rather than given an uploader here.
        <EmptyState
          title="This exam has no paper yet"
          description={`Nothing has been uploaded for ${exam.name}. The question paper and answer key are added on the exam itself, where its subjects and marking are set.`}
          action={
            <Button asChild>
              <Link href={`/admin/exams/${id}`}>
                <FilePlus2 /> Go to the exam
              </Link>
            </Button>
          }
        />
      )}
    </>
  );
}

function SavedQuestions({
  questions,
  action,
}: {
  questions: {
    id: string;
    number: number;
    text: string;
    correctOption: "A" | "B" | "C" | "D" | null;
    solution: string | null;
    solvedOption: "A" | "B" | "C" | "D" | null;
    subject: { name: string };
    _count: { images: number };
  }[];
  action?: React.ReactNode;
}) {
  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Saved questions</CardTitle>
        {action}
      </CardHeader>
      <Table>
        <thead>
          <tr>
            <Th>Subject</Th>
            <Th>No.</Th>
            <Th>Question</Th>
            <Th>Solution</Th>
            <Th>Answer</Th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => (
            <tr key={q.id}>
              <Td className="text-muted-foreground">{q.subject.name}</Td>
              <Td className="tabular-nums">{q.number}</Td>
              <Td>
                <span className="line-clamp-1">{q.text || "—"}</span>
                {q._count.images > 0 && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <ImageIcon className="size-3" /> {q._count.images} image(s)
                  </span>
                )}
              </Td>
              {/* A worked solution runs to a paragraph, so it folds away rather
                  than turning every row into a wall of text. */}
              <Td className="max-w-sm align-top">
                {q.solution ? (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      Read solution
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                      {q.solution}
                    </p>
                  </details>
                ) : (
                  <span className="text-xs text-muted-foreground">Not solved yet</span>
                )}
              </Td>
              <Td>
                <Badge tone="success">{q.correctOption}</Badge>
                {/* Publishing is blocked while these disagree, so showing the
                    clash here is how an admin finds out which question to fix. */}
                {q.solvedOption && q.solvedOption !== q.correctOption && (
                  <Badge tone="danger" className="mt-1">
                    solution says {q.solvedOption}
                  </Badge>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
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
