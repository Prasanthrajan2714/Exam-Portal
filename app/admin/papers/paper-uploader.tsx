"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";
import { type DraftPaper, type DraftQuestion, parsePaper, publishPaper } from "./actions";

type OptionKey = "A" | "B" | "C" | "D";
const OPTIONS: OptionKey[] = ["A", "B", "C", "D"];

export function PaperUploader({
  examId,
  examName,
  redirectTo,
}: {
  examId: string;
  examName: string;
  /** Where to go after a successful save. Defaults to `/admin/papers/<examId>`. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftPaper | null>(null);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paperName, setPaperName] = useState("");
  const [keyName, setKeyName] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const blocking = useMemo(
    () =>
      questions.filter(
        (q) => !q.correctOption || !q.text || OPTIONS.some((k) => !optionValue(q, k) && !hasImage(q, k)),
      ),
    [questions],
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
      toast.success(result.message ?? "Document read");
    });
  }

  function onPublish(publish: boolean) {
    if (publish && blocking.length > 0) {
      toast.error(
        `${blocking.length} question(s) still need attention before publishing.`,
      );
      return;
    }
    startTransition(async () => {
      const result = await publishPaper({
        examId,
        publish,
        questions: questions.map((q) => ({
          subjectName: q.subjectName,
          number: q.number,
          text: q.text,
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
          correctOption: q.correctOption!,
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          images: q.images,
        })),
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
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
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
      </div>

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
            onChange={(patch) => update(q.index, patch)}
          />
        ))}
      </div>

      {/* ------------------------------------------------------- publish bar */}
      <Card className="sticky bottom-4 mt-6 shadow-lg">
        <CardBody className="flex flex-wrap items-center justify-end gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setDraft(null);
                setQuestions([]);
                setPaperName("");
                setKeyName("");
                formRef.current?.reset();
              }}
            >
              <ArrowLeft /> Upload different files
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => onPublish(false)}>
              Save as draft
            </Button>
            <Button
              disabled={pending || blocking.length > 0}
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

function optionValue(q: DraftQuestion, key: OptionKey): string {
  return key === "A" ? q.optionA : key === "B" ? q.optionB : key === "C" ? q.optionC : q.optionD;
}

function hasImage(q: DraftQuestion, target: "STEM" | OptionKey): boolean {
  return q.images.some((i) => i.target === target);
}

function QuestionEditor({
  question,
  onChange,
}: {
  question: DraftQuestion;
  onChange: (patch: Partial<DraftQuestion>) => void;
}) {
  const missingAnswer = !question.correctOption;
  const hasProblem =
    missingAnswer ||
    !question.text ||
    OPTIONS.some((k) => !optionValue(question, k) && !hasImage(question, k));

  const stemImages = question.images.filter((i) => i.target === "STEM");

  return (
    <Card className={cn(hasProblem && "border-danger")}>
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

        <Field label="Question" htmlFor={`q-${question.index}`}>
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
              <ImageThumb key={img.path} path={img.path} />
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
                      <ImageThumb key={img.path} path={img.path} small />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {missingAnswer && (
          <p className="text-xs font-medium text-danger">
            Choose which option is correct — this question has no answer key entry.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ImageThumb({ path, small }: { path: string; small?: boolean }) {
  return (
    <Image
      src={`/api/uploads/${path}`}
      alt="Question diagram"
      width={small ? 90 : 220}
      height={small ? 90 : 220}
      unoptimized
      className="rounded border border-border bg-white object-contain"
      style={{ maxHeight: small ? 90 : 220, width: "auto" }}
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
