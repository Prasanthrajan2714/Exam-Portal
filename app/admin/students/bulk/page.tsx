import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BulkUpload } from "./bulk-upload";

export const metadata = { title: "Bulk upload students · Admin" };

export default async function BulkUploadPage() {
  await requireAdmin();

  // The sheet references batches by name, so there must be at least one.
  const batchCount = await prisma.batch.count({ where: { active: true } });

  return (
    <>
      <PageHeader
        title="Bulk upload students"
        description="Import a whole class from an Excel sheet. Logins are generated and emailed automatically."
        actions={
          <Button asChild variant="ghost">
            <Link href="/admin/students">
              <ArrowLeft /> Back to students
            </Link>
          </Button>
        }
      />

      {batchCount === 0 ? (
        <EmptyState
          title="Create a batch first"
          description="The Batch column in your spreadsheet has to match an existing batch name, so create at least one batch before importing."
          action={
            <Button asChild>
              <Link href="/admin/batches">Go to batches</Link>
            </Button>
          }
        />
      ) : (
        <BulkUpload />
      )}
    </>
  );
}
