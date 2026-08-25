/**
 * Single source of truth for "can this exam be entered right now, and how much
 * time is left". The dashboard, the start action, the auto-save endpoint and the
 * submit endpoint all call in here — a second copy of this arithmetic anywhere
 * else is how exam timers end up disagreeing with each other.
 *
 * Everything is computed from server-supplied instants. The countdown the student
 * sees is display only; the server never trusts a clock it did not read itself.
 */

export type ExamTiming = {
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
};

export type AttemptTiming = {
  startedAt: Date;
  deadlineAt: Date;
  extraTimeMinutes: number;
};

export type ExamPhase = "UPCOMING" | "OPEN" | "CLOSED";

export function examPhase(exam: ExamTiming, now: Date = new Date()): ExamPhase {
  if (now < exam.startsAt) return "UPCOMING";
  if (now > exam.endsAt) return "CLOSED";
  return "OPEN";
}

export function isWindowOpen(exam: ExamTiming, now: Date = new Date()): boolean {
  return examPhase(exam, now) === "OPEN";
}

export type AdminExamStatus = {
  label: "Draft" | "Active" | "Scheduled" | "Closed";
  tone: "neutral" | "success" | "info";
};

/**
 * How an exam reads to an admin: draft until its paper is in and it is
 * published, and from then on the window decides. Shared by the exams list and
 * the dashboard, which had drifted into calling the same state different names.
 */
export function adminExamStatus(
  exam: ExamTiming & { status: "DRAFT" | "PUBLISHED"; questionCount: number },
  now: Date = new Date(),
): AdminExamStatus {
  if (exam.status !== "PUBLISHED" || exam.questionCount === 0) {
    return { label: "Draft", tone: "neutral" };
  }
  switch (examPhase(exam, now)) {
    case "OPEN":
      return { label: "Active", tone: "success" };
    case "UPCOMING":
      return { label: "Scheduled", tone: "info" };
    default:
      return { label: "Closed", tone: "neutral" };
  }
}

/**
 * When a fresh attempt must end: the student's full duration, but never past the
 * exam window. Starting a 30-minute test 10 minutes before the window closes
 * gives 10 minutes, not 30.
 */
export function computeDeadline(
  exam: ExamTiming,
  startedAt: Date,
  extraTimeMinutes = 0,
): Date {
  const byDuration = new Date(
    startedAt.getTime() + (exam.durationMinutes + extraTimeMinutes) * 60_000,
  );
  return byDuration < exam.endsAt ? byDuration : exam.endsAt;
}

/**
 * Deadline after an admin grants extra minutes on a reopen. Still capped by the
 * exam window, so an approval cannot silently extend the exam for one student
 * past the point where everyone else's paper closed.
 */
export function extendDeadline(
  exam: ExamTiming,
  currentDeadline: Date,
  extraMinutes: number,
  now: Date = new Date(),
): Date {
  // Re-base from now when the deadline already slipped past, otherwise a student
  // whose power was out for an hour gets an extension that is already expired.
  const from = currentDeadline > now ? currentDeadline : now;
  const extended = new Date(from.getTime() + extraMinutes * 60_000);
  return extended < exam.endsAt ? extended : exam.endsAt;
}

export function secondsRemaining(
  attempt: Pick<AttemptTiming, "deadlineAt">,
  now: Date = new Date(),
): number {
  return Math.max(
    0,
    Math.floor((attempt.deadlineAt.getTime() - now.getTime()) / 1000),
  );
}

export function isAttemptExpired(
  attempt: Pick<AttemptTiming, "deadlineAt">,
  now: Date = new Date(),
): boolean {
  return now >= attempt.deadlineAt;
}

// ---------------------------------------------------------------- dashboard status

export type ExamCardStatus =
  | "UPCOMING"
  | "AVAILABLE"
  | "IN_PROGRESS"
  /** Started, then the screen was left — only an admin can let them back in. */
  | "NEEDS_REOPEN"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "MISSED";

/**
 * The chip a student sees on their dashboard.
 *
 * Note the deliberate ordering: a submitted attempt reads COMPLETED even after
 * the window shuts, and an unfinished attempt whose window has closed reads
 * COMPLETED too — it will have been auto-graded on whatever was saved, so calling
 * it "missed" would be wrong.
 */
export function examCardStatus(
  exam: ExamTiming,
  attempt:
    | {
        status: "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
        deadlineAt: Date;
        /**
         * Set the first time the exam screen is opened. While it is set the
         * exam screen refuses re-entry, so the dashboard must not offer to
         * continue — that button only leads to the refusal.
         */
        sessionClaimedAt?: Date | null;
      }
    | null,
  hasPendingReopen: boolean,
  now: Date = new Date(),
): ExamCardStatus {
  if (attempt) {
    if (attempt.status === "SUBMITTED" || attempt.status === "EXPIRED") {
      return "COMPLETED";
    }
    if (hasPendingReopen) return "AWAITING_APPROVAL";
    if (isAttemptExpired(attempt, now) || !isWindowOpen(exam, now)) {
      return "COMPLETED";
    }
    // Approving a reopen clears sessionClaimedAt, which is what turns this back
    // into a plain "continue".
    if (attempt.sessionClaimedAt) return "NEEDS_REOPEN";
    return "IN_PROGRESS";
  }

  const phase = examPhase(exam, now);
  if (phase === "UPCOMING") return "UPCOMING";
  if (phase === "CLOSED") return "MISSED";
  return "AVAILABLE";
}

export type ExamCardSection = "LIVE" | "UPCOMING" | "PAST";

/**
 * Which heading a card sits under.
 *
 * Exhaustive on purpose: the dashboard used to list the live statuses inline,
 * and adding NEEDS_REOPEN without touching that list dropped interrupted exams
 * off the page entirely — the student saw nothing at all. A `switch` over the
 * union makes the compiler refuse the next status that forgets a home.
 */
export function examCardSection(status: ExamCardStatus): ExamCardSection {
  switch (status) {
    case "AVAILABLE":
    case "IN_PROGRESS":
    case "NEEDS_REOPEN":
    case "AWAITING_APPROVAL":
      return "LIVE";
    case "UPCOMING":
      return "UPCOMING";
    case "COMPLETED":
    case "MISSED":
      return "PAST";
  }
}

/**
 * May this student read this exam's worked solutions?
 *
 * Open to the whole batch once the window shuts, including students who never
 * sat it — the paper is over and the solutions are teaching material from that
 * point on. Deliberately keyed on the window rather than the student's own
 * attempt: someone who submitted early must not be able to read the answers
 * while the rest of the room is still writing.
 *
 * A rule rather than four conditions inline in a page, because loosening any
 * one of them by accident hands out an unsat paper's answers.
 */
export function canReadSolutions(
  student: { batchId: string },
  exam: ExamTiming & { batchId: string; status: "DRAFT" | "PUBLISHED" },
  now: Date = new Date(),
): boolean {
  if (exam.batchId !== student.batchId) return false;
  if (exam.status !== "PUBLISHED") return false;
  return examPhase(exam, now) === "CLOSED";
}

/** Whether a result may be shown to the student yet. */
export function canShowResult(
  exam: ExamTiming & { resultVisibility: "IMMEDIATE" | "AFTER_WINDOW" },
  now: Date = new Date(),
): boolean {
  if (exam.resultVisibility === "IMMEDIATE") return true;
  return now > exam.endsAt;
}

// ---------------------------------------------------------------- formatting

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}
