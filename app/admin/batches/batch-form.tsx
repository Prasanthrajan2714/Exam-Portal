"use client";

import { Loader2, Pencil, Plus } from "lucide-react";
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
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/action-result";
import { createBatch, updateBatch } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}

export function BatchFormDialog({
  batch,
}: {
  batch?: { id: string; name: string; description: string | null };
}) {
  const editing = Boolean(batch);
  const [open, setOpen] = useState(false);

  // Success handling lives inside the action rather than in an effect watching
  // its result — an effect would fire a cascading render on every state change.
  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      const result = await (editing ? updateBatch : createBatch)(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Saved");
        setOpen(false);
      }
      return result;
    },
    { ok: false },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> New batch
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit batch" : "Create batch or class"}</DialogTitle>
          <DialogDescription>
            Batches group students and decide who can sit each exam — for example
            “IIT Batch”, “Class 6” or “NEET Repeaters”.
          </DialogDescription>
        </DialogHeader>

        {/* key resets the uncontrolled inputs each time the dialog reopens */}
        <form action={formAction} className="space-y-4" key={String(open)}>
          {batch && <input type="hidden" name="id" value={batch.id} />}

          {!state.ok && state.message && (
            <Alert tone="danger">{state.message}</Alert>
          )}

          <Field
            label="Batch or class name"
            htmlFor="name"
            required
            error={state.fieldErrors?.name}
          >
            <Input
              id="name"
              name="name"
              defaultValue={batch?.name}
              placeholder="e.g. Class 6 or IIT Batch"
              required
              autoFocus
            />
          </Field>

          <Field label="Description" htmlFor="description" hint="Optional.">
            <Textarea
              id="description"
              name="description"
              defaultValue={batch?.description ?? ""}
              placeholder="Anything that helps you recognise this batch later."
            />
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Submit label={editing ? "Save changes" : "Create batch"} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
