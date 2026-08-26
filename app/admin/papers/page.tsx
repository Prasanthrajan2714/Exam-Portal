import { Eye, Search } from "lucide-react";
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
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Question papers · Admin" };

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

/**
 * Every question paper the portal holds, for looking one up and reusing it. A
 * paper lives on its exam — that is where the questions, subjects and marking
 * are defined — so one row is one exam, and "Edit" opens that paper's own page.
 * Papers are not uploaded here; they arrive with their exam.
 */
export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; batch?: string; subject?: string; date?: string }>;
}) {
  await requireAdmin();

  const { q = "", batch = "", subject = "", date = "" } = await searchParams;
  const examDate = examDateFromInput(date);
  const filtered = Boolean(q || batch || subject || examDate);

  const [batches, subjects, exams, totalPapers] = await Promise.all([
    prisma.batch.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.subject.findMany({
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    prisma.exam.findMany({
      where: {
        ...(batch ? { batchId: batch } : {}),
        // A paper covers a subject when the exam was built with it.
        ...(subject ? { examSubjects: { some: { subjectId: subject } } } : {}),
        ...(examDate ? { examDate } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      },
      orderBy: [{ startsAt: "desc" }],
      include: {
        batch: { select: { id: true, name: true } },
        examSubjects: {
          include: { subject: { select: { name: true } } },
          orderBy: { order: "asc" },
        },
        _count: { select: { questions: true, attempts: true } },
      },
    }),
    prisma.exam.count(),
  ]);

  return (
    <>
      <PageHeader
        title="Question papers"
        description="Every paper you hold, with its subjects and marking. Open one to view it, publish it, or run it again for another batch."
      />

      {totalPapers === 0 ? (
        <EmptyState
          title="No papers yet"
          description="A paper enters the portal with its exam — subjects, marking and the paper itself are all set up while the exam is created. Make one and it will show up here to view and reuse."
          action={
            <Button asChild>
              <Link href="/admin/exams/new">Create exam</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Plain GET form: the filters live in the URL, so a filtered view
              survives a refresh and can be linked to — the batch cell below
              links straight back into this form. */}
          <form
            method="get"
            className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-app)] border border-border bg-surface p-3"
          >
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search paper name"
                className="pl-9"
                aria-label="Search papers by name"
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
                <Link href="/admin/papers">Clear</Link>
              </Button>
            )}
          </form>

          {filtered && (
            <p className="mb-3 text-sm text-muted-foreground">
              {exams.length} of {totalPapers} paper(s) match.
            </p>
          )}

          {exams.length === 0 ? (
            <EmptyState
              title="No papers match those filters"
              description="Nothing here is for that batch, subject or date. Widen the filters or clear them to see every paper again."
              action={
                <Button asChild variant="secondary">
                  <Link href="/admin/papers">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <Card>
              <Table>
                <thead>
                  <tr>
                    <Th>Paper</Th>
                    <Th>Batch</Th>
                    <Th>Date</Th>
                    <Th>Medium</Th>
                    <Th>Questions</Th>
                    <Th className="text-right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {exams.map((exam) => {
                    const expected = exam.examSubjects.reduce(
                      (sum, s) => sum + s.questionCount,
                      0,
                    );
                    const complete = exam._count.questions === expected && expected > 0;
                    return (
                      <tr key={exam.id}>
                        <Td>
                          <p className="font-medium">{exam.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {exam.examSubjects.length === 0
                              ? "No subjects set"
                              : exam.examSubjects
                                  .map((s) => `${s.subject.name} ${s.questionCount}`)
                                  .join(" · ")}
                          </p>
                        </Td>
                        <Td>
                          <Link
                            href={`/admin/papers?batch=${exam.batch.id}`}
                            className="text-muted-foreground hover:text-primary-ink hover:underline"
                          >
                            {exam.batch.name}
                          </Link>
                        </Td>
                        <Td className="text-muted-foreground">
                          {formatDate(exam.startsAt)}
                        </Td>
                        {/* The language the questions are stored in — a Tamil
                            paper reads nothing like its English sibling. */}
                        <Td>
                          {exam.medium === "TAMIL" ? (
                            <Badge tone="info">Tamil</Badge>
                          ) : (
                            <Badge tone="neutral">English</Badge>
                          )}
                        </Td>
                        <Td>
                          {exam._count.questions === 0 ? (
                            <Badge tone="warning">Not uploaded</Badge>
                          ) : complete ? (
                            <Badge tone="success">
                              {exam._count.questions} of {expected}
                            </Badge>
                          ) : (
                            <Badge tone="danger">
                              {exam._count.questions} of {expected}
                            </Badge>
                          )}
                          {exam._count.attempts > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Locked · {exam._count.attempts} attempt(s)
                            </p>
                          )}
                        </Td>
                        <Td className="text-right">
                          <Button asChild variant="secondary" size="sm">
                            <Link href={`/admin/papers/${exam.id}`}>
                              <Eye />
                              Preview
                            </Link>
                          </Button>
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
