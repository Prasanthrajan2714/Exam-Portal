"use client";

import { KeyRound, Loader2 } from "lucide-react";
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
import { type CreatedCredential, resetStudentPassword } from "./actions";
import { CredentialsPanel } from "./credentials-panel";

export function ResetPasswordButton({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [credential, setCredential] = useState<CreatedCredential | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await resetStudentPassword(studentId);
      if (result.ok && result.data) setCredential(result.data);
      else toast.error(result.message ?? "Could not reset the password");
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCredential(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title="Reset password"
          aria-label={`Reset password for ${studentName}`}
        >
          <KeyRound />
        </Button>
      </DialogTrigger>
      <DialogContent>
        {credential ? (
          <>
            <DialogHeader>
              <DialogTitle>New password generated</DialogTitle>
            </DialogHeader>
            <CredentialsPanel credential={credential} />
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reset password for {studentName}?</DialogTitle>
              <DialogDescription>
                A new password is generated and emailed to the student if they
                have an address on file. Their old password stops working
                immediately, so do this only if they have actually lost it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary" disabled={pending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button onClick={run} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Generate new password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
