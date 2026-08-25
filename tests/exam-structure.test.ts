import { describe, expect, it } from "vitest";
import {
  questionFloors,
  structureConflictMessage,
  subjectCountConflicts,
  type StoredSubject,
} from "@/lib/exam-structure";

/**
 * Changing an exam's declared question counts after its paper is uploaded.
 *
 * The case that motivated this: an exam created for 20 Mathematics questions
 * whose paper turned out to hold 10. Publishing is refused because the paper
 * disagrees with the exam, and the only place that number can be corrected used
 * to refuse the edit — a loop with no exit but deleting the paper.
 */

const maths = "sub-maths";
const physics = "sub-phy";

const tenMaths: StoredSubject[] = [
  { subjectId: maths, stored: 10, highestNumber: 10 },
];

describe("subjectCountConflicts", () => {
  it("allows the count to come down to what was actually uploaded", () => {
    // The whole point: 20 declared, 10 uploaded, corrected to 10.
    expect(
      subjectCountConflicts([{ subjectId: maths, questionCount: 10 }], tenMaths),
    ).toEqual([]);
  });

  it("allows the count to go up, leaving the paper incomplete", () => {
    // Publishing still refuses an incomplete paper; that is a separate rule and
    // this one must not pre-empt it.
    expect(
      subjectCountConflicts([{ subjectId: maths, questionCount: 30 }], tenMaths),
    ).toEqual([]);
  });

  it("refuses a count that cannot describe a question already on file", () => {
    expect(
      subjectCountConflicts([{ subjectId: maths, questionCount: 9 }], tenMaths),
    ).toEqual([{ kind: "COUNT_BELOW_STORED", subjectId: maths, highestNumber: 10 }]);
  });

  it("goes by the highest number, not the count, when questions are missing", () => {
    // A paper numbered 1..12 with two gaps still needs room for question 12.
    const gappy: StoredSubject[] = [
      { subjectId: maths, stored: 10, highestNumber: 12 },
    ];
    expect(
      subjectCountConflicts([{ subjectId: maths, questionCount: 10 }], gappy),
    ).toEqual([{ kind: "COUNT_BELOW_STORED", subjectId: maths, highestNumber: 12 }]);
    expect(
      subjectCountConflicts([{ subjectId: maths, questionCount: 12 }], gappy),
    ).toEqual([]);
  });

  it("refuses dropping a subject that carries questions", () => {
    expect(subjectCountConflicts([{ subjectId: physics, questionCount: 20 }], tenMaths)).toEqual([
      { kind: "SUBJECT_REMOVED", subjectId: maths, stored: 10 },
    ]);
  });

  it("allows anything at all while no paper is uploaded", () => {
    expect(subjectCountConflicts([{ subjectId: physics, questionCount: 1 }], [])).toEqual([]);
    const empty: StoredSubject[] = [{ subjectId: maths, stored: 0, highestNumber: 0 }];
    expect(subjectCountConflicts([], empty)).toEqual([]);
  });

  it("reports every conflicting subject, not just the first", () => {
    const both: StoredSubject[] = [
      { subjectId: maths, stored: 10, highestNumber: 10 },
      { subjectId: physics, stored: 5, highestNumber: 5 },
    ];
    const conflicts = subjectCountConflicts(
      [{ subjectId: maths, questionCount: 2 }],
      both,
    );
    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((c) => c.kind).sort()).toEqual([
      "COUNT_BELOW_STORED",
      "SUBJECT_REMOVED",
    ]);
  });
});

describe("questionFloors", () => {
  it("floors a subject at its highest uploaded number", () => {
    expect(questionFloors(tenMaths)).toEqual({ [maths]: 10 });
  });

  it("gives no floor to a subject with nothing uploaded", () => {
    expect(questionFloors([{ subjectId: maths, stored: 0, highestNumber: 0 }])).toEqual({});
  });
});

describe("structureConflictMessage", () => {
  it("says what is wrong and what to do about it", () => {
    const removed = structureConflictMessage(
      { kind: "SUBJECT_REMOVED", subjectId: maths, stored: 10 },
      "Mathematics",
    );
    expect(removed).toContain("Mathematics");
    expect(removed).toContain("10");

    const low = structureConflictMessage(
      { kind: "COUNT_BELOW_STORED", subjectId: maths, highestNumber: 10 },
      "Mathematics",
    );
    expect(low).toContain("cannot go below 10");
  });
});
