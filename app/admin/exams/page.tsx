import { FileText, FileUp, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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

export default async function ExamsPage() {
  await requireAdmin();

  const exams = await prisma.exam.findMany({
    orderBy: [{ startsAt: "desc" }],
    include: {
      batch: { select: { name: true } },
      examSubjects: { include: { subject: { select: { name: true } } }, orderBy: { order: "asc" } },
      _count: { select: { questions: true, attempts: true } },
    },
  });

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

      {exams.length === 0 ? (
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
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Exam</Th>
                <Th>Batch</Th>
                <Th>Schedule</Th>
                <Th>Paper</Th>
                <Th>Attempts</Th>
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
                      <p className="text-xs text-muted-foreground">
                        {exam.examSubjects.map((s) => s.subject.name).join(" · ")}
                      </p>
                    </Td>
                    <Td className="text-muted-foreground">{exam.batch.name}</Td>
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
                    <Td className="tabular-nums text-muted-foreground">
                      {exam._count.attempts}
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
  );
}
