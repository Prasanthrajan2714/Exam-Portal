"use client";

import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  Alert,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/action-result";
import { cn, formatDate } from "@/lib/utils";
import { PaperUploader } from "../papers/paper-uploader";
import { createExam, updateExam } from "./actions";

type SubjectOption = { id: string; name: string };
type BatchOption = { id: string; name: string };

export type ExamInitialValues = {
  id: string;
  name: string;
  batchId: string;
  date: string; // yyyy-mm-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarks: number;
  resultVisibility: "IMMEDIATE" | "AFTER_WINDOW";
  medium: "ENGLISH" | "TAMIL";
  subjects: { subjectId: string; questionCount: number }[];
  /** A Tamil paper on file cannot become an English one. */
  mediumLocked: boolean;
  /** Lowest count each subject may be set to, given what is already uploaded. */
  questionFloors: Record<string, number>;
};

// Common competitive-exam shapes, so an admin setting up a JEE mock doesn't
// tick the same three subjects by hand every time.
const PRESETS: { label: string; subjects: string[]; perSubject: number }[] = [
  { label: "JEE", subjects: ["Mathematics", "Physics", "Chemistry"], perSubject: 25 },
  { label: "NEET", subjects: ["Physics", "Chemistry", "Biology"], perSubject: 45 },
];

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}

export function ExamForm({
  batches,
  subjects,
  initial,
}: {
  batches: BatchOption[];
  subjects: SubjectOption[];
  initial?: ExamInitialValues;
}) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [state, formAction] = useActionState<ActionResult<{ examId: string }>, FormData>(
    editing ? updateExam : createExam,
    { ok: false },
  );

  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    initial?.subjects.forEach((s) => {
      seed[s.subjectId] = s.questionCount;
    });
    return seed;
  });

  // Every field is controlled so the details can be shown back to the admin as
  // a summary once step 1 is saved and the form itself is out of the way.
  const [name, setName] = useState(initial?.name ?? "");
  const [batchId, setBatchId] = useState(initial?.batchId ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "11:00");
  const [duration, setDuration] = useState(String(initial?.durationMinutes ?? 30));
  const [marksPerCorrect, setMarksPerCorrect] = useState(
    String(initial?.marksPerCorrect ?? 4),
  );
  const [negativeMarks, setNegativeMarks] = useState(String(initial?.negativeMarks ?? 1));
  const [resultVisibility, setResultVisibility] = useState<"IMMEDIATE" | "AFTER_WINDOW">(
    initial?.resultVisibility ?? "IMMEDIATE",
  );
  const [medium, setMedium] = useState<"ENGLISH" | "TAMIL">(
    initial?.medium ?? "ENGLISH",
  );

  const selected = useMemo(
    () => Object.entries(counts).filter(([, n]) => n > 0),
    [counts],
  );
  const totalQuestions = selected.reduce((sum, [, n]) => sum + n, 0);

  // Combine the date + time pickers into instants. Constructing the Date from
  // parts (rather than parsing a string) keeps it in the admin's own timezone,
  // which is the wall-clock time they typed.
  const { startsAtISO, endsAtISO, windowMinutes } = useMemo(() => {
    if (!date || !startTime || !endTime) {
      return { startsAtISO: "", endsAtISO: "", windowMinutes: 0 };
    }
    const [y, m, d] = date.split("-").map(Number);
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const start = new Date(y, m - 1, d, sh, sm, 0, 0);
    const end = new Date(y, m - 1, d, eh, em, 0, 0);
    return {
      startsAtISO: start.toISOString(),
      endsAtISO: end.toISOString(),
      windowMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
    };
  }, [date, startTime, endTime]);

  // Creating stays on this page and reveals step 2; editing has no step 2, so
  // it still goes back to the exam it just changed.
  const createdExamId = !editing && state.ok && state.data ? state.data.examId : null;

  useEffect(() => {
    if (state.ok && state.data) {
      toast.success(state.message ?? "Saved");
      if (editing) router.push(`/admin/exams/${state.data.examId}`);
    }
  }, [state, router, editing]);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const next: Record<string, number> = {};
    for (const subject of subjects) {
      if (preset.subjects.includes(subject.name)) {
        next[subject.id] = preset.perSubject;
      }
    }
    if (Object.keys(next).length === 0) {
      toast.error(`None of the ${preset.label} subjects exist yet.`);
      return;
    }
    setCounts(next);
  }

  function toggleSubject(id: string, on: boolean) {
    setCounts((prev) => {
      const next = { ...prev };
      if (on) next[id] = prev[id] || 20;
      else delete next[id];
      return next;
    });
  }

  const mediumLocked = initial?.mediumLocked ?? false;
  const floors = initial?.questionFloors ?? {};
  const hasPaper = Object.keys(floors).length > 0;
  const subjectSummary = selected
    .map(
      ([subjectId, n]) =>
        `${subjects.find((s) => s.id === subjectId)?.name ?? "Subject"} · ${n}`,
    )
    .join(", ");

  // ------------------------------------------------- step 2: question paper
  if (createdExamId) {
    const examPath = `/admin/exams/${createdExamId}`;
    const [y, m, d] = date.split("-").map(Number);

    return (
      <>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-success" /> Exam details saved
            </CardTitle>
          </CardHeader>
          <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
            <SummaryRow label="Exam">{name}</SummaryRow>
            <SummaryRow label="Batch">
              {batches.find((b) => b.id === batchId)?.name ?? "—"}
            </SummaryRow>
            {/* With one subject its count IS the total, so appending the total
                only repeats the same number back. */}
            <SummaryRow label="Subjects">
              {selected.length > 1
                ? `${subjectSummary} · ${totalQuestions} questions in total`
                : `${subjectSummary} questions`}
            </SummaryRow>
            <SummaryRow label="Date">
              {date ? formatDate(new Date(y, m - 1, d)) : "—"}
            </SummaryRow>
            <SummaryRow label="Opens and closes">
              {startTime} – {endTime}
            </SummaryRow>
            <SummaryRow label="Duration">{duration} minutes</SummaryRow>
            <SummaryRow label="Medium">
              {medium === "TAMIL" ? "Tamil" : "English"}
            </SummaryRow>
            <SummaryRow label="Marking">
              +{marksPerCorrect} correct · −{negativeMarks} wrong · 0 unanswered
            </SummaryRow>
            <SummaryRow label="Results">
              {resultVisibility === "IMMEDIATE"
                ? "Immediately after submitting"
                : "Only after the window closes"}
            </SummaryRow>
          </CardBody>
          <CardFooter>
            <p className="text-sm text-muted-foreground">
              This exam is saved as a draft, so nothing is lost if you stop here —
              students cannot see it until its paper is uploaded and it is
              published. You can come back to the upload any time from the exam
              page.
            </p>
          </CardFooter>
        </Card>

        <PaperUploader
          examId={createdExamId}
          examName={name}
          medium={medium}
          redirectTo={examPath}
        />
      </>
    );
  }

  // ------------------------------------------------- step 1: exam details
  return (
    <form action={formAction} className="space-y-6">

      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="startsAt" value={startsAtISO} />
      <input type="hidden" name="endsAt" value={endsAtISO} />
      <input
        type="hidden"
        name="subjects"
        value={JSON.stringify(
          selected.map(([subjectId, questionCount]) => ({ subjectId, questionCount })),
        )}
      />

      {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}

      {/* ---------------------------------------------------------- basics */}
      <Card>
        <CardHeader>
          <CardTitle>Exam details</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Exam name"
            htmlFor="name"
            required
            error={state.fieldErrors?.name}
            className="sm:col-span-2"
          >
            <Input
              id="name"
              name="name"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. JEE Mock Test 1"
            />
          </Field>

          <Field
            label="Batch or class"
            htmlFor="batchId"
            required
            error={state.fieldErrors?.batchId}
            hint="Only this batch will see the exam."
          >
            <Select
              id="batchId"
              name="batchId"
              required
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
            >
              <option value="" disabled>
                Choose a batch…
              </option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Exam date"
            htmlFor="date"
            required
            error={state.fieldErrors?.startsAt}
          >
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-9"
              />
            </div>
          </Field>
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------- subjects */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Subjects and question counts</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Tick every subject in this paper and say how many questions each has.
            </p>
          </div>
          {/* Presets are a fresh-setup convenience; once a paper is on file they
              would only ever propose counts that no longer fit it. */}
          {!hasPaper && (
            <div className="flex gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => applyPreset(preset)}
                >
                  <Sparkles /> {preset.label}
                </Button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardBody>
          {hasPaper && (
            <Alert tone="info" className="mb-4">
              A question paper is already uploaded. You can still change a count
              to match what it actually contains — down to the highest question
              number on file, shown against each subject. A subject that carries
              questions cannot be removed; delete the paper for that.
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {subjects.map((subject) => {
              const on = subject.id in counts;
              // Questions on file for this subject set the lowest count it can
              // now be given, and stop it being unticked altogether.
              const floor = floors[subject.id] ?? 0;
              return (
                <div
                  key={subject.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-[var(--radius-app)] border p-3 transition-colors",
                    on ? "border-primary bg-primary-soft/40" : "border-border bg-surface",
                  )}
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={floor > 0}
                      onChange={(e) => toggleSubject(subject.id, e.target.checked)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="text-sm font-medium">{subject.name}</span>
                  </label>

                  {on && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={Math.max(1, floor)}
                        max={300}
                        value={counts[subject.id]}
                        onChange={(e) =>
                          setCounts((prev) => ({
                            ...prev,
                            [subject.id]: Math.max(
                              Math.max(1, floor),
                              Number(e.target.value) || 1,
                            ),
                          }))
                        }
                        className="h-8 w-20 text-center"
                        aria-label={`${subject.name} question count`}
                      />
                      <span className="text-xs text-muted-foreground">
                        questions
                        {floor > 0 && (
                          <span className="block text-[0.7rem]">{floor} on file</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {state.fieldErrors?.subjects && (
            <p className="mt-3 text-xs font-medium text-danger">
              {state.fieldErrors.subjects}
            </p>
          )}

          {totalQuestions > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Total:{" "}
              <span className="font-semibold text-foreground">
                {totalQuestions} questions
              </span>{" "}
              across {selected.length} subject{selected.length === 1 ? "" : "s"} ·
              maximum score{" "}
              <span className="font-semibold text-foreground">
                {totalQuestions * (Number(marksPerCorrect) || 0)}
              </span>{" "}
              at the marking below
            </p>
          )}
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------- timing */}
      <Card>
        <CardHeader>
          <CardTitle>Timing</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            The window is when students may enter. The duration is how long each
            student gets once they start.
          </p>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens at" htmlFor="startTime" required>
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="startTime"
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="pl-9"
              />
            </div>
          </Field>

          <Field
            label="Closes at"
            htmlFor="endTime"
            required
            error={state.fieldErrors?.endsAt}
          >
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="endTime"
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="pl-9"
              />
            </div>
          </Field>

          <Field
            label="Duration (minutes)"
            htmlFor="durationMinutes"
            required
            error={state.fieldErrors?.durationMinutes}
            hint={
              windowMinutes > 0 ? `Window is ${windowMinutes} minutes long.` : undefined
            }
          >
            <Input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={1}
              max={600}
              required
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>

          {windowMinutes > 0 && Number(duration) > windowMinutes && (
            <Alert tone="warning" className="sm:col-span-3">
              The duration is longer than the window. A student starting at{" "}
              {startTime} would be cut off at {endTime} — widen the window or
              shorten the duration.
            </Alert>
          )}
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------- marking */}
      <Card>
        <CardHeader>
          <CardTitle>Medium, marking and results</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Medium"
            htmlFor="medium"
            required
            error={state.fieldErrors?.medium}
            hint={
              mediumLocked
                ? "The paper is already uploaded in this medium. Delete the paper to change it."
                : "Choose Tamil and the question paper is translated into Tamil as you upload it, with technical terms taken from the board's subject glossary. English is kept exactly as written."
            }
          >
            <Select
              id="medium"
              // A disabled control posts nothing, so the hidden input below
              // carries the unchanged value through instead.
              name={mediumLocked ? undefined : "medium"}
              disabled={mediumLocked}
              value={medium}
              onChange={(e) => setMedium(e.target.value as "ENGLISH" | "TAMIL")}
            >
              <option value="ENGLISH">English</option>
              <option value="TAMIL">Tamil</option>
            </Select>
            {mediumLocked && <input type="hidden" name="medium" value={medium} />}
          </Field>

          <Field
            label="Marks per correct answer"
            htmlFor="marksPerCorrect"
            required
            error={state.fieldErrors?.marksPerCorrect}
          >
            <Input
              id="marksPerCorrect"
              name="marksPerCorrect"
              type="number"
              step="0.25"
              min="0.25"
              required
              value={marksPerCorrect}
              onChange={(e) => setMarksPerCorrect(e.target.value)}
            />
          </Field>

          <Field
            label="Negative marks per wrong answer"
            htmlFor="negativeMarks"
            required
            error={state.fieldErrors?.negativeMarks}
            hint="Enter as a positive number — 1 means −1. Use 0 for no negative marking."
          >
            <Input
              id="negativeMarks"
              name="negativeMarks"
              type="number"
              step="0.25"
              min="0"
              required
              value={negativeMarks}
              onChange={(e) => setNegativeMarks(e.target.value)}
            />
          </Field>

          <Field label="Show results" htmlFor="resultVisibility" required>
            <Select
              id="resultVisibility"
              name="resultVisibility"
              value={resultVisibility}
              onChange={(e) =>
                setResultVisibility(e.target.value as "IMMEDIATE" | "AFTER_WINDOW")
              }
            >
              <option value="IMMEDIATE">Immediately after submitting</option>
              <option value="AFTER_WINDOW">Only after the exam window closes</option>
            </Select>
          </Field>

          <p className="text-sm text-muted-foreground sm:col-span-3">
            Unanswered questions always score zero — negative marking applies to
            wrong answers only.
          </p>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Submit label={editing ? "Save changes" : "Create exam"} />
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        {!editing && (
          <p className="text-sm text-muted-foreground">
            The exam is saved as a draft, then you upload its question paper right
            here.
          </p>
        )}
      </div>
    </form>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium">{children}</p>
    </div>
  );
}
