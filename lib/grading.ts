/**
 * Scoring rules. Called from manual submit, auto-submit on deadline, and the
 * expiry sweep — all three must agree, so none of them may inline this logic.
 */

export type OptionKey = "A" | "B" | "C" | "D";

export type GradableQuestion = {
  id: string;
  subjectId: string;
  correctOption: OptionKey;
  /** Per-question overrides; null means use the exam default. */
  marks: number | null;
  negativeMarks: number | null;
};

export type GradableAnswer = {
  questionId: string;
  selectedOption: OptionKey | null;
};

export type ExamMarking = {
  marksPerCorrect: number;
  negativeMarks: number;
};

export type QuestionOutcome = {
  questionId: string;
  subjectId: string;
  selectedOption: OptionKey | null;
  correctOption: OptionKey;
  /** null when unanswered — distinct from `false`, which means answered wrongly. */
  isCorrect: boolean | null;
  scoreAwarded: number;
};

export type SubjectBreakdown = {
  subjectId: string;
  correct: number;
  wrong: number;
  unanswered: number;
  score: number;
  maxScore: number;
};

export type GradeResult = {
  totalScore: number;
  maxScore: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  outcomes: QuestionOutcome[];
  bySubject: SubjectBreakdown[];
};

/**
 * Grades every question in the exam — not just the ones with an answer row — so
 * an abandoned attempt is scored on the full paper rather than on what happened
 * to be saved.
 *
 * Unanswered scores 0: negative marking applies to wrong answers only, which is
 * the JEE/NEET convention and what the spec's "+4 / -1" describes.
 */
export function gradeAttempt(
  questions: GradableQuestion[],
  answers: GradableAnswer[],
  exam: ExamMarking,
): GradeResult {
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

  const outcomes: QuestionOutcome[] = [];
  const subjects = new Map<string, SubjectBreakdown>();

  let totalScore = 0;
  let maxScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  for (const q of questions) {
    const positive = q.marks ?? exam.marksPerCorrect;
    const negative = q.negativeMarks ?? exam.negativeMarks;
    const selected = answerByQuestion.get(q.id)?.selectedOption ?? null;

    let isCorrect: boolean | null;
    let scoreAwarded: number;

    if (selected === null) {
      isCorrect = null;
      scoreAwarded = 0;
      unansweredCount++;
    } else if (selected === q.correctOption) {
      isCorrect = true;
      scoreAwarded = positive;
      correctCount++;
    } else {
      isCorrect = false;
      // Stored negative marks are a magnitude ("1" means -1), so subtract it.
      scoreAwarded = -Math.abs(negative);
      wrongCount++;
    }

    totalScore += scoreAwarded;
    maxScore += positive;

    outcomes.push({
      questionId: q.id,
      subjectId: q.subjectId,
      selectedOption: selected,
      correctOption: q.correctOption,
      isCorrect,
      scoreAwarded,
    });

    const bucket = subjects.get(q.subjectId) ?? {
      subjectId: q.subjectId,
      correct: 0,
      wrong: 0,
      unanswered: 0,
      score: 0,
      maxScore: 0,
    };
    if (isCorrect === true) bucket.correct++;
    else if (isCorrect === false) bucket.wrong++;
    else bucket.unanswered++;
    bucket.score += scoreAwarded;
    bucket.maxScore += positive;
    subjects.set(q.subjectId, bucket);
  }

  return {
    // Float marks (e.g. 0.5 negative) accumulate binary error; round to 2dp so a
    // scorecard never reads "23.999999999999996".
    totalScore: round2(totalScore),
    maxScore: round2(maxScore),
    correctCount,
    wrongCount,
    unansweredCount,
    outcomes,
    bySubject: [...subjects.values()].map((s) => ({
      ...s,
      score: round2(s.score),
      maxScore: round2(s.maxScore),
    })),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Competition ranking over a set of scores: equal scores share a rank and the
 * next rank skips accordingly (1, 2, 2, 4).
 */
export function rankScores<T extends { totalScore: number | null }>(
  rows: T[],
): (T & { rank: number })[] {
  const sorted = [...rows].sort(
    (a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0),
  );
  let lastScore: number | null = null;
  let lastRank = 0;
  return sorted.map((row, index) => {
    const score = row.totalScore ?? 0;
    if (lastScore === null || score !== lastScore) {
      lastRank = index + 1;
      lastScore = score;
    }
    return { ...row, rank: lastRank };
  });
}
