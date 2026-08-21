import { Clock, MessageSquare } from "lucide-react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { secondsRemaining } from "@/lib/exam-window";
import { formatDateTime } from "@/lib/utils";
import { ApproveButton, RejectButton } from "./request-actions";

export const metadata = { title: "Reopen requests · Admin" };
export const dynamic = "force-dynamic";

export default async function ReopenRequestsPage() {
  await requireAdmin();

  const [pending, resolved] = await Promise.all([
    prisma.reopenRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: {
        student: { select: { name: true, batch: { select: { name: true } } } },
        exam: { select: { name: true, endsAt: true, durationMinutes: true } },
        attempt: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            deadlineAt: true,
            reopenCount: true,
            _count: { select: { answers: true } },
          },
        },
      },
    }),
    prisma.reopenRequest.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { resolvedAt: "desc" },
      take: 25,
      include: {
        student: { select: { name: true } },
        exam: { select: { name: true } },
      },
    }),
  ]);

  const now = new Date();

  return (
    <>
      <PageHeader
        title="Reopen requests"
        description="Students whose exam was interrupted. Approving lets them continue from where they stopped."
      />

      {pending.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="When a student's exam is cut short by a power or internet problem, their request to resume appears here for you to validate."
        />
      ) : (
        <div className="space-y-4">
          {pending.map((request) => {
            const minutesLeft = Math.floor(
              secondsRemaining({ deadlineAt: request.attempt.deadlineAt }, now) / 60,
            );
            const windowMinutesLeft = Math.max(
              0,
              Math.floor((request.exam.endsAt.getTime() - now.getTime()) / 60_000),
            );
            const windowClosed = windowMinutesLeft <= 0;
            const alreadyFinished = request.attempt.status !== "IN_PROGRESS";

            return (
              <Card key={request.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{request.student.name}</h3>
                        <Badge tone="neutral">{request.student.batch.name}</Badge>
                        {request.attempt.reopenCount > 0 && (
                          <Badge tone="warning">
                            Reopened {request.attempt.reopenCount}× before
                          </Badge>
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        {request.exam.name}
                      </p>

                      <div className="mt-2 flex items-start gap-2 rounded-[var(--radius-app)] bg-surface-muted p-3">
                        <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <p className="text-sm">{request.reason}</p>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Requested {formatDateTime(request.createdAt)}</span>
                        <span>Started {formatDateTime(request.attempt.startedAt)}</span>
                        <span>{request.attempt._count.answers} answer(s) saved</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" />
                          {minutesLeft > 0
                            ? `${minutesLeft} min left on their timer`
                            : "their timer has run out"}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      {alreadyFinished ? (
                        <div className="text-right text-xs text-muted-foreground">
                          <p>This attempt has already been graded.</p>
                          <RejectButton
                            requestId={request.id}
                            studentName={request.student.name}
                          />
                        </div>
                      ) : windowClosed ? (
                        <div className="text-right text-xs text-danger">
                          <p className="mb-1">The exam window has closed.</p>
                          <RejectButton
                            requestId={request.id}
                            studentName={request.student.name}
                          />
                        </div>
                      ) : (
                        <>
                          <ApproveButton
                            requestId={request.id}
                            studentName={request.student.name}
                            minutesLeft={minutesLeft}
                            windowMinutesLeft={windowMinutesLeft}
                          />
                          <RejectButton
                            requestId={request.id}
                            studentName={request.student.name}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Recently handled</CardTitle>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Exam</Th>
                <Th>Decision</Th>
                <Th>Extra time</Th>
                <Th>Note</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((request) => (
                <tr key={request.id}>
                  <Td className="font-medium">{request.student.name}</Td>
                  <Td className="text-muted-foreground">{request.exam.name}</Td>
                  <Td>
                    <Badge tone={request.status === "APPROVED" ? "success" : "danger"}>
                      {request.status === "APPROVED" ? "Approved" : "Rejected"}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums text-muted-foreground">
                    {request.grantExtraMinutes > 0
                      ? `+${request.grantExtraMinutes} min`
                      : "—"}
                  </Td>
                  <Td className="max-w-xs text-xs text-muted-foreground">
                    <span className="line-clamp-2">{request.adminNote || "—"}</span>
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {request.resolvedAt ? formatDateTime(request.resolvedAt) : "—"}
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
