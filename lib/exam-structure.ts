/**
 * Whether an exam's declared subject counts may be changed to a given set,
 * knowing which questions are already uploaded against it.
 *
 * Counts used to freeze the moment a paper existed, on the reasoning that
 * changing them would orphan questions. It would not: a Question points at a
 * Subject, not at the ExamSubject row that declares how many there should be.
 * What the freeze did instead was strand the commonest correction of all — an
 * exam set up for 20 questions whose paper turns out to hold 10. The publish
 * gate then refuses the paper for disagreeing with a number that only the edit
 * form can fix, and the form silently declines to fix it. That is a dead end
 * with no way out but deleting the paper.
 *
 * The real invariant is narrower: the declared structure has to be able to
 * describe the questions already on file.
 */

export type StoredSubject = {
  subjectId: string;
  /** How many questions are on file for this subject. */
  stored: number;
  /** The largest question number on file, which is what students see. */
  highestNumber: number;
};

export type SubjectCount = { subjectId: string; questionCount: number };

export type StructureConflict =
  /** The subject carries questions, so the exam cannot stop containing it. */
  | { kind: "SUBJECT_REMOVED"; subjectId: string; stored: number }
  /** The count cannot describe a question numbered above it. */
  | { kind: "COUNT_BELOW_STORED"; subjectId: string; highestNumber: number };

export function subjectCountConflicts(
  next: SubjectCount[],
  stored: StoredSubject[],
): StructureConflict[] {
  const declared = new Map(next.map((s) => [s.subjectId, s.questionCount]));

  return stored.flatMap<StructureConflict>((s) => {
    if (s.stored === 0) return [];

    const count = declared.get(s.subjectId);
    if (count === undefined) {
      return [{ kind: "SUBJECT_REMOVED", subjectId: s.subjectId, stored: s.stored }];
    }
    // Deliberately the highest number rather than the count: a paper numbered
    // 1..12 with two questions missing still needs a declared 12, because
    // question 12 exists and has to belong somewhere.
    if (count < s.highestNumber) {
      return [
        { kind: "COUNT_BELOW_STORED", subjectId: s.subjectId, highestNumber: s.highestNumber },
      ];
    }
    return [];
  });
}

/** The lowest count each subject may now be set to; absent means no floor. */
export function questionFloors(stored: StoredSubject[]): Record<string, number> {
  const floors: Record<string, number> = {};
  for (const s of stored) {
    if (s.stored > 0) floors[s.subjectId] = s.highestNumber;
  }
  return floors;
}

/** The admin-facing reason a structure change was refused. */
export function structureConflictMessage(
  conflict: StructureConflict,
  subjectName: string,
): string {
  if (conflict.kind === "SUBJECT_REMOVED") {
    return (
      `${subjectName} has ${conflict.stored} question(s) already uploaded, so it ` +
      `cannot be taken out of this exam. Delete the paper first if the subject is wrong.`
    );
  }
  return (
    `${subjectName} already has a question numbered ${conflict.highestNumber}, so its ` +
    `count cannot go below ${conflict.highestNumber}. Upload a shorter paper first if ` +
    `the exam really is smaller.`
  );
}
