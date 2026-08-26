"use client";

import { RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { PaperUploader } from "../paper-uploader";

/**
 * Uploading a different document over a draft that already has one.
 *
 * Offered only while the exam is a draft nobody has sat: replacing a paper
 * students have answered would leave their marked answers pointing at questions
 * that no longer exist. Kept behind a click because the ordinary reason to open
 * this page is to read the paper, not to throw it away.
 */
export function ReplacePaper({
  examId,
  examName,
  medium,
  questionCount,
}: {
  examId: string;
  examName: string;
  medium: "ENGLISH" | "TAMIL";
  questionCount: number;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        <RefreshCw /> Replace paper
      </Button>
    );
  }

  return (
    <div className="mb-6 space-y-4 rounded-[var(--radius-app)] border border-border-strong bg-surface-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Replace the question paper</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <X /> Cancel
        </Button>
      </div>

      <Alert tone="warning">
        Saving a new document discards the {questionCount} question(s) on file,
        along with their answer key and worked solutions. Nothing changes until
        you save.
      </Alert>

      <PaperUploader examId={examId} examName={examName} medium={medium} />
    </div>
  );
}
