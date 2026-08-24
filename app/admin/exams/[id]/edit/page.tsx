import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toDateInputValue } from "@/lib/utils";
import { ExamForm } from "../../exam-form";

export const metadata = { title: "Edit exam · Admin" };

function timeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default async function EditExamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [exam, batches, subjects] = await Promise.all([
    prisma.exam.findUnique({
      where: { id },
      include: {
        examSubjects: { orderBy: { order: "asc" } },
        _count: { select: { attempts: true, questions: true } },
      },
    }),
    prisma.batch.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.subject.findMany({
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!exam) notFound();

  // Editing after students have sat the paper would invalidate their results,
  // so the action refuses it — don't even render the form.
  if (exam._count.attempts > 0) redirect(`/admin/exams/${id}`);

  return (
    <>
      <PageHeader
        title={`Edit ${exam.name}`}
        actions={
          <Button asChild variant="ghost">
            <Link href={`/admin/exams/${id}`}>
              <ArrowLeft /> Back to exam
            </Link>
          </Button>
        }
      />

      {exam.status === "PUBLISHED" && (
        <Alert tone="warning" className="mb-6">
          This exam is published. Changes take effect immediately on student
          dashboards.
        </Alert>
      )}

      <ExamForm
        batches={batches}
        subjects={subjects}
        initial={{
          id: exam.id,
          name: exam.name,
          batchId: exam.batchId,
          date: toDateInputValue(exam.startsAt),
          startTime: timeValue(exam.startsAt),
          endTime: timeValue(exam.endsAt),
          durationMinutes: exam.durationMinutes,
          marksPerCorrect: exam.marksPerCorrect,
          negativeMarks: exam.negativeMarks,
          resultVisibility: exam.resultVisibility,
          medium: exam.medium,
          subjects: exam.examSubjects.map((s) => ({
            subjectId: s.subjectId,
            questionCount: s.questionCount,
          })),
          subjectsLocked: exam._count.questions > 0,
        }}
      />
    </>
  );
}
