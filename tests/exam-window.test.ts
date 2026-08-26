import { describe, expect, it } from "vitest";
import { formatSpan } from "@/lib/utils";
import {
  canShowResult,
  computeDeadline,
  examCardStatus,
  examPhase,
  extendDeadline,
  formatDuration,
  isWindowOpen,
  secondsRemaining,
} from "@/lib/exam-window";

// Window: 09:00 to 11:00, 30-minute paper.
const exam = {
  startsAt: new Date("2026-08-17T09:00:00.000Z"),
  endsAt: new Date("2026-08-17T11:00:00.000Z"),
  durationMinutes: 30,
};

const at = (iso: string) => new Date(iso);

describe("examPhase", () => {
  it("is UPCOMING before the window", () => {
    expect(examPhase(exam, at("2026-08-17T08:59:59.000Z"))).toBe("UPCOMING");
  });

  it("is OPEN inside the window, including at the boundaries", () => {
    expect(examPhase(exam, at("2026-08-17T09:00:00.000Z"))).toBe("OPEN");
    expect(examPhase(exam, at("2026-08-17T10:30:00.000Z"))).toBe("OPEN");
    expect(examPhase(exam, at("2026-08-17T11:00:00.000Z"))).toBe("OPEN");
  });

  it("is CLOSED after the window", () => {
    expect(examPhase(exam, at("2026-08-17T11:00:00.001Z"))).toBe("CLOSED");
    expect(isWindowOpen(exam, at("2026-08-17T11:30:00.000Z"))).toBe(false);
  });
});

describe("computeDeadline", () => {
  it("gives the full duration when the window allows", () => {
    const deadline = computeDeadline(exam, at("2026-08-17T09:10:00.000Z"));
    expect(deadline.toISOString()).toBe("2026-08-17T09:40:00.000Z");
  });

  it("caps at the window end for a late starter", () => {
    // Starting at 10:50 with 30 minutes left in the day gives 10, not 30.
    const deadline = computeDeadline(exam, at("2026-08-17T10:50:00.000Z"));
    expect(deadline.toISOString()).toBe("2026-08-17T11:00:00.000Z");
  });

  it("includes admin-granted extra time, still capped by the window", () => {
    expect(
      computeDeadline(exam, at("2026-08-17T09:00:00.000Z"), 15).toISOString(),
    ).toBe("2026-08-17T09:45:00.000Z");
    expect(
      computeDeadline(exam, at("2026-08-17T10:00:00.000Z"), 600).toISOString(),
    ).toBe("2026-08-17T11:00:00.000Z");
  });
});

describe("extendDeadline", () => {
  it("adds time onto a deadline that has not passed", () => {
    const extended = extendDeadline(
      exam,
      at("2026-08-17T09:40:00.000Z"),
      10,
      at("2026-08-17T09:30:00.000Z"),
    );
    expect(extended.toISOString()).toBe("2026-08-17T09:50:00.000Z");
  });

  it("re-bases from now when the deadline already slipped past", () => {
    // A student whose power was out for 20 minutes must not be granted an
    // extension that expired while they were offline.
    const extended = extendDeadline(
      exam,
      at("2026-08-17T09:40:00.000Z"),
      10,
      at("2026-08-17T10:00:00.000Z"),
    );
    expect(extended.toISOString()).toBe("2026-08-17T10:10:00.000Z");
  });

  it("never extends past the exam window", () => {
    const extended = extendDeadline(
      exam,
      at("2026-08-17T10:55:00.000Z"),
      60,
      at("2026-08-17T10:56:00.000Z"),
    );
    expect(extended.toISOString()).toBe("2026-08-17T11:00:00.000Z");
  });
});

describe("secondsRemaining", () => {
  it("counts down and never goes negative", () => {
    const attempt = { deadlineAt: at("2026-08-17T09:40:00.000Z") };
    expect(secondsRemaining(attempt, at("2026-08-17T09:39:00.000Z"))).toBe(60);
    expect(secondsRemaining(attempt, at("2026-08-17T09:41:00.000Z"))).toBe(0);
  });
});

describe("examCardStatus", () => {
  const inProgress = {
    status: "IN_PROGRESS" as const,
    deadlineAt: at("2026-08-17T09:40:00.000Z"),
  };

  it("shows AVAILABLE when the window is open and nothing was started", () => {
    expect(examCardStatus(exam, null, false, at("2026-08-17T09:10:00.000Z"))).toBe(
      "AVAILABLE",
    );
  });

  it("shows UPCOMING before the window and MISSED after it", () => {
    expect(examCardStatus(exam, null, false, at("2026-08-17T08:00:00.000Z"))).toBe(
      "UPCOMING",
    );
    expect(examCardStatus(exam, null, false, at("2026-08-17T12:00:00.000Z"))).toBe(
      "MISSED",
    );
  });

  it("shows IN_PROGRESS while an attempt is live", () => {
    expect(examCardStatus(exam, inProgress, false, at("2026-08-17T09:20:00.000Z"))).toBe(
      "IN_PROGRESS",
    );
  });

  it("shows AWAITING_APPROVAL when a reopen request is pending", () => {
    expect(examCardStatus(exam, inProgress, true, at("2026-08-17T09:20:00.000Z"))).toBe(
      "AWAITING_APPROVAL",
    );
  });

  it("shows COMPLETED once submitted, even after the window shuts", () => {
    const submitted = {
      status: "SUBMITTED" as const,
      deadlineAt: at("2026-08-17T09:40:00.000Z"),
    };
    expect(examCardStatus(exam, submitted, false, at("2026-08-17T13:00:00.000Z"))).toBe(
      "COMPLETED",
    );
  });

  it("shows COMPLETED, not MISSED, for an attempt whose time ran out", () => {
    // It was started and will have been auto-graded on whatever was saved, so
    // calling it "missed" would misrepresent what happened.
    expect(examCardStatus(exam, inProgress, false, at("2026-08-17T09:45:00.000Z"))).toBe(
      "COMPLETED",
    );
  });
});

describe("canShowResult", () => {
  const immediate = { ...exam, resultVisibility: "IMMEDIATE" as const };
  const afterWindow = { ...exam, resultVisibility: "AFTER_WINDOW" as const };

  it("always allows an IMMEDIATE exam", () => {
    expect(canShowResult(immediate, at("2026-08-17T09:30:00.000Z"))).toBe(true);
  });

  it("withholds an AFTER_WINDOW exam until the window closes", () => {
    expect(canShowResult(afterWindow, at("2026-08-17T10:59:00.000Z"))).toBe(false);
    expect(canShowResult(afterWindow, at("2026-08-17T11:01:00.000Z"))).toBe(true);
  });
});

describe("formatDuration", () => {
  it("uses mm:ss under an hour and hh:mm:ss above", () => {
    expect(formatDuration(59)).toBe("00:59");
    expect(formatDuration(90)).toBe("01:30");
    expect(formatDuration(3661)).toBe("01:01:01");
  });

  it("clamps negatives to zero", () => {
    expect(formatDuration(-5)).toBe("00:00");
  });
});

describe("formatSpan", () => {
  it("says a short window in minutes", () => {
    expect(formatSpan(45)).toBe("45 min");
    expect(formatSpan(10)).toBe("10 min");
  });

  it("says a whole number of hours without a stray zero", () => {
    expect(formatSpan(120)).toBe("2 h");
    expect(formatSpan(60)).toBe("1 h");
  });

  it("says hours and minutes together", () => {
    expect(formatSpan(150)).toBe("2 h 30 min");
  });

  it("does not go negative when the times are the wrong way round", () => {
    // The window is shown live as the admin types, so it passes through
    // nonsense on the way to something sensible.
    expect(formatSpan(-30)).toBe("0 min");
    expect(formatSpan(0)).toBe("0 min");
  });
});
