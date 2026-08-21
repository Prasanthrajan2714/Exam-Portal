"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
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
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { approveReopen, rejectReopen } from "./actions";

export function ApproveButton({
  requestId,
  studentName,
  minutesLeft,
  windowMinutesLeft,
}: {
  requestId: string;
  studentName: string;
  minutesLeft: number;
  windowMinutesLeft: number;
}) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState("0");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await approveReopen(requestId, Number(extra) || 0, note);
      if (result.ok) {
        toast.success(result.message ?? "Approved");
        setOpen(false);
      } else {
        toast.error(result.message ?? "Could not approve");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="success">
          <Check /> Approve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Let {studentName} continue?</DialogTitle>
          <DialogDescription>
            They will resume from exactly where they stopped — every answer they
            saved is still there.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert tone="info">
            {minutesLeft > 0 ? (
              <>
                They have <strong>{minutesLeft} minute(s)</strong> left on their
                own timer.
              </>
            ) : (
              <>
                Their timer has already run out. Grant extra time below, or they
                will be submitted immediately on re-entry.
              </>
            )}{" "}
            The exam window closes in <strong>{windowMinutesLeft} minute(s)</strong>,
            and no extension can run past that.
          </Alert>

          <Field
            label="Extra time to grant (minutes)"
            htmlFor="extra"
            hint="Use this to make up for the time they lost. 0 gives them only whatever remained."
          >
            <Input
              id="extra"
              type="number"
              min={0}
              max={180}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </Field>

          <Field label="Note (optional)" htmlFor="note">
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Confirmed power cut with the centre supervisor."
            />
          </Field>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="success" onClick={run} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Approve and reopen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RejectButton({
  requestId,
  studentName,
}: {
  requestId: string;
  studentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await rejectReopen(requestId, note);
      if (result.ok) {
        toast.success(result.message ?? "Rejected");
        setOpen(false);
      } else {
        toast.error(result.message ?? "Could not reject");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <X /> Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {studentName}&apos;s request?</DialogTitle>
          <DialogDescription>
            Their exam stays closed and will be graded on the answers saved
            before the interruption.
          </DialogDescription>
        </DialogHeader>

        <Field label="Reason (optional)" htmlFor="reject-note">
          <Textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Recorded against the request for your own reference."
          />
        </Field>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="danger" onClick={run} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Reject request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
