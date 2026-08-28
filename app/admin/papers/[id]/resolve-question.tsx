"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { solveSavedQuestions } from "../actions";

/**
 * Working one saved question out again.
 *
 * A solution argues about the options in front of it — "none of the four given
 * equations matches this" — so correcting one of those options leaves the
 * working describing a paper that no longer exists. The upload screen now
 * notices that and asks for the question to be redone before publishing, but a
 * paper already saved has no such record, and without this the only remedy for
 * one stale explanation is replacing the whole paper.
 *
 * Offered only while the exam is a draft nobody has sat, and only on demand:
 * solving costs money, so it is never done on the admin's behalf.
 */
export function ResolveQuestion({
  examId,
  questionId,
  number,
}: {
  examId: string;
  questionId: string;
  number: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function run() {
    startTransition(async () => {
      const result = await solveSavedQuestions({ examId, questionIds: [questionId] });
      if (!result.ok) {
        toast.error(result.message ?? "That question could not be solved.");
        return;
      }
      setDone(true);
      toast.success(
        `Question ${number} worked out again. Read it through — if it now disagrees with your key, it is flagged above.`,
      );
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={run} disabled={pending || done}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {done ? "Worked out" : "Work out again"}
    </Button>
  );
}
