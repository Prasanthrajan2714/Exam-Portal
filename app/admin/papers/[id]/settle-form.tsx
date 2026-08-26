"use client";

import { Check, Loader2, Scale } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Formula } from "@/components/formula";
import { QuestionText, type PlacedImage } from "@/components/question-text";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { settleQuestion } from "../actions";

type OptionKey = "A" | "B" | "C" | "D";
const OPTIONS: OptionKey[] = ["A", "B", "C", "D"];

export type DisagreeingQuestion = {
  id: string;
  number: number;
  subjectName: string;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: OptionKey;
  /** Null when the question has never been worked out. */
  solvedOption: OptionKey | null;
  solution: string;
  /** Diagrams and equations from the document, by where they belong. */
  images: (PlacedImage & { target: "STEM" | OptionKey })[];
};

function Submit({ number, unsolved }: { number: number; unsolved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Check />}
      {unsolved ? `Save question ${number}` : `Settle question ${number}`}
    </Button>
  );
}

/**
 * One question where the uploaded answer key and the worked solution reached
 * different options.
 *
 * There is a single control for the answer, not one for the key and another for
 * the working. The admin's job here is to decide which option is actually
 * correct; having to set two fields to the same value would be busywork, and
 * setting them to different values is the state this whole screen exists to
 * clear.
 */
export function SettleQuestion({ question }: { question: DisagreeingQuestion }) {
  const router = useRouter();
  const unsolved = question.solvedOption === null;
  const [answer, setAnswer] = useState<OptionKey>(
    question.solvedOption ?? question.correctOption,
  );
  const [solution, setSolution] = useState(question.solution);

  const [state, formAction] = useActionState<ActionResult, FormData>(
    settleQuestion,
    { ok: false },
  );

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Settled");
      router.refresh();
    } else if (state.message) {
      toast.error(state.message);
    }
  }, [state, router]);

  const texts: Record<OptionKey, string> = {
    A: question.optionA,
    B: question.optionB,
    C: question.optionC,
    D: question.optionD,
  };

  const stemImages = question.images.filter((i) => i.target === "STEM");

  return (
    <form action={formAction} className="space-y-4 border-t border-border pt-4">
      <input type="hidden" name="questionId" value={question.id} />
      {/* The action refuses a mismatch, so both carry the one chosen answer. */}
      <input type="hidden" name="correctOption" value={answer} />
      <input type="hidden" name="solvedOption" value={answer} />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{question.subjectName}</Badge>
        <span className="text-sm font-semibold">Q{question.number}</span>
        <span className="text-xs text-muted-foreground">
          Key says {question.correctOption} ·{" "}
          {unsolved
            ? "no working yet"
            : `working arrives at ${question.solvedOption}`}
        </span>
      </div>

      {/* Without the images the question is unreadable here: a maths paper puts
          the whole relation in an equation image, leaving a stem like "If , then
          the value of r is" — and this screen exists precisely so the admin can
          judge the answer for themselves. */}
      <QuestionText
        text={question.text}
        images={stemImages}
        alt="Part of the question"
        fallbackWidth={320}
        fallbackHeight={240}
        className="block text-sm leading-relaxed"
      />

      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Which option is actually correct?
        </legend>
        {OPTIONS.map((key) => {
          const chosen = answer === key;
          return (
            <label
              key={key}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-app)] border px-3 py-2 text-sm transition-colors",
                chosen
                  ? "border-primary bg-primary-soft/40"
                  : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                checked={chosen}
                onChange={() => setAnswer(key)}
                className="mt-0.5 size-4 accent-[var(--primary)]"
                aria-label={`Option ${key}`}
              />
              <span className="font-semibold">{key}.</span>
              <QuestionText
                text={texts[key]}
                images={question.images.filter((i) => i.target === key)}
                alt={`Option ${key}`}
                fallbackWidth={200}
                fallbackHeight={150}
                className="flex-1"
              />
              <span className="flex shrink-0 gap-1">
                {question.correctOption === key && (
                  <Badge tone="neutral">your key</Badge>
                )}
                {question.solvedOption === key && (
                  <Badge tone="warning">the working</Badge>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      <Field
        label="The working students will read"
        htmlFor={`settle-sol-${question.id}`}
        hint={
          unsolved
            ? "Write out how the answer is reached. This is what the batch sees once the window closes, and a question cannot be published without it."
            : answer === question.correctOption
              ? "You have kept your key, so this working now contradicts it — rewrite it to explain the answer you chose."
              : "Read this through before accepting it; it is what the batch sees once the window closes."
        }
        error={state.fieldErrors?.solution}
      >
        <Textarea
          id={`settle-sol-${question.id}`}
          name="solution"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          className="min-h-32"
        />
      </Field>

      {solution.trim() && (
        <div className="rounded-[var(--radius-app)] border border-border bg-surface px-3 py-2">
          <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
            How students will read it
          </p>
          <Formula text={solution} className="block text-sm leading-relaxed" />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Submit number={question.number} unsolved={unsolved} />
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Scale className="size-3.5" />
          Sets both the answer key and the working to option {answer}.
        </span>
      </div>
    </form>
  );
}
