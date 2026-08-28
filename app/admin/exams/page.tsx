import { FileText, FileUp, Plus, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { adminExamStatus } from "@/lib/exam-window";
import { formatDate, formatTime } from "@/lib/utils";

export const metadata = { title: "Exams · Admin" };

/**
 * `examDate` is the exam's local calendar day stored at UTC midnight (see
 * createExam), which is also the date the table shows — so an exact match on it
 * is what the admin means when they pick a day out of the calendar.
 */
function examDateFromInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; batch?: string; subject?: string; date?: string }>;
}) {
  await requireAdmin();

  const { q = "", batch = "", subject = "", date = "" } = await searchParams;
  const examDate = examDateFromInput(date);
  const filtered = Boolean(q || batch || subject || examDate);

  const [batches, subjects, exams, totalExams] = await Promise.all([
    prisma.batch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.subject.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    prisma.exam.findMany({
      where: {
        ...(batch ? { batchId: batch } : {}),
        // An exam covers a subject when it was built with it.
        ...(subject ? { examSubjects: { some: { subjectId: subject } } } : {}),
        ...(examDate ? { examDate } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      },
      orderBy: [{ startsAt: "desc" }],
      include: {
        batch: { select: { name: true } },
        examSubjects: { include: { subject: { select: { name: true } } }, orderBy: { order: "asc" } },
        _count: { select: { questions: true, attempts: true } },
      },
    }),
    prisma.exam.count(),
  ]);

  return (
    <>
      <PageHeader
        title="Exams"
        description="Every exam belongs to a batch and only opens during its scheduled window."
        actions={
          <Button asChild>
            <Link href="/admin/exams/new">
              <Plus /> Create exam
            </Link>
          </Button>
        }
      />

      {totalExams === 0 ? (
        <EmptyState
          title="No exams yet"
          description="Create an exam to set its subjects, schedule and marking. You will upload the question paper afterwards."
          action={
            <Button asChild>
              <Link href="/admin/exams/new">Create exam</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Plain GET form, the same as the papers section: the filters live in
              the URL, so a filtered view survives a refresh and can be shared. */}
          <form
            method="get"
            className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-app)] border border-border bg-surface p-3"
          >
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search exam name"
                className="pl-9"
                aria-label="Search exams by name"
              />
            </div>
            <Select
              name="batch"
              defaultValue={batch}
              className="w-48"
              aria-label="Filter by batch or class"
            >
              <option value="">All batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Select
              name="subject"
              defaultValue={subject}
              className="w-44"
              aria-label="Filter by subject"
            >
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              name="date"
              defaultValue={date}
              className="w-44"
              aria-label="Filter by exam date"
            />
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {filtered && (
              <Button asChild variant="ghost">
                <Link href="/admin/exams">Clear</Link>
              </Button>
            )}
          </form>

          {filtered && (
            <p className="mb-3 text-sm text-muted-foreground">
              {exams.length} of {totalExams} exam(s) match.
            </p>
          )}

          {exams.length === 0 ? (
            <EmptyState
              title="No exams match those filters"
              description="Nothing here is for that batch, subject or date. Widen the filters or clear them to see every exam again."
              action={
                <Button asChild variant="secondary">
                  <Link href="/admin/exams">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <Card>
          <Table>
            <thead>
              <tr>
                <Th>Exam</Th>
                <Th>Batch</Th>
                <Th>Subjects</Th>
                <Th>Medium</Th>
                <Th>Schedule</Th>
                <Th>No. of questions</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {exams.map((exam) => {
                const expected = exam.examSubjects.reduce(
                  (sum, s) => sum + s.questionCount,
                  0,
                );
                const published = exam.status === "PUBLISHED";
                const status = adminExamStatus({
                  ...exam,
                  questionCount: exam._count.questions,
                });
                // Only an exam with no paper yet goes to the uploader. Once one
                // is on file the action opens it, where it can be read and — a
                // draft nobody has sat — replaced.
                const hasPaper = exam._count.questions > 0;
                const canTakePaper = !published && exam._count.attempts === 0 && !hasPaper;
                return (
                  <tr key={exam.id}>
                    <Td>
                      <Link
                        href={`/admin/exams/${exam.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {exam.name}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground">{exam.batch.name}</Td>
                    <Td className="text-xs text-muted-foreground">
                      {exam.examSubjects.length === 0
                        ? "—"
                        : exam.examSubjects.map((s) => s.subject.name).join(" · ")}
                    </Td>
                    <Td>
                      <Badge tone={exam.medium === "TAMIL" ? "info" : "neutral"}>
                        {exam.medium === "TAMIL" ? "Tamil" : "English"}
                      </Badge>
                    </Td>
                    <Td className="text-muted-foreground">
                      <p className="text-xs">{formatDate(exam.startsAt)}</p>
                      <p className="text-xs">
                        {formatTime(exam.startsAt)} – {formatTime(exam.endsAt)} ·{" "}
                        {exam.durationMinutes} min
                      </p>
                    </Td>
                    <Td>
                      {exam._count.questions === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          Not uploaded
                        </span>
                      ) : (
                        <span
                          className={
                            exam._count.questions === expected
                              ? "text-xs tabular-nums"
                              : "text-xs tabular-nums text-warning"
                          }
                        >
                          {exam._count.questions} / {expected}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {/* Uploading lives on the exam page itself, so a draft
                            goes straight there rather than via the papers
                            section and back again. */}
                        {canTakePaper ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/admin/exams/${exam.id}`}>
                              <FileUp /> Upload paper
                            </Link>
                          </Button>
                        ) : (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/admin/papers/${exam.id}`}>
                              <FileText /> View paper
                            </Link>
                          </Button>
                        )}
                        {/* No Results here: the Reports section is the place
                            results are read, and two doors to the same thing
                            only makes the row harder to scan. */}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
          )}
        </>
      )}
    </>
  );
}
