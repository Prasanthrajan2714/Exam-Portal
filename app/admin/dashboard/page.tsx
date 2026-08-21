import { BookOpen, Layers, RotateCcw, Users } from "lucide-react";
import Link from "next/link";
import { AttemptOutcomesChart, StudentsPerBatchChart } from "./charts";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardBody,
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
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { examPhase } from "@/lib/exam-window";
import { formatDate, formatTime } from "@/lib/utils";

export const metadata = { title: "Dashboard · Admin" };

export default async function AdminDashboard() {
  await requireAdmin();

  const [
    batchCount,
    studentCount,
    examCount,
    pendingReopens,
    upcoming,
    batches,
    recentExams,
    attemptGroups,
  ] = await Promise.all([
    prisma.batch.count({ where: { active: true } }),
    prisma.student.count({ where: { status: "ACTIVE" } }),
    prisma.exam.count({ where: { status: "PUBLISHED" } }),
    prisma.reopenRequest.count({ where: { status: "PENDING" } }),
    prisma.exam.findMany({
      where: { status: "PUBLISHED", endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 6,
      include: {
        batch: true,
        _count: { select: { questions: true, attempts: true } },
      },
    }),
    prisma.batch.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        _count: { select: { students: { where: { status: "ACTIVE" } } } },
      },
    }),
    // The five most recently scheduled exams, newest first, so the chart
    // shows what is actually being run rather than the whole history.
    prisma.exam.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { startsAt: "desc" },
      take: 5,
      select: { id: true, name: true },
    }),
    prisma.attempt.groupBy({
      by: ["examId", "status"],
      _count: { _all: true },
    }),
  ]);

  const batchChartData = batches
    .map((batch) => ({
      id: batch.id,
      name: batch.name,
      count: batch._count.students,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const attemptChartData = recentExams
    .map((exam) => {
      const groups = attemptGroups.filter((g) => g.examId === exam.id);
      const countOf = (status: (typeof groups)[number]["status"]) =>
        groups.find((g) => g.status === status)?._count._all ?? 0;
      return {
        id: exam.id,
        name: exam.name,
        submitted: countOf("SUBMITTED"),
        inProgress: countOf("IN_PROGRESS"),
        expired: countOf("EXPIRED"),
      };
    })
    // Oldest at the top, so the rows read down in schedule order.
    .reverse();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of batches, students and scheduled examinations."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active batches" value={batchCount} icon={<Layers />} />
        <Stat label="Active students" value={studentCount} icon={<Users />} />
        <Stat label="Published exams" value={examCount} icon={<BookOpen />} />
        <Stat
          label="Reopen requests"
          value={pendingReopens}
          tone={pendingReopens > 0 ? "danger" : undefined}
          hint={pendingReopens > 0 ? "Awaiting your approval" : "Nothing pending"}
          icon={<RotateCcw />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming and running exams</CardTitle>
        </CardHeader>
        {upcoming.length === 0 ? (
          <CardBody>
            {/* No create-exam call to action here: exams are created from
                the exams section, not from this overview. */}
            <EmptyState
              title="No exams scheduled"
              description="Create a batch, add students and schedule an exam to run your first examination."
            />
          </CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Exam</Th>
                <Th>Batch</Th>
                <Th>Window</Th>
                <Th>Questions</Th>
                <Th>Attempts</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((exam) => {
                const phase = examPhase(exam);
                return (
                  <tr key={exam.id}>
                    <Td>
                      <Link
                        href={`/admin/exams/${exam.id}`}
                        className="font-medium text-primary-ink hover:underline"
                      >
                        {exam.name}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground">{exam.batch.name}</Td>
                    {/* Both ends of the window: when it opens on its own says
                        nothing about how long students have to turn up. */}
                    <Td className="text-muted-foreground">
                      <p>{formatDate(exam.startsAt)}</p>
                      <p className="text-xs">
                        {formatTime(exam.startsAt)} – {formatTime(exam.endsAt)}
                      </p>
                    </Td>
                    <Td className="tabular-nums">
                      {exam._count.questions}
                    </Td>
                    <Td className="tabular-nums">{exam._count.attempts}</Td>
                    <Td>
                      <Badge
                        tone={
                          phase === "OPEN"
                            ? "success"
                            : phase === "UPCOMING"
                              ? "info"
                              : "neutral"
                        }
                      >
                        {phase === "OPEN"
                          ? "Live now"
                          : phase === "UPCOMING"
                            ? "Scheduled"
                            : "Closed"}
                      </Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active students per batch</CardTitle>
            <CardDescription>Top 6 batches by enrolment.</CardDescription>
          </CardHeader>
          <CardBody>
            <StudentsPerBatchChart data={batchChartData} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attempts by outcome</CardTitle>
            <CardDescription>
              The five most recently scheduled exams.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <AttemptOutcomesChart data={attemptChartData} />
          </CardBody>
        </Card>
      </div>

      {pendingReopens > 0 && (
        <Card className="mt-6 border-warning">
          <CardBody className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <RotateCcw className="size-5 text-warning" />
              <div>
                <p className="font-medium">
                  {pendingReopens} student
                  {pendingReopens === 1 ? "" : "s"} waiting to resume an exam
                </p>
                <p className="text-sm text-muted-foreground">
                  Their exam was interrupted. Approve to let them continue from
                  where they stopped.
                </p>
              </div>
            </div>
            <Button asChild variant="secondary">
              <Link href="/admin/reopen-requests">Review</Link>
            </Button>
          </CardBody>
        </Card>
      )}
    </>
  );
}

