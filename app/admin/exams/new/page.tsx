import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ExamForm } from "../exam-form";

export const metadata = { title: "Create exam · Admin" };

export default async function NewExamPage() {
  await requireAdmin();

  const [batches, subjects] = await Promise.all([
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

  return (
    <>
      <PageHeader
        title="Create exam"
        description="Set the details, then upload the question paper — both steps happen here."
        actions={
          <Button asChild variant="ghost">
            <Link href="/admin/exams">
              <ArrowLeft /> Back to exams
            </Link>
          </Button>
        }
      />

      {batches.length === 0 ? (
        <EmptyState
          title="Create a batch first"
          description="An exam is assigned to a batch, which decides who can sit it."
          action={
            <Button asChild>
              <Link href="/admin/batches">Go to batches</Link>
            </Button>
          }
        />
      ) : (
        <ExamForm batches={batches} subjects={subjects} />
      )}
    </>
  );
}
