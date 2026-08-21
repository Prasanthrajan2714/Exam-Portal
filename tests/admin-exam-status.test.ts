import { describe, expect, it } from "vitest";
import { adminExamStatus } from "@/lib/exam-window";

/**
 * The exams list and the dashboard once called the same state different things
 * ("Live now" against "Active"). They now share this helper, so the rules are
 * pinned here rather than in two pieces of JSX.
 */

const NOW = new Date("2026-08-21T12:00:00.000Z");
const hour = 60 * 60 * 1000;

function exam(overrides: Partial<Parameters<typeof adminExamStatus>[0]> = {}) {
  return {
    startsAt: new Date(NOW.getTime() - hour),
    endsAt: new Date(NOW.getTime() + hour),
    durationMinutes: 30,
    status: "PUBLISHED" as const,
    questionCount: 10,
    ...overrides,
  };
}

describe("adminExamStatus", () => {
  it("is Draft while the exam is unpublished, whatever the window says", () => {
    expect(adminExamStatus(exam({ status: "DRAFT" }), NOW)).toEqual({
      label: "Draft",
      tone: "neutral",
    });
  });

  it("is Draft when no paper has been uploaded, even if published", () => {
    // Publishing already refuses an empty paper, but the list must not claim an
    // exam is running when there is nothing to sit.
    expect(adminExamStatus(exam({ questionCount: 0 }), NOW).label).toBe("Draft");
  });

  it("is Active while the window is open", () => {
    expect(adminExamStatus(exam(), NOW)).toEqual({ label: "Active", tone: "success" });
  });

  it("is Scheduled before the window opens", () => {
    const upcoming = exam({
      startsAt: new Date(NOW.getTime() + hour),
      endsAt: new Date(NOW.getTime() + 2 * hour),
    });
    expect(adminExamStatus(upcoming, NOW)).toEqual({ label: "Scheduled", tone: "info" });
  });

  it("is Closed once the window has passed", () => {
    const finished = exam({
      startsAt: new Date(NOW.getTime() - 3 * hour),
      endsAt: new Date(NOW.getTime() - hour),
    });
    expect(adminExamStatus(finished, NOW)).toEqual({ label: "Closed", tone: "neutral" });
  });

  it("never reports the retired wording", () => {
    const labels = [
      adminExamStatus(exam(), NOW).label,
      adminExamStatus(exam({ status: "DRAFT" }), NOW).label,
    ];
    expect(labels).not.toContain("Live now");
  });
});
