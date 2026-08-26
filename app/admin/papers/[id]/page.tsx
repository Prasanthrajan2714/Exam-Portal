import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  Clock,
  FilePlus2,
  Lightbulb,
  Pencil,
  Scale,
  Send,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { Formula } from "@/components/formula";
import { QuestionText } from "@/components/question-text";
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
import {
  disagreesWithKey,
  solutionState,
  solutionsConfigured,
} from "@/lib/solutions";
import { cn, formatDate, formatTime } from "@/lib/utils";
import { publishExam } from "@/app/admin/exams/actions";
import { ReplacePaper } from "./replace-paper";
import { ReusePaperDialog } from "./reuse-form";
import { SettleQuestion } from "./settle-form";
import { SolvePanel } from "./solve-panel";

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
            images: { orderBy: { order: 'asc' } },
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

  // The images come along: a maths paper puts the whole relation in an equation
  // image, and both screens below exist so the admin can judge the answer for
  // themselves — which is impossible looking at "If , then the value of r is".
  const editable = (q: (typeof existing)[number], solution: string) => ({
    id: q.id,
    number: q.number,
    subjectName: q.subject.name,
    text: q.text,
    optionA: q.optionA,
    optionB: q.optionB,
    optionC: q.optionC,
    optionD: q.optionD,
    correctOption: q.correctOption,
    solvedOption: q.solvedOption,
    solution,
    images: q.images.map((i) => ({
      id: i.id,
      path: i.path,
      width: i.width,
      height: i.height,
      target: i.target,
      // What a [[#n]] marker in the text points at.
      order: i.order,
    })),
  });

  // Questions with no usable solution. A paper saved as a draft before its
  // solutions were run arrives here, and so does one the model could not answer
  // — its note travels separately from the working, which stays empty, because
  // "the equation is not available" is an explanation and not a solution.
  const unsolved = locked
    ? []
    : existing
        .filter((q) => solutionState(q) !== "SOLVED")
        .map((q) => ({
          ...editable(q, ""),
          note: solutionState(q) === "UNANSWERABLE" ? (q.solution ?? "") : "",
        }));

  // Questions where the uploaded key and the paper's own worked solution reached
  // different options. Publishing is refused while any remain, so they are shown
  // with the means to settle them rather than only named in an error.
  const disagreeing = locked
    ? []
    : existing.filter(disagreesWithKey).map((q) => editable(q, q.solution ?? ""));

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
                a reused paper never passes through one. Offered only when it can
                actually succeed: a button that opens a confirmation and then
                fails on a rule this page already knows about sends the admin
                hunting for a problem in the paper. The alert below says what to
                do instead. */}
            {existing.length > 0 &&
              exam.status !== "PUBLISHED" &&
              paperComplete &&
              unsolved.length === 0 &&
              disagreeing.length === 0 && (
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

      {/* A draft nobody has sat can still take a different document. It sits
          here rather than in the header because opening it unfolds the whole
          uploader, and the ordinary reason to be on this page is to read the
          paper. */}
      {existing.length > 0 && exam.status !== "PUBLISHED" && !locked && (
        <div className="mb-6">
          <ReplacePaper
            examId={id}
            examName={exam.name}
            medium={exam.medium}
            questionCount={exam._count.questions}
          />
        </div>
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

      {/* The count on the exam and the count in the document disagree. Either
          could be the wrong one, so name both ways out rather than guessing —
          and say where the number is changed, which is not this page. */}
      {existing.length > 0 && exam.status !== "PUBLISHED" && !paperComplete && (
        <Alert tone="warning" className="mb-6">
          <p>
            This exam expects {expected} question(s) and the uploaded paper has{" "}
            {exam._count.questions}. Publishing stays closed until they agree.
          </p>
          <p className="mt-1">
            If the paper is right, change the exam to {exam._count.questions}{" "}
            question(s). If the exam is right, upload the missing questions.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link href={`/admin/exams/${id}/edit`}>
              <Pencil /> Change the question count
            </Link>
          </Button>
        </Alert>
      )}

      {/* A draft can be saved without solutions on purpose — upload today, solve
          tomorrow. Tomorrow has to exist, though, and the upload screen is gone
          by then, so the solving lives here on the stored questions. */}
      {unsolved.length > 0 && (
        <Card className="mb-6 border-warning">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="size-4 text-warning" />
                {unsolved.length} question(s) have no worked solution
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Students read these once the exam window closes, and publishing
                is held back until every question has one.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <SolvePanel
              examId={id}
              questions={unsolved}
              configured={solutionsConfigured()}
            />
          </CardBody>
        </Card>
      )}

      {/* The check that stops a wrong key going live. It is only worth having if
          the admin can act on it here — the key and the working of a saved paper
          are editable nowhere else, so naming the question in an error message
          left deleting the paper as the only way forward. */}
      {disagreeing.length > 0 && (
        <Card className="mb-6 border-danger">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2 text-danger">
                <AlertTriangle className="size-4" />
                {disagreeing.length} question(s) need settling before publishing
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                The answer key you uploaded and the paper&rsquo;s own worked
                solution reached different options. Each question was solved from
                the question and its options alone, without being shown the key,
                so a disagreement means one of the two is wrong — and a wrong key
                marks correct students down with nothing later to catch it.
              </p>
            </div>
          </CardHeader>
          <CardBody className="space-y-6">
            {disagreeing.map((q) => (
              <SettleQuestion key={q.id} question={q} />
            ))}
          </CardBody>
        </Card>
      )}

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

/**
 * The saved paper, laid out to be read rather than scanned.
 *
 * This was a table: the question clamped to one line, the solution folded behind
 * a "Read solution" toggle, and the images reduced to the words "3 image(s)" —
 * which on a maths paper meant the equations, the only part of the question that
 * says anything, were the part not shown. Checking a paper meant opening every
 * row and still not seeing it.
 *
 * One block per question now, in the order a person reads: the question with its
 * diagrams in place, the four options with the key marked, then the working
 * underneath.
 */
function SavedQuestions({
  questions,
  action,
}: {
  questions: {
    id: string;
    number: number;
    text: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctOption: "A" | "B" | "C" | "D" | null;
    solution: string | null;
    solvedOption: "A" | "B" | "C" | "D" | null;
    subject: { name: string };
    images: {
      id: string;
      path: string;
      width: number | null;
      height: number | null;
      order: number;
      target: string;
    }[];
  }[];
  action?: React.ReactNode;
}) {
  const OPTIONS = ["A", "B", "C", "D"] as const;

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Saved questions</CardTitle>
        {action}
      </CardHeader>
      <CardBody className="space-y-4">
        {questions.map((q) => {
          const texts: Record<(typeof OPTIONS)[number], string> = {
            A: q.optionA,
            B: q.optionB,
            C: q.optionC,
            D: q.optionD,
          };
          const disagrees = q.solvedOption && q.solvedOption !== q.correctOption;

          return (
            <div
              key={q.id}
              className="rounded-[var(--radius-app)] border border-border p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="primary">{q.subject.name}</Badge>
                <span className="text-sm font-semibold">Q{q.number}</span>
                <span className="flex-1" />
                {q.correctOption && (
                  <Badge tone="success">Answer {q.correctOption}</Badge>
                )}
                {/* Publishing is blocked while these disagree, so showing the
                    clash here is how an admin finds the question to fix. */}
                {disagrees && (
                  <Badge tone="danger">solution says {q.solvedOption}</Badge>
                )}
              </div>

              <QuestionText
                text={q.text || "—"}
                images={q.images.filter((i) => i.target === "STEM")}
                alt="Part of the question"
                fallbackWidth={320}
                fallbackHeight={240}
                className="block text-sm leading-relaxed"
              />

              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {OPTIONS.map((key) => {
                  const isCorrect = key === q.correctOption;
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
                        text={texts[key]}
                        images={q.images.filter((i) => i.target === key)}
                        alt={`Option ${key}`}
                        fallbackWidth={200}
                        fallbackHeight={150}
                        className="flex-1"
                      />
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
                  <p className="text-sm text-muted-foreground">Not solved yet</p>
                )}
              </div>
            </div>
          );
        })}
      </CardBody>
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
