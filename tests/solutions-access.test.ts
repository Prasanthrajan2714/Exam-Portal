import { describe, expect, it } from "vitest";
import { canReadSolutions } from "@/lib/exam-window";

/**
 * Who may read an exam's worked solutions.
 *
 * This is the rule that stops a paper's answers leaking to someone still able
 * to sit it, so each condition is pinned separately — loosening any one of them
 * by accident hands out the answers.
 */

const NOW = new Date("2026-08-24T12:00:00.000Z");
const hour = 60 * 60 * 1000;

const student = { batchId: "batch-1" };

const closed = {
  batchId: "batch-1",
  status: "PUBLISHED" as const,
  startsAt: new Date(NOW.getTime() - 3 * hour),
  endsAt: new Date(NOW.getTime() - hour),
  durationMinutes: 60,
};

describe("canReadSolutions", () => {
  it("lets the batch read them once the window has closed", () => {
    expect(canReadSolutions(student, closed, NOW)).toBe(true);
  });

  it("refuses while the exam is still running", () => {
    // The decisive case: a student who submitted early must not be able to read
    // the answers while the rest of the room is still writing.
    const open = {
      ...closed,
      startsAt: new Date(NOW.getTime() - hour),
      endsAt: new Date(NOW.getTime() + hour),
    };
    expect(canReadSolutions(student, open, NOW)).toBe(false);
  });

  it("refuses before the exam has even opened", () => {
    const upcoming = {
      ...closed,
      startsAt: new Date(NOW.getTime() + hour),
      endsAt: new Date(NOW.getTime() + 2 * hour),
    };
    expect(canReadSolutions(student, upcoming, NOW)).toBe(false);
  });

  it("refuses a student from another batch", () => {
    // Another batch may still be scheduled to sit this very paper.
    expect(canReadSolutions({ batchId: "batch-2" }, closed, NOW)).toBe(false);
  });

  it("refuses a draft exam, however old", () => {
    expect(canReadSolutions(student, { ...closed, status: "DRAFT" }, NOW)).toBe(false);
  });

  it("opens at the moment the window shuts, not a moment before", () => {
    const endsAt = closed.endsAt;
    // One millisecond before the end is still the exam.
    expect(canReadSolutions(student, closed, new Date(endsAt.getTime() - 1))).toBe(false);
    expect(canReadSolutions(student, closed, new Date(endsAt.getTime() + 1))).toBe(true);
  });
});
