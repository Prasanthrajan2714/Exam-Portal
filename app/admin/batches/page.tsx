import { Power, PowerOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
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
import { deleteBatch, setBatchActive } from "./actions";
import { BatchFormDialog } from "./batch-form";

export const metadata = { title: "Batches · Admin" };

export default async function BatchesPage() {
  await requireAdmin();

  const batches = await prisma.batch.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { students: true, exams: true } } },
  });

  return (
    <>
      <PageHeader
        title="Batches & classes"
        description="Every student and every exam belongs to a batch. Create these first."
        actions={<BatchFormDialog />}
      />

      {batches.length === 0 ? (
        <EmptyState
          title="No batches yet"
          description="Start by creating a batch such as “Class 6” or “IIT Batch”. You can then add students to it and schedule exams."
          action={<BatchFormDialog />}
        />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Students</Th>
                <Th>Exams</Th>
                <Th>Created</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className={batch.active ? "" : "opacity-60"}>
                  <Td>
                    <p className="font-medium">{batch.name}</p>
                    {batch.description && (
                      <p className="text-xs text-muted-foreground">
                        {batch.description}
                      </p>
                    )}
                  </Td>
                  <Td className="tabular-nums">
                    {batch._count.students > 0 ? (
                      <Link
                        href={`/admin/students?batch=${batch.id}`}
                        className="text-primary hover:underline"
                      >
                        {batch._count.students}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </Td>
                  <Td className="tabular-nums text-muted-foreground">
                    {batch._count.exams}
                  </Td>
                  <Td className="text-muted-foreground">
                    {formatDate(batch.createdAt)}
                  </Td>
                  <Td>
                    <Badge tone={batch.active ? "success" : "neutral"}>
                      {batch.active ? "Active" : "Inactive"}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <BatchFormDialog batch={batch} />

                      {batch.active ? (
                        <ConfirmButton
                          variant="ghost"
                          size="sm"
                          title={`Deactivate ${batch.name}?`}
                          description="Its students keep their accounts and results, but you will not be able to schedule new exams for this batch until it is reactivated."
                          confirmLabel="Deactivate"
                          confirmVariant="danger"
                          action={setBatchActive.bind(null, batch.id, false)}
                        >
                          <PowerOff /> Deactivate
                        </ConfirmButton>
                      ) : (
                        <ConfirmButton
                          variant="ghost"
                          size="sm"
                          title={`Reactivate ${batch.name}?`}
                          description="The batch becomes available again for new exams."
                          confirmLabel="Reactivate"
                          confirmVariant="success"
                          action={setBatchActive.bind(null, batch.id, true)}
                        >
                          <Power /> Reactivate
                        </ConfirmButton>
                      )}

                      <ConfirmButton
                        variant="ghost"
                        size="sm"
                        title={`Delete ${batch.name}?`}
                        description="This cannot be undone. Batches that already have students or exams cannot be deleted — deactivate them instead."
                        confirmLabel="Delete"
                        action={deleteBatch.bind(null, batch.id)}
                      >
                        <Trash2 />
                      </ConfirmButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
