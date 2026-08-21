"use client";

import { CalendarDays, Clock, CopyPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
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
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { fail, type ActionResult } from "@/lib/action-result";
import { reusePaperForBatch } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <CopyPlus />}
      Create the draft
    </Button>
  );
}

export function ReusePaperDialog({
  examId,
  examName,
  batches,
}: {
  examId: string;
  examName: string;
  batches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [batchId, setBatchId] = useState("");
  const [name, setName] = useState(examName);
  const [nameEdited, setNameEdited] = useState(false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [duration, setDuration] = useState("30");

  // Same construction as the exam form: building the Date from parts keeps the
  // instant in the admin's own timezone, which is the wall-clock time they typed.
  const { startsAtISO, endsAtISO, windowMinutes } = useMemo(() => {
    if (!date || !startTime || !endTime) {
      return { startsAtISO: "", endsAtISO: "", windowMinutes: 0 };
    }
    const [y, m, d] = date.split("-").map(Number);
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const start = new Date(y, m - 1, d, sh, sm, 0, 0);
    const end = new Date(y, m - 1, d, eh, em, 0, 0);
    return {
      startsAtISO: start.toISOString(),
      endsAtISO: end.toISOString(),
      windowMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
    };
  }, [date, startTime, endTime]);

  const [state, formAction] = useActionState<ActionResult<{ examId: string }>, FormData>(
    async (previous, formData) => {
      // The date and time pickers feed the hidden startsAt/endsAt, so they carry
      // no name of their own. Left to the browser, a missing date blocks the
      // submit with nothing but a native tooltip — the button appears dead. Say
      // it in the dialog instead.
      if (!formData.get("startsAt") || !formData.get("endsAt")) {
        return fail("Choose the exam date and the times it opens and closes.", {
          startsAt: !date ? "Pick the date this exam runs." : "Set both times.",
        });
      }

      const result = await reusePaperForBatch(previous, formData);
      if (result.ok && result.data) {
        toast.success(result.message ?? "Draft created");
        setOpen(false);
        router.push(`/admin/exams/${result.data.examId}`);
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );

  function pickBatch(id: string) {
    setBatchId(id);
    if (nameEdited) return;
    const batch = batches.find((b) => b.id === id);
    setName(batch ? `${examName} — ${batch.name}` : examName);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <CopyPlus /> Use for another batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run this paper for another batch</DialogTitle>
          <DialogDescription>
            Every question, diagram and the marking scheme from{" "}
            <span className="font-medium text-foreground">{examName}</span> is
            copied onto a new exam for the batch you choose. The new exam starts
            as a <span className="font-medium text-foreground">draft</span>, so
            nothing is visible to students until you publish it. The original is
            left untouched.
          </DialogDescription>
        </DialogHeader>

        {/* noValidate: every required control here is validated by the action and
            reported in the Alert and under its own field. Leaving it to the
            browser hides a missing date behind a tooltip that is easy to miss. */}
        <form action={formAction} noValidate className="space-y-4">
          <input type="hidden" name="sourceExamId" value={examId} />
          <input type="hidden" name="startsAt" value={startsAtISO} />
          <input type="hidden" name="endsAt" value={endsAtISO} />

          {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}

          <Field
            label="Batch or class"
            htmlFor="reuse-batchId"
            required
            error={state.fieldErrors?.batchId}
            hint="Only this batch will see the new exam."
          >
            <Select
              id="reuse-batchId"
              name="batchId"
              required
              value={batchId}
              onChange={(e) => pickBatch(e.target.value)}
            >
              <option value="" disabled>
                Choose a batch…
              </option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="New exam name"
            htmlFor="reuse-name"
            required
            error={state.fieldErrors?.name}
          >
            <Input
              id="reuse-name"
              name="name"
              required
              value={name}
              onChange={(e) => {
                setNameEdited(true);
                setName(e.target.value);
              }}
            />
          </Field>

          <Field
            label="Exam date"
            htmlFor="reuse-date"
            required
            error={state.fieldErrors?.startsAt}
          >
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="reuse-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-9"
              />
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Opens at" htmlFor="reuse-startTime" required>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reuse-startTime"
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="pl-9"
                />
              </div>
            </Field>

            <Field
              label="Closes at"
              htmlFor="reuse-endTime"
              required
              error={state.fieldErrors?.endsAt}
            >
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reuse-endTime"
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="pl-9"
                />
              </div>
            </Field>

            <Field
              label="Duration (minutes)"
              htmlFor="reuse-durationMinutes"
              required
              error={state.fieldErrors?.durationMinutes}
              hint={
                windowMinutes > 0 ? `Window is ${windowMinutes} minutes long.` : undefined
              }
            >
              <Input
                id="reuse-durationMinutes"
                name="durationMinutes"
                type="number"
                min={1}
                max={600}
                required
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </Field>
          </div>

          {windowMinutes > 0 && Number(duration) > windowMinutes && (
            <Alert tone="warning">
              The duration is longer than the window. A student starting at{" "}
              {startTime} would be cut off at {endTime} — widen the window or
              shorten the duration.
            </Alert>
          )}

          <p className="text-xs text-muted-foreground">
            Marks per correct answer, negative marking and the result-visibility
            setting are copied from {examName}. You can change them on the new
            exam before publishing it.
          </p>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
