import { describe, expect, it } from "vitest";
import { examCardSection, examCardStatus, type ExamCardStatus } from "@/lib/exam-window";

/**
 * What the student sees on their dashboard after an interruption.
 *
 * The dashboard used to offer "Continue" and "ask to resume" together for any
 * attempt in progress. Once the exam screen has been opened it refuses a second
 * entry until an admin approves a reopen, so Continue only walked the student
 * into that refusal. These pin the four states apart.
 */

const NOW = new Date("2026-08-24T12:00:00.000Z");
const hour = 60 * 60 * 1000;

const openWindow = {
  startsAt: new Date(NOW.getTime() - hour),
  endsAt: new Date(NOW.getTime() + hour),
  durationMinutes: 60,
};

const live = { deadlineAt: new Date(NOW.getTime() + 30 * 60_000) };

describe("examCardStatus after an interruption", () => {
  it("offers Continue while the exam has never been opened", () => {
    // startAttempt creates the attempt; the screen has not claimed it yet.
    const status = examCardStatus(
      openWindow,
      { status: "IN_PROGRESS", ...live, sessionClaimedAt: null },
      false,
      NOW,
    );
    expect(status).toBe("IN_PROGRESS");
  });

  it("asks for a reopen once the screen has been opened and left", () => {
    // Power cut, closed tab, lost connection — all land here.
    const status = examCardStatus(
      openWindow,
      { status: "IN_PROGRESS", ...live, sessionClaimedAt: new Date(NOW.getTime() - 10 * 60_000) },
      false,
      NOW,
    );
    expect(status).toBe("NEEDS_REOPEN");
  });

  it("waits quietly while a request is pending, offering neither", () => {
    const status = examCardStatus(
      openWindow,
      { status: "IN_PROGRESS", ...live, sessionClaimedAt: new Date(NOW.getTime() - 10 * 60_000) },
      true,
      NOW,
    );
    expect(status).toBe("AWAITING_APPROVAL");
  });

  it("goes back to Continue once an admin has approved", () => {
    // Approving clears sessionClaimedAt and resolves the request, so the
    // student gets a plain Continue and is not asked to request again.
    const status = examCardStatus(
      openWindow,
      { status: "IN_PROGRESS", ...live, sessionClaimedAt: null },
      false,
      NOW,
    );
    expect(status).toBe("IN_PROGRESS");
  });

  it("is completed once submitted, whatever the session state", () => {
    expect(
      examCardStatus(
        openWindow,
        { status: "SUBMITTED", ...live, sessionClaimedAt: new Date() },
        false,
        NOW,
      ),
    ).toBe("COMPLETED");
  });

  it("is completed when the attempt's own time has run out", () => {
    expect(
      examCardStatus(
        openWindow,
        {
          status: "IN_PROGRESS",
          deadlineAt: new Date(NOW.getTime() - 60_000),
          sessionClaimedAt: new Date(),
        },
        false,
        NOW,
      ),
    ).toBe("COMPLETED");
  });

  it("treats a missing sessionClaimedAt as never opened", () => {
    // The field is optional on the input; older callers must keep working.
    expect(
      examCardStatus(openWindow, { status: "IN_PROGRESS", ...live }, false, NOW),
    ).toBe("IN_PROGRESS");
  });
});

describe("examCardSection", () => {
  it("gives every status a home", () => {
    // A status belonging to no section does not merely look wrong — its card
    // disappears from the dashboard, which is how an interrupted exam once
    // vanished for the student entirely.
    const all: ExamCardStatus[] = [
      "UPCOMING",
      "AVAILABLE",
      "IN_PROGRESS",
      "NEEDS_REOPEN",
      "AWAITING_APPROVAL",
      "COMPLETED",
      "MISSED",
    ];
    for (const status of all) {
      expect(["LIVE", "UPCOMING", "PAST"], status).toContain(examCardSection(status));
    }
  });

  it("puts an interrupted exam in front of the student, not in the past", () => {
    expect(examCardSection("NEEDS_REOPEN")).toBe("LIVE");
    expect(examCardSection("AWAITING_APPROVAL")).toBe("LIVE");
  });
});
