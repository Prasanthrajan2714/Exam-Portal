"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  FileSpreadsheet,
  Languages,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { QuestionImage } from "@/components/question-image";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Stat,
} from "@/components/ui/primitives";
import { nothingToTranslate, stillEnglish } from "@/lib/translation-review";
import { cn } from "@/lib/utils";
import {
  type DraftPaper,
  type DraftQuestion,
  type TranslatedQuestion,
  parsePaper,
  publishPaper,
  translateQuestions,
} from "./actions";

type OptionKey = "A" | "B" | "C" | "D";
const OPTIONS: OptionKey[] = ["A", "B", "C", "D"];

/**
 * Questions per translation request.
 *
 * Small enough that the admin sees the counter move every few seconds and that
 * a failure costs at most a dozen questions; large enough that a 180-question
 * paper is fifteen requests rather than a hundred and eighty.
 */
const TRANSLATION_BATCH = 12;

export function PaperUploader({
  examId,
  examName,
  medium,
  redirectTo,
}: {
  examId: string;
  examName: string;
  /** Tamil papers get a translation step before saving. */
  medium: "ENGLISH" | "TAMIL";
  /** Where to go after a successful save. Defaults to `/admin/papers/<examId>`. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const isTamil = medium === "TAMIL";
  const [draft, setDraft] = useState<DraftPaper | null>(null);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paperName, setPaperName] = useState("");
  const [keyName, setKeyName] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Tamil, keyed by the question's index. Translation is slow and costs money,
  // so nothing is translated twice: a run only ever picks up what is missing.
  const [translations, setTranslations] = useState<Record<number, TranslatedQuestion>>({});
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [batches, setBatches] = useState<{ done: number; total: number } | null>(null);

  const blocking = useMemo(
    () =>
      questions.filter(
        (q) => !q.correctOption || !q.text || OPTIONS.some((k) => !optionValue(q, k) && !hasImage(q, k)),
      ),
    [questions],
  );

  /** Never translated — this is what a run, or a retry, works through. */
  const notRun = useMemo(
    () => (isTamil ? questions.filter((q) => !translations[q.index]) : []),
    [isTamil, questions, translations],
  );

  /** Not translated, or translated and then left blank. Blocks saving either way. */
  const untranslated = useMemo(
    () => (isTamil ? questions.filter((q) => tamilMissing(q, translations[q.index])) : []),
    [isTamil, questions, translations],
  );

  function onParse(formData: FormData) {
    setError(null);
    formData.set("examId", examId);
    startTransition(async () => {
      const result = await parsePaper(formData);
      if (!result.ok || !result.data) {
        setError(result.message ?? "Could not read that document.");
        return;
      }
      setDraft(result.data);
      setQuestions(result.data.questions);
      // A new document is a new paper — last upload's Tamil does not apply.
      setTranslations({});
      setTranslateError(null);
      setBatches(null);
      toast.success(result.message ?? "Document read");
    });
  }

  /**
   * Translates everything that has no Tamil yet, a batch at a time.
   *
   * Runs only when the admin asks for it, and stops at the first failed batch:
   * whatever went wrong (no API key, a refused request, a timeout) is going to
   * go wrong for the next fourteen batches too, and firing them anyway would
   * bury the message and spend the money. Everything already translated stays,
   * so pressing the button again resumes rather than restarts.
   */
  function onTranslate() {
    const pending = notRun;
    if (pending.length === 0) return;

    const runs = chunk(pending, TRANSLATION_BATCH);
    setTranslateError(null);
    setTranslating(true);
    setBatches({ done: 0, total: runs.length });

    void (async () => {
      try {
        for (const [i, run] of runs.entries()) {
          const result = await translateQuestions({
            examId,
            questions: run.map((q) => ({
              index: q.index,
              subjectName: q.subjectName,
              text: q.text,
              optionA: q.optionA,
              optionB: q.optionB,
              optionC: q.optionC,
              optionD: q.optionD,
            })),
          });

          if (!result.ok || !result.data) {
            setTranslateError(result.message ?? "That batch could not be translated.");
            return;
          }

          const done = result.data.translations;
          setTranslations((prev) => {
            const next = { ...prev };
            for (const t of done) next[t.index] = t;
            return next;
          });
          setBatches({ done: i + 1, total: runs.length });
        }
        toast.success(
          `${pending.length} question(s) translated. Check the Tamil below before saving.`,
        );
      } finally {
        setTranslating(false);
      }
    })();
  }

  function onPublish(publish: boolean) {
    if (publish && blocking.length > 0) {
      toast.error(
        `${blocking.length} question(s) still need attention before publishing.`,
      );
      return;
    }
    if (untranslated.length > 0) {
      toast.error(
        `${untranslated.length} question(s) are still only in English. Translate the whole paper first.`,
      );
      return;
    }
    startTransition(async () => {
      const result = await publishPaper({
        examId,
        publish,
        questions: questions.map((q) => {
          // A Tamil paper is stored translated — the students read one
          // language — with the English kept underneath.
          const tamil = isTamil ? translations[q.index] : undefined;
          return {
            subjectName: q.subjectName,
            number: q.number,
            text: tamil ? tamil.text : q.text,
            optionA: tamil ? tamil.optionA : q.optionA,
            optionB: tamil ? tamil.optionB : q.optionB,
            optionC: tamil ? tamil.optionC : q.optionC,
            optionD: tamil ? tamil.optionD : q.optionD,
            sourceText: tamil ? q.text : null,
            sourceOptionA: tamil ? q.optionA : null,
            sourceOptionB: tamil ? q.optionB : null,
            sourceOptionC: tamil ? q.optionC : null,
            sourceOptionD: tamil ? q.optionD : null,
            correctOption: q.correctOption!,
            marks: q.marks,
            negativeMarks: q.negativeMarks,
            images: q.images,
          };
        }),
      });
      if (!result.ok) {
        toast.error(result.message ?? "Could not save the paper.");
        return;
      }
      toast.success(result.message ?? "Saved");
      router.push(redirectTo ?? `/admin/papers/${examId}`);
      router.refresh();
    });
  }

  function update(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((prev) =>
      prev.map((q) => (q.index === index ? { ...q, ...patch } : q)),
    );
  }

  function updateTranslation(index: number, patch: Partial<TranslatedQuestion>) {
    setTranslations((prev) => {
      const current = prev[index];
      if (!current) return prev;
      return { ...prev, [index]: { ...current, ...patch } };
    });
  }

  // ------------------------------------------------------------- upload step
  if (!draft) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Upload the paper</CardTitle>
          </CardHeader>
          <CardBody>
            {error && (
              <Alert tone="danger" className="mb-4">
                {error}
              </Alert>
            )}

            <form ref={formRef} action={onParse} className="space-y-4">
              <FilePicker
                name="paper"
                accept=".docx"
                icon={<FileText className="mb-3 size-8 text-muted-foreground" />}
                label={paperName || "Question paper (.docx)"}
                hint="The Word document with the questions"
                onChange={setPaperName}
                required
              />

              <FilePicker
                name="answerKey"
                accept=".xlsx"
                icon={<FileSpreadsheet className="mb-3 size-8 text-muted-foreground" />}
                label={keyName || "Answer key (.xlsx)"}
                hint="Which option is correct for each question"
                onChange={setKeyName}
                required
              />

              <Button type="submit" disabled={pending || !paperName}>
                {pending ? <Loader2 className="animate-spin" /> : <Upload />}
                Read the documents
              </Button>
              <p className="text-xs text-muted-foreground">
                Nothing is saved yet. You will review every question that was
                understood before it goes anywhere near your students.
                {isTamil &&
                  " This paper is set in Tamil: upload the English document, then" +
                    " translate and check the Tamil in the next step."}
              </p>
            </form>
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Start from the templates</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Both templates are pre-filled with {examName}&apos;s own subjects and
              question numbering.
            </p>
            <Button asChild variant="secondary" className="w-full">
              <a href={`/api/templates/paper?examId=${examId}`}>
                <Download /> Question paper template
              </a>
            </Button>
            <Button asChild variant="secondary" className="w-full">
              <a href={`/api/templates/answer-key?examId=${examId}`}>
                <Download /> Answer key template
              </a>
            </Button>

            <div className="rounded-[var(--radius-app)] bg-surface-muted p-3 font-mono text-xs leading-relaxed">
              [SUBJECT: Physics]
              <br />
              1. Question text here
              <br />
              A) option one
              <br />
              B) option two
              <br />
              C) option three
              <br />
              D) option four
            </div>

            <p className="text-xs text-muted-foreground">
              Diagrams pasted into the Word file are extracted automatically.
              Superscripts and subscripts are preserved.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------- review step
  return (
    <>
      <div className={cn("mb-4 grid gap-4 sm:grid-cols-3", isTamil && "lg:grid-cols-4")}>
        <Stat label="Questions read" value={questions.length} />
        <Stat
          label="Ready to publish"
          value={questions.length - blocking.length}
          tone="success"
        />
        <Stat
          label="Need attention"
          value={blocking.length}
          tone={blocking.length > 0 ? "danger" : undefined}
        />
        {isTamil && (
          <Stat
            label="Translated"
            value={`${questions.length - untranslated.length} / ${questions.length}`}
            tone={untranslated.length > 0 ? "danger" : "success"}
            icon={<Languages />}
          />
        )}
      </div>

      {isTamil && (
        <TranslationPanel
          total={questions.length}
          remaining={notRun.length}
          translating={translating}
          batches={batches}
          error={translateError}
          onTranslate={onTranslate}
        />
      )}

      {/* Reconciliation against the exam's declared structure */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Does this match the exam?</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {draft.subjectCounts.map((s) => (
            <div
              key={s.subjectName}
              className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-2 text-sm"
            >
              <span className="font-medium">{s.subjectName}</span>
              <span className={s.matched ? "text-success" : "text-danger"}>
                {s.parsed} found · {s.expected} expected
                {s.matched ? " ✓" : ""}
              </span>
            </div>
          ))}

          {draft.unmatchedSubjects.length > 0 && (
            <Alert tone="danger" title="Unknown subjects in the document">
              {draft.unmatchedSubjects.join(", ")} — these are not part of this
              exam. Fix the [SUBJECT: …] headings, or add the subject to the exam
              before publishing.
            </Alert>
          )}
        </CardBody>
      </Card>

      {(draft.warnings.length > 0 || draft.keyErrors.length > 0) && (
        <Alert tone="warning" className="mb-4" title="Notes from reading your files">
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
            {draft.keyErrors.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {draft.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      {blocking.length > 0 && (
        <Alert tone="danger" className="mb-4" title={`${blocking.length} question(s) need attention`}>
          Fill in anything missing below. Questions with problems are outlined in
          red — you can edit every field here, so there is no need to go back to
          Word for small fixes.
        </Alert>
      )}

      <div className="space-y-4">
        {questions.map((q) => (
          <QuestionEditor
            key={q.index}
            question={q}
            showTamil={isTamil}
            translation={translations[q.index]}
            onChange={(patch) => update(q.index, patch)}
            onTranslationChange={(patch) => updateTranslation(q.index, patch)}
          />
        ))}
      </div>

      {/* ------------------------------------------------------- publish bar */}
      <Card className="sticky bottom-4 mt-6 shadow-lg">
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          {untranslated.length > 0 ? (
            <p className="text-sm text-danger">
              {untranslated.length} of {questions.length} question(s) have no Tamil,
              or have a Tamil field left blank. The paper cannot be saved until
              every one is complete.
            </p>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={pending || translating}
              onClick={() => {
                setDraft(null);
                setQuestions([]);
                setTranslations({});
                setTranslateError(null);
                setBatches(null);
                setPaperName("");
                setKeyName("");
                formRef.current?.reset();
              }}
            >
              <ArrowLeft /> Upload different files
            </Button>
            <Button
              variant="secondary"
              disabled={pending || translating || untranslated.length > 0}
              onClick={() => onPublish(false)}
            >
              Save as draft
            </Button>
            <Button
              disabled={
                pending || translating || blocking.length > 0 || untranslated.length > 0
              }
              onClick={() => onPublish(true)}
            >
              {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              Publish to students
            </Button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- pieces

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The translate step. Deliberately a button and not something that happens on
 * its own: a paper is a few minutes of the model's time, and it should be the
 * admin who decides when to spend it.
 */
function TranslationPanel({
  total,
  remaining,
  translating,
  batches,
  error,
  onTranslate,
}: {
  total: number;
  remaining: number;
  translating: boolean;
  batches: { done: number; total: number } | null;
  error: string | null;
  onTranslate: () => void;
}) {
  const translated = total - remaining;
  const started = translated > 0;
  const percent = total === 0 ? 0 : Math.round((translated / total) * 100);

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Tamil translation</CardTitle>
        <Badge tone={remaining === 0 ? "success" : started ? "warning" : "neutral"}>
          {remaining === 0 ? "All questions translated" : `${remaining} to go`}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Technical terms come from this subject&apos;s glossary and are used
          exactly as the board writes them; the rest of each sentence is
          translated. Numbers, formulae and the order of the options are left
          alone. Check every question below before saving — you can edit the
          Tamil directly.
        </p>

        {(translating || started) && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {translated} of {total} translated
                {translating && batches
                  ? ` · batch ${Math.min(batches.done + 1, batches.total)} of ${batches.total}`
                  : ""}
              </span>
              <span className="tabular-nums">{percent}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-muted"
              role="progressbar"
              aria-valuenow={translated}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label="Questions translated"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <Alert tone="danger" title="The translation stopped">
            {error}
            {remaining > 0 && (
              <span className="mt-1 block text-xs">
                The {translated} question(s) already translated have been kept.
                Fix the problem and retry the remaining {remaining}.
              </span>
            )}
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={translating || remaining === 0} onClick={onTranslate}>
            {translating ? (
              <Loader2 className="animate-spin" />
            ) : started ? (
              <RefreshCw />
            ) : (
              <Languages />
            )}
            {translating
              ? "Translating…"
              : remaining === 0
                ? "Everything is translated"
                : started
                  ? `Retry the remaining ${remaining}`
                  : `Translate ${total} question(s) to Tamil`}
          </Button>
          {translating && (
            <span className="text-xs text-muted-foreground">
              This takes a few minutes for a full paper — leave this page open.
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function optionValue(q: DraftQuestion, key: OptionKey): string {
  return key === "A" ? q.optionA : key === "B" ? q.optionB : key === "C" ? q.optionC : q.optionD;
}

function hasImage(q: DraftQuestion, target: "STEM" | OptionKey): boolean {
  return q.images.some((i) => i.target === target);
}

function QuestionEditor({
  question,
  showTamil,
  translation,
  onChange,
  onTranslationChange,
}: {
  question: DraftQuestion;
  showTamil: boolean;
  translation?: TranslatedQuestion;
  onChange: (patch: Partial<DraftQuestion>) => void;
  onTranslationChange: (patch: Partial<TranslatedQuestion>) => void;
}) {
  const missingAnswer = !question.correctOption;
  const needsTamil = showTamil && tamilMissing(question, translation);
  const hasProblem =
    missingAnswer ||
    !question.text ||
    OPTIONS.some((k) => !optionValue(question, k) && !hasImage(question, k));

  const stemImages = question.images.filter((i) => i.target === "STEM");

  return (
    <Card className={cn((hasProblem || needsTamil) && "border-danger")}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="flex items-center gap-2">
          <Badge tone={question.subjectName ? "primary" : "danger"}>
            {question.subjectName || "No subject"}
          </Badge>
          <span className="text-sm font-semibold">Question {question.number}</span>
        </div>
        {hasProblem ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle className="size-3.5" /> Needs attention
          </span>
        ) : needsTamil ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <Languages className="size-3.5" /> Not translated
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-success">
            <CheckCircle2 className="size-3.5" /> Ready
          </span>
        )}
      </CardHeader>

      <CardBody className="space-y-3">
        {question.issues.length > 0 && (
          <p className="text-xs text-danger">{question.issues.join(" · ")}</p>
        )}

        <Field
          label={showTamil ? "Question (English original)" : "Question"}
          htmlFor={`q-${question.index}`}
        >
          <Textarea
            id={`q-${question.index}`}
            value={question.text}
            onChange={(e) => onChange({ text: e.target.value })}
            className={cn(!question.text && stemImages.length === 0 && "border-danger")}
          />
        </Field>

        {stemImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stemImages.map((img) => (
              <ImageThumb key={img.path} image={img} />
            ))}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map((key) => {
            const value = optionValue(question, key);
            const images = question.images.filter((i) => i.target === key);
            const selected = question.correctOption === key;
            return (
              <div
                key={key}
                className={cn(
                  "rounded-[var(--radius-app)] border p-2 transition-colors",
                  selected ? "border-success bg-success-soft/40" : "border-border",
                )}
              >
                <label className="mb-1.5 flex items-center gap-2 text-xs font-medium">
                  <input
                    type="radio"
                    name={`answer-${question.index}`}
                    checked={selected}
                    onChange={() => onChange({ correctOption: key })}
                    className="size-3.5 accent-[var(--success)]"
                  />
                  Option {key}
                  {selected && <span className="text-success">· correct</span>}
                </label>
                <Input
                  value={value}
                  onChange={(e) =>
                    onChange({ [`option${key}`]: e.target.value } as Partial<DraftQuestion>)
                  }
                  className={cn("h-8 text-sm", !value && images.length === 0 && "border-danger")}
                  placeholder={`Option ${key}`}
                />
                {images.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {images.map((img) => (
                      <ImageThumb key={img.path} image={img} small />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {showTamil && (
          <TamilReview
            index={question.index}
            english={question}
            translation={translation}
            onChange={onTranslationChange}
          />
        )}

        {missingAnswer && (
          <p className="text-xs font-medium text-danger">
            Choose which option is correct — this question has no answer key entry.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The Tamil, under the English it came from, and editable.
 *
 * This is what actually reaches the students, so it gets the same treatment the
 * parsed English gets: every field can be corrected here. The glossary terms
 * that were pinned for this question are listed so the admin can see which
 * terminology was enforced rather than having to infer it.
 */
/**
 * An option that is only digits, symbols and units has nothing to translate —
 * "9.6 × 10⁻² m" is the same in every language. Identical Tamil there is
 * correct, but it reads as a failure unless the screen says so.
 */
function TamilReview({
  index,
  english,
  translation,
  onChange,
}: {
  index: number;
  english: DraftQuestion;
  translation?: TranslatedQuestion;
  onChange: (patch: Partial<TranslatedQuestion>) => void;
}) {
  if (!translation) {
    return (
      <div className="rounded-[var(--radius-app)] border border-dashed border-danger/60 bg-danger-soft/20 px-3 py-2 text-xs text-danger">
        No Tamil yet. Run the translation above — this paper cannot be saved
        while any question is still only in English.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-app)] border border-primary/40 bg-primary-soft/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary-ink">
          தமிழ் · what the students will read
        </span>
        <span className="text-xs text-muted-foreground">Edit anything that reads wrong</span>
      </div>

      <Field
        label="Question (Tamil)"
        htmlFor={`ta-${index}`}
        error={
          stillEnglish(english.text, translation.text)
            ? "This came back in English. Retranslate the paper or write the Tamil yourself."
            : undefined
        }
      >
        <Textarea
          id={`ta-${index}`}
          value={translation.text}
          onChange={(e) => onChange({ text: e.target.value })}
          className={cn(
            (!translation.text || stillEnglish(english.text, translation.text)) &&
              "border-danger",
          )}
        />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((key) => {
          const value = tamilOption(translation, key);
          const source = optionValue(english, key);
          // Numbers and units are identical in both languages, so an unchanged
          // option here is the correct result — say so, or it reads as a miss.
          const passthrough = nothingToTranslate(source) && value.trim() === source.trim();
          return (
            <Field
              key={key}
              label={`Option ${key} (Tamil)`}
              htmlFor={`ta-${index}-${key}`}
              hint={passthrough ? "Nothing to translate — kept as it is" : undefined}
              error={
                stillEnglish(source, value)
                  ? "Still in English"
                  : undefined
              }
            >
              <Input
                id={`ta-${index}-${key}`}
                value={value}
                onChange={(e) =>
                  onChange({ [`option${key}`]: e.target.value } as Partial<TranslatedQuestion>)
                }
                className={cn(
                  "h-8 text-sm",
                  !value && "border-danger",
                  stillEnglish(source, value) && "border-danger",
                )}
              />
            </Field>
          );
        })}
      </div>

      {translation.termsUsed.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Glossary terms used ({translation.termsUsed.length}):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {translation.termsUsed.map((t) => (
              <Badge key={t.term} tone="info">
                {t.term} → {t.tamil}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function tamilOption(t: TranslatedQuestion, key: OptionKey): string {
  return key === "A" ? t.optionA : key === "B" ? t.optionB : key === "C" ? t.optionC : t.optionD;
}

/**
 * A question still needs Tamil if it was never translated, or if a field the
 * English fills has been left blank — an emptied option would reach a student
 * as a missing choice, which is worse than an untranslated one.
 */
function tamilMissing(q: DraftQuestion, t: TranslatedQuestion | undefined): boolean {
  if (!t) return true;
  if (q.text.trim() && !t.text.trim()) return true;
  return OPTIONS.some((k) => optionValue(q, k).trim() && !tamilOption(t, k).trim());
}

function ImageThumb({
  image,
  small,
}: {
  image: DraftQuestion["images"][number];
  small?: boolean;
}) {
  return (
    <QuestionImage
      image={image}
      alt="Question diagram"
      fallbackWidth={small ? 90 : 220}
      fallbackHeight={small ? 90 : 220}
    />
  );
}

function FilePicker({
  name,
  accept,
  icon,
  label,
  hint,
  onChange,
  required,
}: {
  name: string;
  accept: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onChange: (name: string) => void;
  required?: boolean;
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-app)] border-2 border-dashed border-border-strong bg-surface-muted/50 px-6 py-8 text-center transition-colors hover:border-primary hover:bg-primary-soft/30">
      {icon}
      <span className="font-medium">{label}</span>
      <span className="mt-1 text-sm text-muted-foreground">{hint}</span>
      <input
        type="file"
        name={name}
        accept={accept}
        required={required}
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0]?.name ?? "")}
      />
    </label>
  );
}
