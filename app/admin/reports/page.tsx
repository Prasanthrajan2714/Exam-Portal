import { CalendarDays, Download, FileSpreadsheet, ListChecks } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import {
  Badge,
  Card,
  CardDescription,
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
import { examPhase } from "@/lib/exam-window";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Reports · Admin" };
// "Closed" depends on the current instant, so this page can never be cached.
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  await requireAdmin();
  const { batch = "" } = await searchParams;

  // The dropdown lists every class that has published exams, not just ones with
  // closed exams — picking a class whose paper is still running should say so
  // rather than make the class disappear from the filter.
  const batches = await prisma.batch.findMany({
    where: { exams: { some: { status: "PUBLISHED" } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const published = await prisma.exam.findMany({
    where: { status: "PUBLISHED", ...(batch ? { batchId: batch } : {}) },
    orderBy: [{ examDate: "desc" }, { startsAt: "desc" }],
    include: {
      batch: {
        select: {
          id: true,
          name: true,
          _count: { select: { students: true } },
        },
      },
    },
  });

  // Reporting is for finished exams only — same definition of "closed" the
  // student dashboard and the exam list use.
  const closed = published.filter((exam) => examPhase(exam) === "CLOSED");
  const examIds = closed.map((exam) => exam.id);

  // Marks must be settled before they are reported: an attempt abandoned mid-way
  // stays IN_PROGRESS with a null score until it is swept and graded.
  for (const id of examIds) await sweepExamAttempts(id);

  const [attemptStats, questions] = await Promise.all([
    examIds.length > 0
      ? prisma.attempt.groupBy({
          by: ["examId"],
          where: { examId: { in: examIds } },
          _count: { _all: true },
          _avg: { totalScore: true },
          _max: { totalScore: true },
        })
      : Promise.resolve([]),
    examIds.length > 0
      ? prisma.question.findMany({
          where: { examId: { in: examIds } },
          select: { examId: true, marks: true },
        })
      : Promise.resolve([]),
  ]);

  const statsByExam = new Map(attemptStats.map((s) => [s.examId, s]));

  const questionsByExam = new Map<string, { marks: number | null }[]>();
  for (const q of questions) {
    const bucket = questionsByExam.get(q.examId) ?? [];
    bucket.push({ marks: q.marks });
    questionsByExam.set(q.examId, bucket);
  }

  // A question may carry its own marks; the rest are worth the exam's
  // marks-per-correct.
  const maxScoreByExam = new Map<string, number>();
  for (const exam of closed) {
    const pool = questionsByExam.get(exam.id) ?? [];
    maxScoreByExam.set(
      exam.id,
      pool.reduce((sum, q) => sum + (q.marks ?? exam.marksPerCorrect), 0),
    );
  }

  // Grouped by the day the exams were sat, newest first, with the class named
  // on each row. An exam is an event on a date; a school looking for last
  // Tuesday's results should find them together rather than scattered through
  // one card per class.
  type DayGroup = {
    /** The exam date itself, for the heading. */
    date: Date;
    /** Its ISO day, which is what groups them. */
    key: string;
    exams: typeof closed;
  };
  const days = new Map<string, DayGroup>();
  for (const exam of closed) {
    // examDate is stored at UTC midnight for the exam's own calendar day, so
    // the ISO date is the day without any timezone arithmetic.
    const key = exam.examDate.toISOString().slice(0, 10);
    const day = days.get(key) ?? { date: exam.examDate, key, exams: [] };
    day.exams.push(exam);
    days.set(key, day);
  }
  // `closed` is already newest-first, so the days come out in that order too.
  const dayGroups = [...days.values()];

  const totalAttempts = attemptStats.reduce((sum, s) => sum + s._count._all, 0);
  const selectedBatch = batches.find((b) => b.id === batch);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Marks for every exam whose window has closed, by the date it was sat. Download one exam, or a whole class in a single workbook."
      />

      {/* Plain GET form so the page stays a server component and a filtered
          view can be bookmarked or shared. */}
      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-app)] border border-border bg-surface p-3"
      >
        <Select
          name="batch"
          defaultValue={batch}
          className="w-56"
          aria-label="Filter by class"
        >
          <option value="">All classes</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {batch && (
          <Button asChild variant="ghost">
            <Link href="/admin/reports">Clear</Link>
          </Button>
        )}
        {/* One class in one workbook. It used to sit on that class's own card;
            with the report read by date, the filter is where a class is chosen
            and so is where its workbook belongs. */}
        {selectedBatch && (
          <Button asChild variant="secondary">
            <a href={`/api/admin/reports/${selectedBatch.id}`}>
              <FileSpreadsheet /> Download {selectedBatch.name} marks
            </a>
          </Button>
        )}
      </form>

      {closed.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Closed exams" value={closed.length} />
          <Stat
            label="Exam days"
            value={dayGroups.length}
            hint={selectedBatch ? selectedBatch.name : "all classes"}
          />
          <Stat label="Papers written" value={totalAttempts} hint="attempts recorded" />
        </div>
      )}

      {closed.length === 0 ? (
        selectedBatch ? (
          <EmptyState
            title={`${selectedBatch.name} has no closed exams`}
            description="Marks appear here once an exam's window has ended. Until then, follow the paper from the exams page."
            action={
              <Button asChild variant="secondary">
                <Link href="/admin/reports">Show all classes</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No closed exams yet"
            description="Once a published exam's window ends, its marks show up here — class by class, ready to download as Excel."
            action={
              <Button asChild>
                <Link href="/admin/exams">Go to exams</Link>
              </Button>
            }
          />
        )
      ) : (
        dayGroups.map((day) => (
          <Card key={day.key} className="mb-6">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-muted-foreground" />
                  {formatDate(day.date)}
                </CardTitle>
                <CardDescription>
                  {day.exams.length} closed{" "}
                  {day.exams.length === 1 ? "exam" : "exams"} on this date
                </CardDescription>
              </div>
            </CardHeader>
            <Table>
              <thead>
                <tr>
                  <Th>Exam</Th>
                  <Th>Class</Th>
                  <Th>Appeared</Th>
                  <Th>Average</Th>
                  <Th>Highest</Th>
                  <Th className="text-right">Marks</Th>
                </tr>
              </thead>
              <tbody>
                {day.exams.map((exam) => {
                  const stats = statsByExam.get(exam.id);
                  const maxScore = maxScoreByExam.get(exam.id) ?? 0;
                  const appeared = stats?._count._all ?? 0;
                  const average =
                    Math.round((stats?._avg.totalScore ?? 0) * 100) / 100;
                  const highest = stats?._max.totalScore ?? 0;

                  return (
                    <tr key={exam.id}>
                      <Td>
                        <p className="font-medium">{exam.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Closed {formatDate(exam.endsAt)}
                        </p>
                      </Td>
                      {/* The class names itself on the row now that the card no
                          longer does, and links to that class's own workbook. */}
                      <Td>
                        <Link
                          href={`/admin/reports?batch=${exam.batch.id}`}
                          className="text-primary hover:underline"
                        >
                          {exam.batch.name}
                        </Link>
                      </Td>
                      <Td className="tabular-nums">
                        {appeared} / {exam.batch._count.students}
                        {appeared === 0 && (
                          <Badge tone="warning" className="ml-2">
                            nobody sat
                          </Badge>
                        )}
                      </Td>
                      <Td className="tabular-nums text-muted-foreground">
                        {average} / {maxScore}
                      </Td>
                      <Td className="font-semibold tabular-nums text-success">
                        {highest} / {maxScore}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-2">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/admin/exams/${exam.id}/results`}>
                              <ListChecks /> View results
                            </Link>
                          </Button>
                          <Button asChild variant="secondary" size="sm">
                            <a href={`/api/admin/exams/${exam.id}/results-export`}>
                              <Download /> Excel
                            </a>
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        ))
      )}
    </>
  );
}
