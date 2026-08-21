"use client";

import {
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  PlayCircle,
  RotateCcw,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Alert, Badge, Card, CardBody } from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/action-result";
import type { ExamCardStatus } from "@/lib/exam-window";
import { beginExam, requestReopen } from "./actions";

export type ExamCardData = {
  examId: string;
  attemptId: string | null;
  name: string;
  subjects: string[];
  questionCount: number;
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarks: number;
  windowLabel: string;
  dateLabel: string;
  status: ExamCardStatus;
  resultAvailable: boolean;
  totalScore: number | null;
  maxScore: number;
};

const STATUS_META: Record<
  ExamCardStatus,
  { label: string; tone: "neutral" | "success" | "info" | "warning" | "danger" | "review" }
> = {
  UPCOMING: { label: "Scheduled", tone: "info" },
  AVAILABLE: { label: "Available now", tone: "success" },
  IN_PROGRESS: { label: "In progress", tone: "warning" },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "review" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  MISSED: { label: "Missed", tone: "danger" },
};

export function ExamCard({ exam }: { exam: ExamCardData }) {
  const [pending, startTransition] = useTransition();
  const meta = STATUS_META[exam.status];

  function begin() {
    startTransition(async () => {
      // On success this redirects, so anything returned here is a refusal.
      const result = await beginExam(exam.examId);
      if (result && !result.ok) toast.error(result.message ?? "Could not start.");
    });
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{exam.name}</h3>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            {exam.subjects.join(" · ")}
          </p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" /> {exam.dateLabel}, {exam.windowLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> {exam.durationMinutes} minutes
            </span>
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3.5" /> {exam.questionCount} questions
            </span>
            <span>
              +{exam.marksPerCorrect} / −{exam.negativeMarks}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {exam.status === "AVAILABLE" && (
            <Button onClick={begin} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <PlayCircle />}
              Start exam
            </Button>
          )}

          {exam.status === "IN_PROGRESS" && (
            <>
              <Button asChild>
                <Link href={`/exam/${exam.attemptId}`}>
                  <PlayCircle /> Continue
                </Link>
              </Button>
              <ReopenDialog examId={exam.examId} examName={exam.name} />
            </>
          )}

          {exam.status === "AWAITING_APPROVAL" && (
            <div className="text-right">
              <p className="inline-flex items-center gap-1.5 text-sm text-review">
                <RotateCcw className="size-4" /> Waiting for your administrator
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Refresh once approved
              </p>
            </div>
          )}

          {exam.status === "COMPLETED" &&
            (exam.resultAvailable ? (
              <>
                <Button asChild variant="secondary">
                  <Link href={`/student/results/${exam.attemptId}`}>
                    <CheckCircle2 /> View result
                  </Link>
                </Button>
                {exam.totalScore !== null && (
                  <p className="text-right text-sm font-semibold tabular-nums">
                    {exam.totalScore} / {exam.maxScore}
                  </p>
                )}
              </>
            ) : (
              <p className="text-right text-xs text-muted-foreground">
                Submitted. Your result will appear once the exam window closes.
              </p>
            ))}

          {exam.status === "UPCOMING" && (
            <p className="text-right text-xs text-muted-foreground">
              Opens {exam.dateLabel} at {exam.windowLabel.split(" – ")[0]}
            </p>
          )}

          {exam.status === "MISSED" && (
            <p className="inline-flex items-center gap-1.5 text-right text-xs text-danger">
              <XCircle className="size-3.5" /> The window closed before you started
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- reopen

function ReopenSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      Send request
    </Button>
  );
}

function ReopenDialog({ examId, examName }: { examId: string; examName: string }) {
  const [open, setOpen] = useState(false);

  // Handled in the action rather than an effect watching its result, which
  // would cascade a render on every state change.
  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      const result = await requestReopen(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Request sent");
        setOpen(false);
      }
      return result;
    },
    { ok: false },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <RotateCcw /> Request to resume
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request to resume {examName}</DialogTitle>
          <DialogDescription>
            If your exam was interrupted by a power cut or an internet problem,
            tell your administrator what happened. Once they approve, you will
            continue from exactly where you stopped — your saved answers are
            still there.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="examId" value={examId} />
          {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}

          <Field label="What happened?" htmlFor="reason" required>
            <Textarea
              id="reason"
              name="reason"
              required
              autoFocus
              placeholder="e.g. The power went out at my house about 10 minutes into the exam and the page closed."
            />
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <ReopenSubmit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
