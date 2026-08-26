"use client";

import { FileText, Loader2, Upload } from "lucide-react";
import { useActionState, useState } from "react";
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
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/action-result";
import { NOTE_MAX_BYTES, formatFileSize, noteFileError } from "@/lib/note-file";
import { createNote } from "./actions";

type Option = { id: string; name: string };

function Submit({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending ? <Loader2 className="animate-spin" /> : <Upload />}
      Upload material
    </Button>
  );
}

export function NoteFormDialog({
  batches,
  subjects,
  defaultBatchId,
}: {
  batches: Option[];
  subjects: Option[];
  defaultBatchId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileProblem, setFileProblem] = useState<string | null>(null);

  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      const result = await createNote(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Uploaded");
        setFileName("");
        setFileProblem(null);
        setOpen(false);
      }
      return result;
    },
    { ok: false },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // The form resets on reopen; the message about the last file must go
        // with it, or it sits there condemning a file nobody chose.
        if (!next) setFileProblem(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Upload /> Upload material
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload study material</DialogTitle>
          <DialogDescription>
            Every student in the batch you choose will see this in their Study
            Notes as soon as you upload it. They can read and download it — they
            cannot change or remove it.
          </DialogDescription>
        </DialogHeader>

        {/* key resets the uncontrolled inputs each time the dialog reopens */}
        <form action={formAction} className="space-y-4" key={String(open)}>
          {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}

          <Field label="Title" htmlFor="title" required error={state.fieldErrors?.title}>
            <Input
              id="title"
              name="title"
              placeholder="e.g. Physics — Laws of Motion notes"
              required
              autoFocus
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Batch or class"
              htmlFor="batchId"
              required
              error={state.fieldErrors?.batchId}
            >
              <Select id="batchId" name="batchId" defaultValue={defaultBatchId ?? ""} required>
                <option value="" disabled>
                  Choose a batch
                </option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Subject"
              htmlFor="subjectId"
              hint="Optional — groups the material on the student's page."
              error={state.fieldErrors?.subjectId}
            >
              <Select id="subjectId" name="subjectId" defaultValue="">
                <option value="">No particular subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Description" htmlFor="description" hint="Optional.">
            <Textarea
              id="description"
              name="description"
              placeholder="What this covers, or which chapter it belongs to."
            />
          </Field>

          <Field label="PDF file" required error={fileProblem ?? state.fieldErrors?.file}>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-app)] border-2 border-dashed border-border-strong bg-surface-muted/50 px-6 py-6 text-center transition-colors hover:border-primary hover:bg-primary-soft/30">
              <FileText className="mb-2 size-7 text-muted-foreground" />
              <span className="font-medium">{fileName || "Choose a PDF"}</span>
              <span className="mt-1 text-xs text-muted-foreground">
                PDF only, up to {formatFileSize(NOTE_MAX_BYTES)}
              </span>
              <input
                type="file"
                name="file"
                accept="application/pdf,.pdf"
                required
                className="sr-only"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  setFileName(chosen?.name ?? "");
                  // Checked here because a file over the cap never reaches the
                  // server whole: the body is truncated in transit and the
                  // parser fails on a half a form, naming nothing useful.
                  setFileProblem(chosen ? noteFileError(chosen) : null);
                }}
              />
            </label>
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Submit blocked={Boolean(fileProblem)} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
