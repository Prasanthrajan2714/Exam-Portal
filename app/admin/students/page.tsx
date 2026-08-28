import { Ban, CheckCircle2, FileSpreadsheet, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
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
import { Pagination } from "@/components/pagination";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { resolvePage } from "@/lib/pagination";
import { formatDate, formatTime } from "@/lib/utils";
import { deleteStudent, setStudentStatus } from "./actions";
import { ResetPasswordButton } from "./reset-password-button";
import { StudentFormDialog } from "./student-form";

export const metadata = { title: "Students · Admin" };

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    batch?: string;
    status?: string;
    page?: string;
    perPage?: string;
  }>;
}) {
  await requireAdmin();
  const { q = "", batch = "", status = "", page: askedPage, perPage } = await searchParams;

  const batches = await prisma.batch.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Narrowed here rather than inside the object: spread into one, the literal
  // type is lost and Prisma will not take a bare string for an enum column.
  const statusFilter =
    status === "ACTIVE" || status === "DISABLED" ? status : null;

  const where: Prisma.StudentWhereInput = {
    ...(batch ? { batchId: batch } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { user: { username: { contains: q.toLowerCase() } } },
          ],
        }
      : {}),
  };

  // Counted against the same filters, so "of 340" is the number of students the
  // filters actually match rather than the number in the school.
  const total = await prisma.student.count({ where });
  const pageInfo = resolvePage(total, askedPage, perPage);

  const students = await prisma.student.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      user: { select: { username: true, lastLoginAt: true } },
      batch: { select: { id: true, name: true } },
      _count: { select: { attempts: true } },
    },
    skip: pageInfo.skip,
    take: pageInfo.take,
  });

  const noBatches = batches.length === 0;

  return (
    <>
      <PageHeader
        title="Students"
        description="Add students one at a time, or import a whole class from Excel."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/admin/students/bulk">
                <FileSpreadsheet /> Bulk upload
              </Link>
            </Button>
            {!noBatches && <StudentFormDialog batches={batches} />}
          </>
        }
      />

      {noBatches ? (
        <EmptyState
          title="Create a batch first"
          description="Every student belongs to a batch or class. Create one — for example “Class 6” — and then come back here."
          action={
            <Button asChild>
              <Link href="/admin/batches">Go to batches</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Plain GET form: filters live in the URL, so they survive a refresh
              and can be linked to from the batches page. */}
          <form
            method="get"
            className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-app)] border border-border bg-surface p-3"
          >
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search name, username, email or phone"
                className="pl-9"
                aria-label="Search students"
              />
            </div>
            <Select name="batch" defaultValue={batch} className="w-48" aria-label="Filter by batch">
              <option value="">All batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue={status} className="w-40" aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
            </Select>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {(q || batch || status) && (
              <Button asChild variant="ghost">
                <Link href="/admin/students">Clear</Link>
              </Button>
            )}
          </form>

          {students.length === 0 ? (
            <EmptyState
              title={q || batch || status ? "No students match those filters" : "No students yet"}
              description={
                q || batch || status
                  ? "Try a different search or clear the filters."
                  : "Add your first student, or import a class from an Excel sheet."
              }
              action={<StudentFormDialog batches={batches} />}
            />
          ) : (
            <Card>
              <Table>
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Username</Th>
                    <Th>Batch</Th>
                    <Th>Contact</Th>
                    <Th>Exams</Th>
                    <Th>Last sign-in</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className={s.status === "DISABLED" ? "opacity-60" : ""}>
                      <Td>
                        <p className="font-medium">{s.name}</p>
                        {s.schoolName && (
                          <p className="text-xs text-muted-foreground">{s.schoolName}</p>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">{s.user.username}</Td>
                      <Td className="text-muted-foreground">{s.batch.name}</Td>
                      <Td className="text-muted-foreground">
                        {s.email && <p className="text-xs">{s.email}</p>}
                        {s.phone && <p className="text-xs">{s.phone}</p>}
                        {!s.email && !s.phone && <span className="text-xs">—</span>}
                      </Td>
                      <Td className="tabular-nums text-muted-foreground">
                        {s._count.attempts}
                      </Td>
                      {/* Null until the account signs in once — every student
                          predates the column, so "Never" is the honest reading. */}
                      <Td>
                        {s.user.lastLoginAt ? (
                          <>
                            <p className="text-xs">{formatDate(s.user.lastLoginAt)}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatTime(s.user.lastLoginAt)}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Never</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={s.status === "ACTIVE" ? "success" : "danger"}>
                          {s.status === "ACTIVE" ? "Active" : "Disabled"}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-0.5">
                          <StudentFormDialog
                            batches={batches}
                            student={{
                              id: s.id,
                              name: s.name,
                              phone: s.phone,
                              email: s.email,
                              schoolName: s.schoolName,
                              batchId: s.batchId,
                              username: s.user.username,
                            }}
                          />
                          <ResetPasswordButton studentId={s.id} studentName={s.name} />

                          {s.status === "ACTIVE" ? (
                            <ConfirmButton
                              variant="ghost"
                              size="sm"
                              aria-label={`Disable ${s.name}`}
                              title={`Disable ${s.name}?`}
                              description="They will not be able to sign in or sit any exam until you re-enable them. Their existing results are kept."
                              confirmLabel="Disable"
                              action={setStudentStatus.bind(null, s.id, "DISABLED")}
                            >
                              <Ban />
                            </ConfirmButton>
                          ) : (
                            <ConfirmButton
                              variant="ghost"
                              size="sm"
                              aria-label={`Re-enable ${s.name}`}
                              title={`Re-enable ${s.name}?`}
                              description="They will be able to sign in and sit exams again."
                              confirmLabel="Re-enable"
                              confirmVariant="success"
                              action={setStudentStatus.bind(null, s.id, "ACTIVE")}
                            >
                              <CheckCircle2 />
                            </ConfirmButton>
                          )}

                          <ConfirmButton
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${s.name}`}
                            title={`Delete ${s.name}?`}
                            description="This permanently removes the student and their login. Students who have already attempted an exam cannot be deleted — disable them instead."
                            confirmLabel="Delete"
                            action={deleteStudent.bind(null, s.id)}
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

          {total > 0 && (
            <Pagination
              page={pageInfo}
              params={{ q, batch, status }}
              label="students"
            />
          )}
        </>
      )}
    </>
  );
}
