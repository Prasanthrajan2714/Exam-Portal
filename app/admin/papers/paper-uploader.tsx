"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  FileSpreadsheet,
  HelpCircle,
  Languages,
  Lightbulb,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Formula } from "@/components/formula";
import { QuestionText } from "@/components/question-text";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Stat,
} from "@/components/ui/primitives";
import { hasFraction } from "@/lib/fraction";
import { hasFormulaMarkup } from "@/lib/formula";
import { nothingToTranslate, stillEnglish } from "@/lib/translation-review";
import { cn } from "@/lib/utils";
import {
  type DraftPaper,
  type DraftQuestion,
  type SolvedQuestion,
  type TranslatedQuestion,
  parsePaper,
  publishPaper,
  solveQuestions,
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

/**
 * Questions per solving request.
 *
 * Half the translation batch, because solving is the slower and dearer job:
 * each question is worked out from scratch at high effort, so a batch is
 * minutes rather than seconds. Six keeps the progress bar moving often enough
 * that the admin can see it is alive, and keeps the cost of a failed batch to
 * six questions' worth of thinking.
 */
const SOLUTION_BATCH = 6;

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

  // Worked solutions, keyed by the question's index. Same rule as the Tamil:
  // solving costs money and minutes, so a run only picks up what is missing.
  const [solutions, setSolutions] = useState<Record<number, SolvedQuestion>>({});
  const [solving, setSolving] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [solveBatches, setSolveBatches] = useState<
    { done: number; total: number } | null
  >(null);

  /**
   * The wording each solution was written about.
   *
   * A solution argues about the options in front of it — 'none of the four
   * matches this' — so the moment one of them is corrected the working is about
   * a question that no longer exists. Keeping what it was written for is how
   * that is noticed; without it a stale explanation is published to students
   * beside the answer it contradicts.
   */
  const [solvedFor, setSolvedFor] = useState<Record<number, string>>({});

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

  /**
   * Solutions written about wording that has since been corrected.
   *
   * The one that prompted this argued "none of the four given equations matches
   * this" and named option C as a misprint. The admin then fixed option C —
   * making the working wrong about a paper it had been right about, while its
   * answer still agreed with the key, so nothing downstream would have caught
   * it.
   */
  const stale = useMemo(
    () =>
      questions.filter(
        (q) =>
          solutions[q.index] &&
          solvedFor[q.index] !== undefined &&
          solvedFor[q.index] !== wordingOf(q),
      ),
    [questions, solutions, solvedFor],
  );

  /**
   * Never solved, or solved for wording that has since changed — either way
   * this is what a run, or a retry, works through.
   */
  const notSolved = useMemo(
    () => questions.filter((q) => !solutions[q.index] || stale.includes(q)),
    [questions, solutions, stale],
  );

  /** No solution, or a solution the admin emptied. Blocks publishing either way. */
  const unsolved = useMemo(
    () => questions.filter((q) => !solutions[q.index]?.solution.trim()),
    [questions, solutions],
  );

  /**
   * The solution reached a different option from the answer key.
   *
   * This is the whole point of solving independently, and it is not a warning
   * to be waved past: either the key is wrong — and every student who answered
   * correctly would be marked down — or the solution is. The admin settles it.
   */
  const disagreeing = useMemo(
    () =>
      questions.filter((q) => {
        const solved = solutions[q.index];
        return Boolean(solved && q.correctOption && solved.answer !== q.correctOption);
      }),
    [questions, solutions],
  );

  /** Solved, but the model said it was unsure — usually an unseen diagram. */
  const unsure = useMemo(
    () => questions.filter((q) => solutions[q.index] && !solutions[q.index].confident),
    [questions, solutions],
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
      // A new document is a new paper — last upload's Tamil and solutions do
      // not apply to it.
      setTranslations({});
      setTranslateError(null);
      setBatches(null);
      setSolutions({});
      setSolvedFor({});
      setSolveError(null);
      setSolveBatches(null);
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

  /**
   * Works out every question that has no solution yet, a batch at a time.
   *
   * Same shape as the translation run, and for the same reasons: the admin
   * decides when to spend the model's time, the run stops at the first failed
   * batch rather than burning money on fourteen more that will fail the same
   * way, and everything already solved is kept so the button resumes instead of
   * starting over.
   *
   * The answer key is deliberately not sent. The model works the question out
   * and says which option it reached; if it were shown the key it would only
   * agree with it, and the check would be worth nothing.
   */
  function onSolve() {
    const todo = notSolved;
    if (todo.length === 0) return;

    const runs = chunk(todo, SOLUTION_BATCH);
    setSolveError(null);
    setSolving(true);
    setSolveBatches({ done: 0, total: runs.length });

    void (async () => {
      try {
        for (const [i, run] of runs.entries()) {
          const result = await solveQuestions({
            examId,
            questions: run.map((q) => ({
              index: q.index,
              subjectName: q.subjectName,
              // The English original, even on a Tamil paper: it is the wording
              // the board wrote, and solving a machine translation would stack
              // one model's mistakes on another's. The exam's medium decides
              // what language the solution comes back in.
              text: q.text,
              optionA: q.optionA,
              optionB: q.optionB,
              optionC: q.optionC,
              optionD: q.optionD,
              // A draft image has no order of its own yet; its index in this
              // list is the order it will be saved with, and what the [[#n]]
              // markers in the text already refer to.
              images: q.images.map((image, order) => ({
                target: image.target,
                order,
                path: image.path,
              })),
            })),
          });

          if (!result.ok || !result.data) {
            setSolveError(result.message ?? "That batch could not be solved.");
            return;
          }

          const done = result.data.solutions;
          setSolutions((prev) => {
            const next = { ...prev };
            for (const s of done) next[s.index] = s;
            return next;
          });
          setSolvedFor((prev) => {
            const next = { ...prev };
            for (const s of done) {
              const question = run.find((q) => q.index === s.index);
              if (question) next[s.index] = wordingOf(question);
            }
            return next;
          });
          setSolveBatches({ done: i + 1, total: runs.length });
        }
        toast.success(
          `${todo.length} question(s) worked out. Read the solutions below — ` +
            `especially any that disagree with your answer key.`,
        );
      } finally {
        setSolving(false);
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
    // Drafts are saved unsolved on purpose — upload today, solve tomorrow.
    if (publish && unsolved.length > 0) {
      toast.error(
        `${unsolved.length} question(s) have no worked solution yet. Work the solutions out before publishing.`,
      );
      return;
    }
    if (publish && stale.length > 0) {
      toast.error(
        `${stale.length} question(s) changed after their solution was worked out, ` +
          `so the working describes the old wording. Work those out again.`,
      );
      return;
    }
    if (publish && disagreeing.length > 0) {
      toast.error(
        `The answer key and the solution disagree on ${disagreeing.length} question(s). Settle which is right before publishing.`,
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
          const solved = solutions[q.index];
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
            // A half-solved paper still saves as a draft; these simply travel
            // as null until the admin comes back and finishes it.
            solution: solved?.solution.trim() ? solved.solution : null,
            solvedOption: solved?.solution.trim() ? solved.answer : null,
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

  /**
   * The admin has the last word on both the working and the answer it reached:
   * editing either is how a disagreement with the key gets settled.
   */
  function updateSolution(index: number, patch: Partial<SolvedQuestion>) {
    setSolutions((prev) => {
      const current = prev[index];
      // A patch for a question with no solution yet is the admin choosing to
      // write one by hand, so start an entry rather than dropping the edit.
      // "confident" is theirs by definition — it only ever means the model was
      // unsure of its own working.
      const base: SolvedQuestion = current ?? {
        index,
        solution: "",
        answer: "A",
        confident: true,
      };
      return { ...prev, [index]: { ...base, ...patch } };
    });
    // Touching the working is the admin taking it on against the question as it
    // now reads, so it stops counting as stale.
    const question = questions.find((q) => q.index === index);
    if (question) {
      setSolvedFor((prev) => ({ ...prev, [index]: wordingOf(question) }));
    }
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
      <div
        className={cn(
          "mb-4 grid gap-4 sm:grid-cols-3",
          isTamil ? "lg:grid-cols-6" : "lg:grid-cols-5",
        )}
      >
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
        <Stat
          label="Solved"
          value={`${questions.length - unsolved.length} / ${questions.length}`}
          tone={unsolved.length > 0 ? "danger" : "success"}
          icon={<Lightbulb />}
          hint={
            unsure.length > 0 ? `${unsure.length} the model was unsure of` : undefined
          }
        />
        <Stat
          label="Disagree with key"
          value={disagreeing.length}
          tone={disagreeing.length > 0 ? "danger" : "success"}
          icon={<AlertTriangle />}
          hint={
            disagreeing.length > 0
              ? `Q ${disagreeing.map((q) => q.number).join(", ")}`
              : "The key and the solutions match"
          }
        />
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

      <SolutionPanel
        total={questions.length}
        remaining={notSolved.length}
        unsolved={unsolved.length}
        disagreeing={disagreeing.map((q) => q.number)}
        unsure={unsure.map((q) => q.number)}
        solving={solving}
        batches={solveBatches}
        error={solveError}
        onSolve={onSolve}
      />

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
            solution={solutions[q.index]}
            solutionStale={stale.includes(q)}
            onChange={(patch) => update(q.index, patch)}
            onTranslationChange={(patch) => updateTranslation(q.index, patch)}
            onSolutionChange={(patch) => updateSolution(q.index, patch)}
          />
        ))}
      </div>

      {/* ------------------------------------------------------- publish bar */}
      <Card className="sticky bottom-4 mt-6 shadow-lg">
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          {untranslated.length > 0 ||
          unsolved.length > 0 ||
          disagreeing.length > 0 ||
          stale.length > 0 ? (
            <div className="space-y-1 text-sm text-danger">
              {untranslated.length > 0 && (
                <p>
                  {untranslated.length} of {questions.length} question(s) have no
                  Tamil, or have a Tamil field left blank. The paper cannot be
                  saved until every one is complete.
                </p>
              )}
              {/* Why "Publish" is greyed out. The rule itself is enforced on the
                  server; this is the sentence that explains the disabled button. */}
              {unsolved.length > 0 && (
                <p>
                  Publishing is held back: {unsolved.length} question(s) still have
                  no worked solution. You can save this as a draft now and finish
                  the solutions later.
                </p>
              )}
              {disagreeing.length > 0 && (
                <p>
                  Publishing is held back: the answer key and the worked solution
                  disagree on question(s){" "}
                  {disagreeing.map((q) => q.number).join(", ")}. Fix the key or the
                  solution — a wrong key marks correct answers wrong. Saving as a
                  draft is still fine.
                </p>
              )}
              {stale.length > 0 && (
                <p>
                  Publishing is held back: question(s){" "}
                  {stale.map((q) => q.number).join(", ")} changed after their
                  solution was worked out, so the working argues about the old
                  wording. Work those out again, or rewrite the working yourself.
                </p>
              )}
            </div>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={pending || translating || solving}
              onClick={() => {
                setDraft(null);
                setQuestions([]);
                setTranslations({});
                setTranslateError(null);
                setBatches(null);
                setSolutions({});
                setSolveError(null);
                setSolveBatches(null);
                setPaperName("");
                setKeyName("");
                formRef.current?.reset();
              }}
            >
              <ArrowLeft /> Upload different files
            </Button>
            {/* Never gated on solutions: an unsolved paper is exactly what a
                draft is for. Only an in-flight run holds it, because the save
                would queue behind the whole run anyway. */}
            <Button
              variant="secondary"
              disabled={pending || translating || solving || untranslated.length > 0}
              onClick={() => onPublish(false)}
            >
              Save as draft
            </Button>
            <Button
              disabled={
                pending ||
                translating ||
                solving ||
                blocking.length > 0 ||
                untranslated.length > 0 ||
                unsolved.length > 0 ||
                disagreeing.length > 0
              }
              title={
                unsolved.length > 0
                  ? `${unsolved.length} question(s) still need a worked solution.`
                  : disagreeing.length > 0
                    ? `The key and the solution disagree on question(s) ${disagreeing
                        .map((q) => q.number)
                        .join(", ")}.`
                    : undefined
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

/**
 * The solving step, between reviewing the parsed paper and publishing it.
 *
 * A button rather than something automatic, for the translation panel's reason
 * — a full paper is real money and a long wait, and that is the admin's call —
 * and because what comes back has to be read before it means anything. The
 * summary here is the headline: how much is solved, and where the model and the
 * answer key do not agree.
 */
function SolutionPanel({
  total,
  remaining,
  unsolved,
  disagreeing,
  unsure,
  solving,
  batches,
  error,
  onSolve,
}: {
  total: number;
  /** Never solved. What the button will work through. */
  remaining: number;
  /** Never solved, or solved and then emptied. What blocks publishing. */
  unsolved: number;
  disagreeing: number[];
  unsure: number[];
  solving: boolean;
  batches: { done: number; total: number } | null;
  error: string | null;
  onSolve: () => void;
}) {
  const solved = total - remaining;
  const started = solved > 0;
  const percent = total === 0 ? 0 : Math.round((solved / total) * 100);
  const settled = unsolved === 0 && disagreeing.length === 0;

  return (
    <Card className={cn("mb-4", disagreeing.length > 0 && "border-danger")}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Worked solutions</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={unsolved === 0 ? "success" : started ? "warning" : "neutral"}>
            {total - unsolved} of {total} solved
          </Badge>
          <Badge tone={disagreeing.length > 0 ? "danger" : "success"}>
            {disagreeing.length > 0
              ? `${disagreeing.length} disagree with the key`
              : "No disagreements with the key"}
          </Badge>
          {unsure.length > 0 && (
            <Badge tone="warning">{unsure.length} the model was unsure of</Badge>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Each question is worked out from the question and its options alone —
          the answer key is never shown to the model, so the option it arrives at
          is a genuine second opinion on your key. Students see these solutions
          once the exam window closes. Every solution below is editable, and this
          paper cannot be published until all of them agree with the key.
        </p>

        {(solving || started) && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {solved} of {total} solved
                {solving && batches
                  ? ` · batch ${Math.min(batches.done + 1, batches.total)} of ${batches.total}`
                  : ""}
              </span>
              <span className="tabular-nums">{percent}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-muted"
              role="progressbar"
              aria-valuenow={solved}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label="Questions solved"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <Alert tone="danger" title="The solving stopped">
            {error}
            {remaining > 0 && (
              <span className="mt-1 block text-xs">
                The {solved} question(s) already solved have been kept. Fix the
                problem and retry the remaining {remaining}.
              </span>
            )}
          </Alert>
        )}

        {disagreeing.length > 0 && (
          <Alert
            tone="danger"
            title={`The key and the solution disagree on ${disagreeing.length} question(s)`}
          >
            Question(s) {disagreeing.join(", ")}. One of the two is wrong, and a
            wrong answer key marks correct answers wrong for the whole batch.
            Open each one below, read the working, and either correct the key or
            correct the solution. Publishing stays blocked until they agree.
          </Alert>
        )}

        {unsure.length > 0 && (
          <Alert tone="warning" title={`${unsure.length} solution(s) the model was unsure of`}>
            Question(s) {unsure.join(", ")}. Usually a question that turns on a
            diagram the model cannot see. These are the ones worth reading
            closely even when they agree with your key.
          </Alert>
        )}

        {started && settled && !solving && (
          <Alert tone="success" title="Every question is solved and agrees with the key">
            The paper can be published.
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={solving || remaining === 0} onClick={onSolve}>
            {solving ? (
              <Loader2 className="animate-spin" />
            ) : started ? (
              <RefreshCw />
            ) : (
              <Lightbulb />
            )}
            {solving
              ? "Working them out…"
              : remaining === 0
                ? "Everything is solved"
                : started
                  ? `Solve the remaining ${remaining}`
                  : `Work out the solutions for ${total} question(s)`}
          </Button>
          {solving && (
            <span className="text-xs text-muted-foreground">
              Solving is slower than translating — a full paper takes a while.
              Leave this page open.
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Everything a solution could have been written about.
 *
 * Compared against what it was written about, this is how an edit to the
 * question is noticed by the working that argues over it. The marks and the
 * answer key are deliberately not in here: correcting the key is how a
 * disagreement gets settled, and that must not invalidate the very working the
 * admin settled it against.
 */
function wordingOf(q: DraftQuestion): string {
  // A separator no question contains, so a word moved from the end of one
  // option to the start of the next reads as a change rather than a coincidence.
  return [q.text, q.optionA, q.optionB, q.optionC, q.optionD].join("");
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
  solution,
  solutionStale,
  onChange,
  onTranslationChange,
  onSolutionChange,
}: {
  question: DraftQuestion;
  showTamil: boolean;
  translation?: TranslatedQuestion;
  solution?: SolvedQuestion;
  /** The working was written about wording that has since been corrected. */
  solutionStale: boolean;
  onChange: (patch: Partial<DraftQuestion>) => void;
  onTranslationChange: (patch: Partial<TranslatedQuestion>) => void;
  onSolutionChange: (patch: Partial<SolvedQuestion>) => void;
}) {
  const missingAnswer = !question.correctOption;
  const needsTamil = showTamil && tamilMissing(question, translation);
  const disagrees = Boolean(
    solution && question.correctOption && solution.answer !== question.correctOption,
  );
  const hasProblem =
    missingAnswer ||
    !question.text ||
    OPTIONS.some((k) => !optionValue(question, k) && !hasImage(question, k));

  // A draft image has no id or order yet — its index in the question list is
  // exactly the order it will be saved with, and what a [[#n]] marker means.
  const placed = question.images.map((image, order) => ({
    ...image,
    id: String(order),
    order,
  }));
  const stemImages = placed.filter((i) => i.target === "STEM");

  return (
    <Card className={cn((hasProblem || needsTamil || disagrees) && "border-danger")}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="flex items-center gap-2">
          <Badge tone={question.subjectName ? "primary" : "danger"}>
            {question.subjectName || "No subject"}
          </Badge>
          <span className="text-sm font-semibold">Question {question.number}</span>
          {disagrees && (
            <Badge tone="danger">
              <AlertTriangle className="size-3" /> Key says {question.correctOption},
              solution says {solution!.answer}
            </Badge>
          )}
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

        {/* The box above holds the source, where an image mid-sentence is a
            [[#n]] marker. This is how the question will actually read. */}
        {(stemImages.length > 0 || question.text) && (
          <div className="rounded-[var(--radius-app)] border border-border bg-surface px-3 py-2">
            <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
              How it will read
            </p>
            <QuestionText
              text={question.text}
              images={stemImages}
              alt="Part of the question"
              fallbackWidth={220}
              fallbackHeight={220}
              className="block text-sm leading-relaxed"
            />
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map((key) => {
            const value = optionValue(question, key);
            const images = placed.filter((i) => i.target === key);
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
                {/* An option is a plain input, so without this a stacked
                    fraction would never be seen here at all — the one screen
                    where the text is still being corrected. */}
                {(images.length > 0 || hasFraction(value)) && (
                  <QuestionText
                    text={value}
                    images={images}
                    alt={`Option ${key}`}
                    fallbackWidth={90}
                    fallbackHeight={90}
                    className="mt-1.5 block text-xs"
                  />
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

        <SolutionReview
          index={question.index}
          keyAnswer={question.correctOption}
          solution={solution}
          stale={solutionStale}
          onChange={onSolutionChange}
        />

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

/**
 * The worked solution for one question, and the answer it arrived at.
 *
 * Both are editable because the admin is the final word on both: when the
 * solution and the key disagree, settling it means either correcting the key
 * (the radio buttons above) or correcting the solution here. The disagreement
 * is stated in full — which option each side chose — rather than left as a
 * coloured border, because it is the one thing on this screen that stops the
 * paper going out.
 */
function SolutionReview({
  index,
  keyAnswer,
  solution,
  stale,
  onChange,
}: {
  index: number;
  keyAnswer: OptionKey | null;
  solution?: SolvedQuestion;
  /** The working was written about wording that has since been corrected. */
  stale: boolean;
  onChange: (patch: Partial<SolvedQuestion>) => void;
}) {
  if (!solution) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-app)] border border-dashed border-border-strong bg-surface-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span>
          No worked solution yet. Run &ldquo;Work out the solutions&rdquo; above —
          the paper can be saved as a draft without it, but not published.
        </span>
        {/* Writing one by hand has to be possible: otherwise a paper is stuck
            unpublishable whenever the API is unavailable, and an admin who
            would rather write their own explanation has no way to. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ solution: "", answer: keyAnswer ?? "A", confident: true })}
        >
          Write one myself
        </Button>
      </div>
    );
  }

  const disagrees = Boolean(keyAnswer && solution.answer !== keyAnswer);
  const blank = !solution.solution.trim();

  return (
    <div
      className={cn(
        "space-y-3 rounded-[var(--radius-app)] border p-3",
        disagrees || stale
          ? "border-danger bg-danger-soft/20"
          : "border-border-strong bg-surface-muted/40",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Lightbulb className="size-3.5" aria-hidden /> Worked solution · students
          see this after the window closes
        </span>
        {!solution.confident && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <HelpCircle className="size-3.5" /> The model was not confident here —
            read it carefully
          </span>
        )}
      </div>

      {stale && (
        <p className="flex items-start gap-1.5 text-sm font-semibold text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            This question changed after the working was written, so the working
            argues about the old wording — it may name an option that no longer
            says what it did. Work it out again, or rewrite it here. Publishing
            is blocked until then.
          </span>
        </p>
      )}

      {disagrees && (
        <p className="flex items-start gap-1.5 text-sm font-semibold text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            This solution disagrees with your answer key. The key says{" "}
            {keyAnswer}; the working arrives at {solution.answer}. One of them is
            wrong — correct the key with the radio buttons above, or fix the
            working and the answer below. Publishing is blocked until they agree.
          </span>
        </p>
      )}

      <Field
        label="The working"
        htmlFor={`sol-${index}`}
        error={blank ? "A blank solution blocks publishing. Write it, or solve it again." : undefined}
      >
        <Textarea
          id={`sol-${index}`}
          value={solution.solution}
          onChange={(e) => onChange({ solution: e.target.value })}
          className={cn("min-h-28", blank && "border-danger")}
        />
      </Field>

      {/* The box above holds the source, where a subscript has to be written as
          markup — d_Cu, F_{net} — because Unicode has no subscript letters. This
          shows how it will actually read, so the admin is not editing blind. */}
      {hasFormulaMarkup(solution.solution) && (
        <div className="rounded-[var(--radius-app)] border border-border bg-surface px-3 py-2">
          <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
            How students will read it
          </p>
          <Formula text={solution.solution} className="block text-sm leading-relaxed" />
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Field
          label="Answer this solution reaches"
          htmlFor={`sol-answer-${index}`}
          hint="Change this if you have rewritten the working."
        >
          <Select
            id={`sol-answer-${index}`}
            value={solution.answer}
            onChange={(e) => onChange({ answer: e.target.value as OptionKey })}
            className={cn("h-8 text-sm", disagrees && "border-danger")}
          >
            {OPTIONS.map((k) => (
              <option key={k} value={k}>
                Option {k}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Answer key" htmlFor={`sol-key-${index}`}>
          <p
            id={`sol-key-${index}`}
            className={cn(
              "flex h-8 items-center rounded-[var(--radius-app)] border border-border px-3 text-sm",
              disagrees ? "text-danger" : "text-success",
            )}
          >
            {keyAnswer ? `Option ${keyAnswer}` : "No answer chosen yet"}
            {keyAnswer && !disagrees && " · agrees"}
          </p>
        </Field>
      </div>
    </div>
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
