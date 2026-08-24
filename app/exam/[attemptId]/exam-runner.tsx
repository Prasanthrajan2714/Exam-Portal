"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Loader2,
  Menu,
  Send,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/primitives";
import { QuestionImage } from "@/components/question-image";
import { formatDuration } from "@/lib/exam-window";
import { cn } from "@/lib/utils";

export type OptionKey = "A" | "B" | "C" | "D";

export type RunnerQuestion = {
  id: string;
  subjectId: string;
  number: number;
  text: string;
  options: Record<OptionKey, string>;
  images: {
    path: string;
    target: string;
    /** Size the source document laid this out at; null for anything stored before that was kept. */
    width: number | null;
    height: number | null;
  }[];
  selectedOption: OptionKey | null;
  markedForReview: boolean;
};

type Subject = { id: string; name: string };

const OPTIONS: OptionKey[] = ["A", "B", "C", "D"];

/** Palette state, in the colours JEE/NEET candidates already recognise. */
type PaletteState = "answered" | "marked" | "answeredMarked" | "notAnswered" | "notVisited";

export function ExamRunner({
  attemptId,
  sessionToken,
  examName,
  studentName,
  subjects,
  questions: initialQuestions,
  initialSecondsRemaining,
  marksPerCorrect,
  negativeMarks,
}: {
  attemptId: string;
  sessionToken: string;
  examName: string;
  studentName: string;
  subjects: Subject[];
  questions: RunnerQuestion[];
  initialSecondsRemaining: number;
  marksPerCorrect: number;
  negativeMarks: number;
}) {
  const router = useRouter();

  const [questions, setQuestions] = useState(initialQuestions);
  const [visited, setVisited] = useState<Set<string>>(
    () => new Set(initialQuestions.filter((q) => q.selectedOption).map((q) => q.id)),
  );
  const [activeSubject, setActiveSubject] = useState(subjects[0]?.id ?? "");
  const [currentId, setCurrentId] = useState(
    initialQuestions.find((q) => q.subjectId === (subjects[0]?.id ?? ""))?.id ??
      initialQuestions[0]?.id ??
      "",
  );
  const [seconds, setSeconds] = useState(initialSecondsRemaining);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [saving, setSaving] = useState(false);

  const submittedRef = useRef(false);

  const subjectQuestions = useMemo(
    () => questions.filter((q) => q.subjectId === activeSubject),
    [questions, activeSubject],
  );
  const current = questions.find((q) => q.id === currentId) ?? questions[0];

  // ------------------------------------------------------------- submitting
  const submit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        const response = await fetch(`/api/attempt/${attemptId}/submit`, {
          method: "POST",
        });
        const data = await response.json().catch(() => ({}));
        if (auto) toast.info("Time is up — your exam was submitted automatically.");
        else toast.success("Your exam has been submitted.");
        router.replace(
          data?.resultAvailable === false
            ? "/student/dashboard"
            : `/student/results/${attemptId}`,
        );
      } catch {
        submittedRef.current = false;
        setSubmitting(false);
        toast.error("Could not reach the server. Check your connection and try again.");
      }
    },
    [attemptId, router],
  );

  // ------------------------------------------------------------- countdown
  useEffect(() => {
    // Already out of time on arrival (deadline passed while the page loaded).
    if (initialSecondsRemaining <= 0) {
      const immediate = setTimeout(() => void submit(true), 0);
      return () => clearTimeout(immediate);
    }

    const timer = setInterval(() => {
      setSeconds((previous) => {
        if (previous > 1) return previous - 1;
        clearInterval(timer);
        // Deferred so the state updater itself stays pure.
        queueMicrotask(() => void submit(true));
        return 0;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [initialSecondsRemaining, submit]);

  // ------------------------------------------------------------- auto-save
  const save = useCallback(
    async (question: RunnerQuestion, patch: Partial<RunnerQuestion>) => {
      setSaving(true);
      try {
        const response = await fetch(`/api/attempt/${attemptId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // keepalive lets the browser finish this request even if the page is
          // navigating away or being closed. Without it, an answer clicked a
          // moment before the tab dies is silently lost — exactly the situation
          // this exam is meant to survive.
          keepalive: true,
          body: JSON.stringify({
            questionId: question.id,
            selectedOption: patch.selectedOption ?? question.selectedOption ?? null,
            markedForReview: patch.markedForReview ?? question.markedForReview,
            sessionToken,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (data?.expired || data?.finished) {
            toast.error(data.error ?? "This exam is over.");
            router.replace(`/student/results/${attemptId}`);
            return;
          }
          if (data?.conflict) {
            toast.error("This exam was opened in another window.");
            return;
          }
          toast.error("Your last answer could not be saved. Check your connection.");
          return;
        }

        // Re-sync from the server's clock, which is the authoritative one.
        const data = await response.json();
        if (typeof data.secondsRemaining === "number") {
          setSeconds(data.secondsRemaining);
        }
      } catch {
        toast.error("Offline — your last answer was not saved.");
      } finally {
        setSaving(false);
      }
    },
    [attemptId, sessionToken, router],
  );

  // ------------------------------------------------------------- anti-cheat
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden" || submittedRef.current) return;
      void fetch(`/api/attempt/${attemptId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "TAB_SWITCH", sessionToken }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (typeof data?.tabSwitchCount === "number") {
            setTabSwitches(data.tabSwitchCount);
          }
          if (typeof data?.secondsRemaining === "number") {
            setSeconds(data.secondsRemaining);
          }
        })
        .catch(() => {});
    };

    const block = (event: Event) => event.preventDefault();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (submittedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    document.addEventListener("paste", block);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("paste", block);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [attemptId, sessionToken]);

  // Warn once the student has left the tab — visible, but not punitive.
  useEffect(() => {
    if (tabSwitches > 0) {
      toast.warning(
        `You left the exam screen (${tabSwitches} time${tabSwitches === 1 ? "" : "s"}). This is recorded for your administrator.`,
      );
    }
  }, [tabSwitches]);

  // ------------------------------------------------------------- actions
  function update(id: string, patch: Partial<RunnerQuestion>) {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    );
    setVisited((prev) => new Set(prev).add(id));
  }

  function choose(option: OptionKey) {
    if (!current) return;
    update(current.id, { selectedOption: option });
    void save(current, { selectedOption: option });
  }

  function clearResponse() {
    if (!current) return;
    update(current.id, { selectedOption: null });
    void save(current, { selectedOption: null });
  }

  function goTo(id: string) {
    setCurrentId(id);
    setVisited((prev) => new Set(prev).add(id));
    setPaletteOpen(false);
    const question = questions.find((q) => q.id === id);
    if (question) setActiveSubject(question.subjectId);
  }

  function step(delta: number) {
    const index = subjectQuestions.findIndex((q) => q.id === currentId);
    const next = subjectQuestions[index + delta];
    if (next) {
      goTo(next.id);
      return;
    }
    // Roll over into the neighbouring subject rather than dead-ending.
    const subjectIndex = subjects.findIndex((s) => s.id === activeSubject);
    const nextSubject = subjects[subjectIndex + delta];
    if (!nextSubject) return;
    const pool = questions.filter((q) => q.subjectId === nextSubject.id);
    const target = delta > 0 ? pool[0] : pool[pool.length - 1];
    if (target) goTo(target.id);
  }

  function saveAndNext() {
    step(1);
  }

  function markAndNext() {
    if (!current) return;
    const next = !current.markedForReview;
    update(current.id, { markedForReview: next });
    void save(current, { markedForReview: next });
    step(1);
  }

  // ------------------------------------------------------------- counts
  const stateOf = useCallback(
    (q: RunnerQuestion): PaletteState => {
      if (q.selectedOption && q.markedForReview) return "answeredMarked";
      if (q.markedForReview) return "marked";
      if (q.selectedOption) return "answered";
      if (visited.has(q.id)) return "notAnswered";
      return "notVisited";
    },
    [visited],
  );

  const counts = useMemo(() => {
    const tally = {
      answered: 0,
      marked: 0,
      answeredMarked: 0,
      notAnswered: 0,
      notVisited: 0,
    };
    for (const q of questions) tally[stateOf(q)]++;
    return tally;
  }, [questions, stateOf]);

  const answeredTotal = counts.answered + counts.answeredMarked;
  const lowTime = seconds <= 300;

  if (!current) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <Alert tone="danger">This exam has no questions.</Alert>
      </main>
    );
  }

  const stemImages = current.images.filter((i) => i.target === "STEM");

  return (
    <div className="exam-locked flex min-h-screen flex-col bg-background">
      {/* ------------------------------------------------------------ header */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark size={32} eager className="hidden sm:block" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{examName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {studentName} · +{marksPerCorrect} / −{negativeMarks}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saving && (
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
                <Loader2 className="size-3 animate-spin" /> Saving
              </span>
            )}

            <div
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius-app)] px-3 py-1.5 font-mono text-lg font-semibold tabular-nums",
                lowTime ? "bg-danger-soft text-danger" : "bg-surface-muted",
              )}
              role="timer"
              aria-live="off"
            >
              <Clock className="size-4" />
              {formatDuration(seconds)}
            </div>

            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={submitting}>
              <Send /> Submit
            </Button>

            <button
              className="lg:hidden"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open question palette"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </div>

        {subjects.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-t border-border px-4 py-1.5">
            {subjects.map((subject) => {
              const pool = questions.filter((q) => q.subjectId === subject.id);
              const done = pool.filter((q) => q.selectedOption).length;
              return (
                <button
                  key={subject.id}
                  onClick={() => {
                    setActiveSubject(subject.id);
                    const first = pool[0];
                    if (first) setCurrentId(first.id);
                  }}
                  className={cn(
                    "whitespace-nowrap rounded-[var(--radius-app)] px-3 py-1.5 text-sm font-medium transition-colors",
                    subject.id === activeSubject
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-surface-muted",
                  )}
                >
                  {subject.name}
                  <span className="ml-1.5 text-xs opacity-80">
                    {done}/{pool.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {lowTime && seconds > 0 && (
        <div className="bg-danger px-4 py-1.5 text-center text-sm font-medium text-white">
          Less than {Math.ceil(seconds / 60)} minute
          {Math.ceil(seconds / 60) === 1 ? "" : "s"} remaining
        </div>
      )}

      <div className="flex flex-1">
        {/* ---------------------------------------------------- question pane */}
        <main className="flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Question {current.number}
              </h2>
              {current.markedForReview && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-review">
                  <Flag className="size-3.5" /> Marked for review
                </span>
              )}
            </div>

            <p className="whitespace-pre-wrap text-base leading-relaxed">
              {current.text}
            </p>

            {stemImages.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {stemImages.map((img) => (
                  <QuestionImage
                    key={img.path}
                    image={img}
                    alt="Question diagram"
                    fallbackWidth={480}
                    fallbackHeight={360}
                  />
                ))}
              </div>
            )}

            <div className="mt-6 space-y-2.5">
              {OPTIONS.map((key) => {
                const selected = current.selectedOption === key;
                const optionImages = current.images.filter((i) => i.target === key);
                return (
                  <button
                    key={key}
                    onClick={() => choose(key)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-[var(--radius-app)] border p-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary-soft"
                        : "border-border bg-surface hover:border-border-strong hover:bg-surface-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border-strong text-muted-foreground",
                      )}
                    >
                      {key}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm leading-relaxed">
                        {current.options[key]}
                      </span>
                      {optionImages.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-2">
                          {optionImages.map((img) => (
                            <QuestionImage
                              key={img.path}
                              image={img}
                              alt={`Option ${key}`}
                              fallbackWidth={200}
                              fallbackHeight={150}
                            />
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
              <Button onClick={saveAndNext}>
                Save &amp; Next <ChevronRight />
              </Button>
              <Button variant="secondary" onClick={markAndNext}>
                <Flag />
                {current.markedForReview ? "Unmark & Next" : "Mark for Review & Next"}
              </Button>
              <Button
                variant="ghost"
                onClick={clearResponse}
                disabled={!current.selectedOption}
              >
                <X /> Clear Response
              </Button>

              <div className="ml-auto flex gap-2">
                <Button variant="secondary" size="icon" onClick={() => step(-1)} aria-label="Previous question">
                  <ChevronLeft />
                </Button>
                <Button variant="secondary" size="icon" onClick={() => step(1)} aria-label="Next question">
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        </main>

        {/* --------------------------------------------------------- palette */}
        <aside
          className={cn(
            "fixed inset-y-0 right-0 z-40 w-72 overflow-y-auto border-l border-border bg-surface transition-transform lg:static lg:translate-x-0",
            paletteOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3 lg:hidden">
            <span className="text-sm font-semibold">Questions</span>
            <button onClick={() => setPaletteOpen(false)} aria-label="Close palette">
              <X className="size-5" />
            </button>
          </div>

          <div className="p-4">
            <div className="mb-4 space-y-1.5 text-xs">
              <Legend tone="answered" label="Answered" count={counts.answered} />
              <Legend tone="notAnswered" label="Not answered" count={counts.notAnswered} />
              <Legend tone="marked" label="Marked for review" count={counts.marked} />
              <Legend
                tone="answeredMarked"
                label="Answered & marked"
                count={counts.answeredMarked}
              />
              <Legend tone="notVisited" label="Not visited" count={counts.notVisited} />
            </div>

            {subjects.map((subject) => {
              const pool = questions.filter((q) => q.subjectId === subject.id);
              if (pool.length === 0) return null;
              return (
                <div key={subject.id} className="mb-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {subject.name}
                  </p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {pool.map((q) => (
                      <button
                        key={q.id}
                        onClick={() => goTo(q.id)}
                        className={cn(
                          "flex h-9 items-center justify-center rounded text-xs font-semibold transition-transform hover:scale-105",
                          paletteClass(stateOf(q)),
                          q.id === currentId && "ring-2 ring-foreground ring-offset-1",
                        )}
                        aria-label={`${subject.name} question ${q.number}`}
                      >
                        {q.number}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {paletteOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setPaletteOpen(false)}
          />
        )}
      </div>

      {/* --------------------------------------------------------- submit */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit your exam?</DialogTitle>
            <DialogDescription>
              You cannot return to the paper after submitting.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <Summary label="Answered" value={answeredTotal} tone="success" />
            <Summary
              label="Not answered"
              value={questions.length - answeredTotal}
              tone="danger"
            />
            <Summary label="Marked for review" value={counts.marked + counts.answeredMarked} />
            <Summary label="Time left" value={formatDuration(seconds)} />
          </div>

          {questions.length - answeredTotal > 0 && (
            <Alert tone="warning" className="mt-3">
              {questions.length - answeredTotal} question
              {questions.length - answeredTotal === 1 ? "" : "s"} still unanswered.
              Unanswered questions score zero — they carry no negative marks.
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Keep working
            </Button>
            <Button onClick={() => submit(false)} disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              Submit exam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="flex items-center gap-3 text-sm font-medium">
            <Loader2 className="size-5 animate-spin" /> Submitting your exam…
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function paletteClass(state: PaletteState): string {
  switch (state) {
    case "answered":
      return "bg-success text-white";
    case "notAnswered":
      return "bg-danger text-white";
    case "marked":
      return "bg-review text-white";
    case "answeredMarked":
      // Answered *and* flagged: purple with a green dot, the NTA convention.
      return "bg-review text-white ring-2 ring-success ring-inset";
    default:
      return "bg-surface-muted text-muted-foreground border border-border-strong";
  }
}

function Legend({
  tone,
  label,
  count,
}: {
  tone: PaletteState;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-3.5 shrink-0 rounded", paletteClass(tone))} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-semibold tabular-nums">{count}</span>
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "success" | "danger";
}) {
  return (
    <div className="rounded-[var(--radius-app)] bg-surface-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
    </div>
  );
}
