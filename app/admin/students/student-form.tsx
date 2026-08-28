"use client";

import { Loader2, Pencil, UserPlus } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
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
import { phoneError } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";
import {
  type CreatedCredential,
  createStudent,
  previewUsername,
  updateStudent,
} from "./actions";
import { CredentialsPanel } from "./credentials-panel";

type BatchOption = { id: string; name: string };

type StudentValues = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  schoolName: string | null;
  batchId: string;
  username: string;
};

function Submit({ label, blocked = false }: { label: string; blocked?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}

export function StudentFormDialog({
  batches,
  student,
}: {
  batches: BatchOption[];
  student?: StudentValues;
}) {
  const editing = Boolean(student);
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <UserPlus /> Add student
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        {editing ? (
          <EditBody student={student!} batches={batches} onDone={() => setOpen(false)} />
        ) : (
          <CreateBody batches={batches} onClose={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- create

function CreateBody({
  batches,
  onClose,
}: {
  batches: BatchOption[];
  onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult<CreatedCredential>, FormData>(
    createStudent,
    { ok: false },
  );
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [edited, setEdited] = useState(false);
  // The batch is asked for first and gates the rest: which class a student is in
  // is the decision that matters, and a form filled in before it is chosen is a
  // form that has to be checked again afterwards.
  const [batchId, setBatchId] = useState("");
  const [phone, setPhone] = useState("");

  // Checked as it is typed, and again on the server — a nine-digit number is a
  // typo worth catching while the student is still standing there.
  const phoneProblem = phoneError(phone);
  const [, startTransition] = useTransition();

  // The roll number follows the batch, not the name: it says which class and
  // which session, and neither is knowable from what a student is called. The
  // admin can still type their own, and after that their choice wins.
  useEffect(() => {
    if (edited || !batchId) return;
    startTransition(async () => {
      const suggestion = await previewUsername(batchId);
      if (suggestion) setUsername(suggestion);
    });
  }, [batchId, edited, startTransition]);

  if (state.ok && state.data) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Student added</DialogTitle>
        </DialogHeader>
        <CredentialsPanel credential={state.data} />
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add student</DialogTitle>
        <DialogDescription>
          A roll number and password are generated from the batch. Copy the
          password before closing — it cannot be shown again.
        </DialogDescription>
      </DialogHeader>

      <form action={formAction} className="space-y-4">
        {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}

        <Field
          label="Batch or class"
          htmlFor="batchId"
          required
          error={state.fieldErrors?.batchId}
          hint="Chosen first: it decides which exams this student will see."
        >
          <Select
            id="batchId"
            name="batchId"
            required
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            autoFocus
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

        <Field label="Student name" htmlFor="name" required error={state.fieldErrors?.name}>
          <Input
            id="name"
            name="name"
            required
            disabled={!batchId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={batchId ? "e.g. Arjun Kumar" : "Choose a batch first"}
          />
        </Field>

        <Field
          label="Roll number"
          htmlFor="username"
          hint="The roll number, from the batch and its academic year. Change it if you prefer something else."
          error={state.fieldErrors?.username}
        >
          <Input
            id="username"
            name="username"
            value={username}
            onChange={(e) => {
              setEdited(true);
              setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""));
            }}
            disabled={!batchId}
            placeholder="generated automatically"
            className="font-mono"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Phone number"
            htmlFor="phone"
            error={phoneProblem ?? state.fieldErrors?.phone}
            hint="Ten digits."
          >
            <Input
              id="phone"
              name="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!batchId}
              placeholder="9876543210"
              inputMode="tel"
              className={cn(phoneProblem && "border-danger")}
            />
          </Field>
          <Field
            label="Email"
            htmlFor="email"
            error={state.fieldErrors?.email}
            hint="Optional."
          >
            <Input
              id="email"
              name="email"
              type="email"
              disabled={!batchId}
              placeholder="student@example.com"
            />
          </Field>
        </div>

        <Field label="School name" htmlFor="schoolName">
          <Input
            id="schoolName"
            name="schoolName"
            disabled={!batchId}
            placeholder="e.g. Kendriya Vidyalaya"
          />
        </Field>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          {/* A bad number cannot be saved. The server refuses it too, so this
              only saves the admin a round trip. */}
          <Submit label="Add student" blocked={!batchId || Boolean(phoneProblem)} />
        </DialogFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- edit

function EditBody({
  student,
  batches,
  onDone,
}: {
  student: StudentValues;
  batches: BatchOption[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(updateStudent, {
    ok: false,
  });
  // The same rule as the add form: a number already on file can be corrected
  // here, and correcting it into a nine-digit one should not be possible.
  const [phone, setPhone] = useState(student.phone ?? "");
  const phoneProblem = phoneError(phone);

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {student.name}</DialogTitle>
        <DialogDescription>
          Username{" "}
          <span className="font-mono font-medium text-foreground">
            {student.username}
          </span>{" "}
          cannot be changed — the student already signs in with it.
        </DialogDescription>
      </DialogHeader>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="id" value={student.id} />
        {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}

        <Field label="Student name" htmlFor="e-name" required error={state.fieldErrors?.name}>
          <Input id="e-name" name="name" defaultValue={student.name} required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Phone number"
            htmlFor="e-phone"
            error={phoneProblem ?? state.fieldErrors?.phone}
            hint="Ten digits."
          >
            <Input
              id="e-phone"
              name="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              className={cn(phoneProblem && "border-danger")}
            />
          </Field>
          <Field label="Email" htmlFor="e-email" error={state.fieldErrors?.email}>
            <Input
              id="e-email"
              name="email"
              type="email"
              defaultValue={student.email ?? ""}
            />
          </Field>
        </div>

        <Field label="School name" htmlFor="e-school">
          <Input id="e-school" name="schoolName" defaultValue={student.schoolName ?? ""} />
        </Field>

        <Field label="Batch or class" htmlFor="e-batch" required>
          <Select id="e-batch" name="batchId" defaultValue={student.batchId} required>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Submit label="Save changes" blocked={Boolean(phoneProblem)} />
        </DialogFooter>
      </form>
    </>
  );
}
