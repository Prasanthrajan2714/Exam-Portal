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

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
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
  const [, startTransition] = useTransition();

  // Generate the username from the name as it's typed, until the admin edits it
  // by hand — after that their choice wins.
  useEffect(() => {
    if (edited) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const suggestion = await previewUsername(name);
        if (suggestion) setUsername(suggestion);
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [name, edited, startTransition]);

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
          A username and password are generated automatically and emailed if an
          address is given.
        </DialogDescription>
      </DialogHeader>

      <form action={formAction} className="space-y-4">
        {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}

        <Field label="Student name" htmlFor="name" required error={state.fieldErrors?.name}>
          <Input
            id="name"
            name="name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Arjun Kumar"
          />
        </Field>

        <Field
          label="Username"
          htmlFor="username"
          hint="Generated from the name. Change it if you prefer something else."
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
            placeholder="generated automatically"
            className="font-mono"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone number" htmlFor="phone" error={state.fieldErrors?.phone}>
            <Input id="phone" name="phone" placeholder="9876543210" inputMode="tel" />
          </Field>
          <Field
            label="Email"
            htmlFor="email"
            error={state.fieldErrors?.email}
            hint="Credentials are emailed here."
          >
            <Input id="email" name="email" type="email" placeholder="student@example.com" />
          </Field>
        </div>

        <Field label="School name" htmlFor="schoolName">
          <Input id="schoolName" name="schoolName" placeholder="e.g. Kendriya Vidyalaya" />
        </Field>

        <Field
          label="Batch or class"
          htmlFor="batchId"
          required
          error={state.fieldErrors?.batchId}
          hint="Decides which exams this student will see."
        >
          <Select id="batchId" name="batchId" required defaultValue="">
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

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Submit label="Add student" />
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
          <Field label="Phone number" htmlFor="e-phone" error={state.fieldErrors?.phone}>
            <Input id="e-phone" name="phone" defaultValue={student.phone ?? ""} />
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
          <Submit label="Save changes" />
        </DialogFooter>
      </form>
    </>
  );
}
