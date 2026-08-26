"use client";

import { Download } from "lucide-react";
import { useState } from "react";
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
import { Alert } from "@/components/ui/primitives";

/**
 * Downloading a finished paper as a Word document.
 *
 * The choice is asked rather than defaulted because the two files are for
 * different rooms: one is a paper to sit, the other gives every answer away.
 * Offered only once the exam has closed — before that a document is the easiest
 * thing in the world to forward to a batch that has not sat it yet.
 */
export function DownloadPaper({
  examId,
  examName,
}: {
  examId: string;
  examName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Download /> Download
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download &ldquo;{examName}&rdquo;</DialogTitle>
          <DialogDescription>
            A Word document of the paper as it was sat. Choose whether the worked
            solutions come with it.
          </DialogDescription>
        </DialogHeader>

        <Alert tone="warning">
          The copy with solutions marks the correct option on every question.
          Hand that one out only after the batch has finished with the paper.
        </Alert>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button asChild variant="secondary" onClick={() => setOpen(false)}>
            <a href={`/api/admin/papers/${examId}/download`}>
              <Download /> Questions only
            </a>
          </Button>
          <Button asChild onClick={() => setOpen(false)}>
            <a href={`/api/admin/papers/${examId}/download?solutions=1`}>
              <Download /> With solutions
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
