import { describe, expect, it } from "vitest";
import {
  type GradableQuestion,
  gradeAttempt,
  rankScores,
} from "@/lib/grading";

const exam = { marksPerCorrect: 4, negativeMarks: 1 };

function question(
  id: string,
  correct: "A" | "B" | "C" | "D",
  overrides: Partial<GradableQuestion> = {},
): GradableQuestion {
  return {
    id,
    subjectId: "physics",
    correctOption: correct,
    marks: null,
    negativeMarks: null,
    ...overrides,
  };
}

describe("gradeAttempt", () => {
  it("applies +4 for correct, -1 for wrong and 0 for unanswered", () => {
    const questions = [
      question("q1", "A"),
      question("q2", "B"),
      question("q3", "C"),
    ];
    const answers = [
      { questionId: "q1", selectedOption: "A" as const }, // correct  +4
      { questionId: "q2", selectedOption: "D" as const }, // wrong    -1
      { questionId: "q3", selectedOption: null }, //          skipped   0
    ];

    const result = gradeAttempt(questions, answers, exam);

    expect(result.totalScore).toBe(3);
    expect(result.correctCount).toBe(1);
    expect(result.wrongCount).toBe(1);
    expect(result.unansweredCount).toBe(1);
    expect(result.maxScore).toBe(12);
  });

  it("treats a question with no answer row as unanswered, not wrong", () => {
    // An abandoned attempt has no rows for questions never reached; scoring
    // those as wrong would push students below zero for a power cut.
    const questions = [question("q1", "A"), question("q2", "B")];
    const result = gradeAttempt(questions, [], exam);

    expect(result.unansweredCount).toBe(2);
    expect(result.wrongCount).toBe(0);
    expect(result.totalScore).toBe(0);
  });

  it("grades the whole paper even when answers exist for only part of it", () => {
    const questions = [question("q1", "A"), question("q2", "B"), question("q3", "C")];
    const result = gradeAttempt(
      questions,
      [{ questionId: "q1", selectedOption: "A" }],
      exam,
    );

    expect(result.outcomes).toHaveLength(3);
    expect(result.totalScore).toBe(4);
    expect(result.unansweredCount).toBe(2);
  });

  it("honours per-question mark overrides from the answer key", () => {
    const questions = [
      question("q1", "A", { marks: 10, negativeMarks: 5 }),
      question("q2", "B"),
    ];
    const answers = [
      { questionId: "q1", selectedOption: "A" as const }, // +10
      { questionId: "q2", selectedOption: "A" as const }, // -1 (exam default)
    ];

    const result = gradeAttempt(questions, answers, exam);
    expect(result.totalScore).toBe(9);
    expect(result.maxScore).toBe(14);
  });

  it("treats stored negative marks as a magnitude", () => {
    // The form asks for "1" meaning -1; a key that supplies -1 must not add.
    const questions = [question("q1", "A", { negativeMarks: -2 })];
    const result = gradeAttempt(
      questions,
      [{ questionId: "q1", selectedOption: "B" }],
      exam,
    );
    expect(result.totalScore).toBe(-2);
  });

  it("supports exams with no negative marking", () => {
    const questions = [question("q1", "A"), question("q2", "B")];
    const result = gradeAttempt(
      questions,
      [
        { questionId: "q1", selectedOption: "C" },
        { questionId: "q2", selectedOption: "D" },
      ],
      { marksPerCorrect: 1, negativeMarks: 0 },
    );
    expect(result.totalScore).toBe(0);
    expect(result.wrongCount).toBe(2);
  });

  it("breaks the score down per subject", () => {
    const questions = [
      question("m1", "A", { subjectId: "maths" }),
      question("m2", "B", { subjectId: "maths" }),
      question("p1", "C", { subjectId: "physics" }),
    ];
    const answers = [
      { questionId: "m1", selectedOption: "A" as const }, // maths   +4
      { questionId: "m2", selectedOption: "C" as const }, // maths   -1
      { questionId: "p1", selectedOption: "C" as const }, // physics +4
    ];

    const result = gradeAttempt(questions, answers, exam);
    const maths = result.bySubject.find((s) => s.subjectId === "maths")!;
    const physics = result.bySubject.find((s) => s.subjectId === "physics")!;

    expect(maths.score).toBe(3);
    expect(maths.correct).toBe(1);
    expect(maths.wrong).toBe(1);
    expect(physics.score).toBe(4);
    expect(physics.maxScore).toBe(4);
  });

  it("rounds fractional totals so scorecards do not show float noise", () => {
    const questions = [
      question("q1", "A", { marks: 0.1 }),
      question("q2", "A", { marks: 0.2 }),
    ];
    const result = gradeAttempt(
      questions,
      [
        { questionId: "q1", selectedOption: "A" },
        { questionId: "q2", selectedOption: "A" },
      ],
      exam,
    );
    expect(result.totalScore).toBe(0.3);
  });

  it("distinguishes unanswered (null) from wrong (false)", () => {
    const questions = [question("q1", "A"), question("q2", "A")];
    const result = gradeAttempt(
      questions,
      [
        { questionId: "q1", selectedOption: null },
        { questionId: "q2", selectedOption: "B" },
      ],
      exam,
    );
    expect(result.outcomes[0].isCorrect).toBeNull();
    expect(result.outcomes[1].isCorrect).toBe(false);
  });
});

describe("rankScores", () => {
  it("ranks highest first", () => {
    const ranked = rankScores([
      { name: "a", totalScore: 10 },
      { name: "b", totalScore: 30 },
      { name: "c", totalScore: 20 },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["b", "c", "a"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("shares a rank on ties and skips the next (1, 2, 2, 4)", () => {
    const ranked = rankScores([
      { name: "a", totalScore: 40 },
      { name: "b", totalScore: 30 },
      { name: "c", totalScore: 30 },
      { name: "d", totalScore: 10 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("treats an ungraded attempt as zero rather than dropping it", () => {
    const ranked = rankScores([
      { name: "a", totalScore: null },
      { name: "b", totalScore: 5 },
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].name).toBe("b");
  });
});
