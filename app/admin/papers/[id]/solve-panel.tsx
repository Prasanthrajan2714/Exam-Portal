"use client";

import { Lightbulb, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { solveSavedQuestions } from "../actions";
import { SettleQuestion, type DisagreeingQuestion } from "./settle-form";

/** Matches the upload screen: small enough to stay well inside a request. */
const BATCH = 6;

/**
 * Solutions for a paper that is already saved.
 *
 * The upload screen can solve a paper on its way in, but a draft saved without
 * solutions had no route to them afterwards — publishing refused it for want of
 * something nothing offered to produce. Everything here works from the stored
 * questions, so it stays reachable however long after the upload.
 */
export function SolvePanel({
  examId,
  questions,
  configured,
}: {
  examId: string;
  questions: DisagreeingQuestion[];
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(0);
  const [writing, setWriting] = useState<Record<string, boolean>>({});

  function solveAll() {
    startTransition(async () => {
      setDone(0);
      for (let i = 0; i < questions.length; i += BATCH) {
        const slice = questions.slice(i, i + BATCH);
        const result = await solveSavedQuestions({
          examId,
          questionIds: slice.map((q) => q.id),
        });
        if (!result.ok) {
          toast.error(result.message ?? "That batch could not be solved.");
          // Whatever landed before the failure is saved, so show it.
          router.refresh();
          return;
        }
        setDone((n) => n + slice.length);
      }
      toast.success(
        `${questions.length} question(s) worked out. Read them through — ` +
          `anything that disagrees with your key is flagged for settling.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {configured ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={solveAll} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Lightbulb />}
            {pending
              ? `Working out ${done}/${questions.length}…`
              : `Work out ${questions.length} solution(s)`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Each question is solved from the question and its options alone,
            without being shown your answer key — so it can, and sometimes should,
            disagree with it.
          </span>
        </div>
      ) : (
        <Alert tone="info">
          Working out solutions needs an Anthropic API key. Set ANTHROPIC_API_KEY
          in .env and restart the server, or write the solutions by hand below.
        </Alert>
      )}

      {questions.map((q) =>
        writing[q.id] ? (
          <SettleQuestion key={q.id} question={q} />
        ) : (
          <div
            key={q.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm"
          >
            <span>
              <span className="font-semibold">Q{q.number}</span>{" "}
              <span className="text-muted-foreground">
                {q.subjectName} · key says {q.correctOption}
              </span>
            </span>
            {/* Writing one by hand has to stay possible: without it an
                unreachable API leaves the paper permanently unpublishable. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWriting((prev) => ({ ...prev, [q.id]: true }))}
            >
              Write one myself
            </Button>
          </div>
        ),
      )}
    </div>
  );
}
