"use client";

import { Check, Loader2, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { QuestionText, type PlacedImage } from "@/components/question-text";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/action-result";
import { editQuestion } from "../actions";

type OptionKey = "A" | "B" | "C" | "D";
const OPTIONS: OptionKey[] = ["A", "B", "C", "D"];

export type EditableQuestion = {
  id: string;
  number: number;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: OptionKey | null;
  solution: string | null;
  images: (PlacedImage & { target: string })[];
};

function Submit({ number }: { number: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Check />}
      Save question {number}
    </Button>
  );
}

/**
 * Correcting one saved question rather than replacing the whole paper.
 *
 * A parser reading someone else's Word document gets things slightly wrong —
 * a stray character, an option that ran onto the next line, a key mistyped in
 * the spreadsheet. Without this the only remedy is re-uploading, which discards
 * every other question's worked solution to fix a typo in one.
 *
 * The images are not editable here and are shown where they fall, because the
 * `[[#n]]` markers in the text are what place them: an admin needs to see what
 * they are editing around.
 */
export function EditQuestion({ question }: { question: EditableQuestion }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [text, setText] = useState(question.text);
  const [options, setOptions] = useState<Record<OptionKey, string>>({
    A: question.optionA,
    B: question.optionB,
    C: question.optionC,
    D: question.optionD,
  });
  const [answer, setAnswer] = useState<OptionKey>(question.correctOption ?? "A");
  const [solution, setSolution] = useState(question.solution ?? "");

  // Folding the form away belongs to the save, not to a render that noticed the
  // save afterwards — an effect that calls setState runs a beat late and fights
  // with React's own scheduling.
  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (previous, formData) => {
      const result = await editQuestion(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Saved");
        setOpen(false);
        router.refresh();
      } else if (result.message) {
        toast.error(result.message);
      }
      return result;
    },
    { ok: false },
  );

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </Button>
    );
  }

  const reworded =
    text !== question.text ||
    OPTIONS.some((k) => options[k] !== question[`option${k}` as const]);

  return (
    <form action={formAction} className="mt-3 space-y-3 border-t border-border pt-3">
      <input type="hidden" name="questionId" value={question.id} />
      <input type="hidden" name="correctOption" value={answer} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Editing question {question.number}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <X /> Cancel
        </Button>
      </div>

      <Field label="Question" htmlFor={`edit-text-${question.id}`} error={state.fieldErrors?.text}>
        <Textarea
          id={`edit-text-${question.id}`}
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-24"
        />
      </Field>

      {/* Where the diagrams and equations fall in what is being typed. The
          [[#n]] markers in the box above are what put them there. */}
      <div className="rounded-[var(--radius-app)] border border-border bg-surface px-3 py-2">
        <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
          How it will read
        </p>
        <QuestionText
          text={text}
          images={question.images.filter((i) => i.target === "STEM")}
          alt="Part of the question"
          fallbackWidth={280}
          fallbackHeight={210}
          className="block text-sm leading-relaxed"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((key) => (
          <Field key={key} label={`Option ${key}`} htmlFor={`edit-${key}-${question.id}`}>
            <Input
              id={`edit-${key}-${question.id}`}
              name={`option${key}`}
              value={options[key]}
              onChange={(e) => setOptions((prev) => ({ ...prev, [key]: e.target.value }))}
              className="h-8 text-sm"
            />
          </Field>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Correct answer" htmlFor={`edit-answer-${question.id}`}>
          <Select
            id={`edit-answer-${question.id}`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value as OptionKey)}
            className="h-8 text-sm"
          >
            {OPTIONS.map((k) => (
              <option key={k} value={k}>
                Option {k}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Worked solution"
        htmlFor={`edit-sol-${question.id}`}
        hint="Leave it empty to have it worked out again."
      >
        <Textarea
          id={`edit-sol-${question.id}`}
          name="solution"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          className="min-h-24"
        />
      </Field>

      {reworded && question.solution && (
        <Alert tone="warning">
          The working was written about the wording you have just changed, so it
          stops counting as a check on this question. Publishing will ask for it
          to be settled again.
        </Alert>
      )}

      <Submit number={question.number} />
    </form>
  );
}
