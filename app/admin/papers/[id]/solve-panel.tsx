"use client";

import { HelpCircle, Lightbulb, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { solveSavedQuestions } from "../actions";
import { SettleQuestion, type DisagreeingQuestion } from "./settle-form";

/** Matches the upload screen: small enough to stay well inside a request. */
const BATCH = 6;

export type UnsolvedQuestion = DisagreeingQuestion & {
  /**
   * What the model said when it worked on this one and could not answer.
   * Empty when it has never been tried.
   */
  note: string;
};

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
  questions: UnsolvedQuestion[];
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(0);
  const [writing, setWriting] = useState<Record<string, boolean>>({});

  // A question the model already declined to answer is normally one whose
  // equation lives in an image it cannot see, and it will not see it next time
  // either. Re-running those spends money to be told the same thing.
  const untried = questions.filter((q) => !q.note);

  function solveAll() {
    startTransition(async () => {
      setDone(0);
      for (let i = 0; i < untried.length; i += BATCH) {
        const slice = untried.slice(i, i + BATCH);
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
        `${untried.length} question(s) worked on. Read them through — anything ` +
          `that disagrees with your key is flagged for settling.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {configured && untried.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={solveAll} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Lightbulb />}
            {pending
              ? `Working out ${done}/${untried.length}…`
              : `Work out ${untried.length} solution(s)`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Each question is solved from the question and its options alone,
            without being shown your answer key — so it can, and sometimes should,
            disagree with it.
          </span>
        </div>
      ) : configured ? (
        <Alert tone="info">
          Every remaining question has already been worked on and could not be
          answered — see the note against each. Running them again would cost
          money to be told the same thing, so write these yourself.
        </Alert>
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
          <div key={q.id} className="border-t border-border pt-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
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
            {q.note && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
                <HelpCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>Could not be worked out: {q.note}</span>
              </p>
            )}
          </div>
        ),
      )}
    </div>
  );
}
