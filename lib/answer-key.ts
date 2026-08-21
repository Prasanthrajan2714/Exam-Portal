import "server-only";
import { readFirstSheet } from "./xlsx";

/**
 * Reads the .xlsx answer key: which option is correct for each question, and
 * optionally per-question mark overrides.
 *
 * Expected columns (header row, matched loosely):
 *   Subject | Q.No | Correct Option | Marks (optional) | Negative (optional)
 */

export type OptionKey = "A" | "B" | "C" | "D";

export type AnswerKeyEntry = {
  subjectName: string;
  number: number;
  correctOption: OptionKey;
  marks: number | null;
  negativeMarks: number | null;
};

export type AnswerKeyResult = {
  entries: AnswerKeyEntry[];
  errors: string[];
};

const ALIASES = {
  subject: ["subject", "subjectname", "sub"],
  number: ["qno", "q", "questionno", "questionnumber", "number", "no", "sno", "slno"],
  answer: ["correctoption", "correct", "answer", "correctanswer", "key", "ans", "option"],
  marks: ["marks", "mark", "positivemarks", "score"],
  negative: ["negative", "negativemarks", "negativemark", "penalty"],
} as const;

function pick(row: Record<string, string>, field: keyof typeof ALIASES): string {
  for (const alias of ALIASES[field]) {
    if (row[alias] !== undefined && row[alias] !== "") return row[alias];
  }
  return "";
}

/** Accepts "A", "a", "(A)", "1".."4", and "Option A". */
function normaliseOption(raw: string): OptionKey | null {
  const cleaned = raw.trim().toUpperCase().replace(/^OPTION\s*/i, "").replace(/[()."']/g, "");
  if (["A", "B", "C", "D"].includes(cleaned)) return cleaned as OptionKey;
  // Some answer keys number the options instead of lettering them.
  const numeric: Record<string, OptionKey> = { "1": "A", "2": "B", "3": "C", "4": "D" };
  return numeric[cleaned] ?? null;
}

export async function parseAnswerKey(file: File): Promise<AnswerKeyResult> {
  const errors: string[] = [];
  let sheet;
  try {
    sheet = await readFirstSheet(await file.arrayBuffer());
  } catch {
    return { entries: [], errors: ["That file could not be read as an Excel workbook."] };
  }

  if (sheet.rows.length === 0) {
    return { entries: [], errors: ["The answer key has no rows below the header."] };
  }

  const entries: AnswerKeyEntry[] = [];
  const seen = new Set<string>();

  for (const { rowNumber, data } of sheet.rows) {
    const subjectName = pick(data, "subject").trim();
    const rawNumber = pick(data, "number");
    const rawAnswer = pick(data, "answer");

    const number = Number(String(rawNumber).replace(/[^0-9]/g, ""));
    if (!Number.isFinite(number) || number <= 0) {
      errors.push(`Row ${rowNumber}: question number "${rawNumber}" is not valid.`);
      continue;
    }

    const correctOption = normaliseOption(rawAnswer);
    if (!correctOption) {
      errors.push(
        `Row ${rowNumber}: correct option "${rawAnswer}" is not one of A, B, C or D.`,
      );
      continue;
    }

    const key = `${subjectName.toLowerCase()}#${number}`;
    if (seen.has(key)) {
      errors.push(
        `Row ${rowNumber}: question ${number}${
          subjectName ? ` in ${subjectName}` : ""
        } appears more than once in the key.`,
      );
      continue;
    }
    seen.add(key);

    const marksRaw = pick(data, "marks");
    const negativeRaw = pick(data, "negative");

    entries.push({
      subjectName,
      number,
      correctOption,
      marks: marksRaw !== "" && Number.isFinite(Number(marksRaw)) ? Number(marksRaw) : null,
      negativeMarks:
        negativeRaw !== "" && Number.isFinite(Number(negativeRaw))
          ? Math.abs(Number(negativeRaw))
          : null,
    });
  }

  return { entries, errors };
}

/**
 * Looks up a key entry for a question. Subject is matched case-insensitively and
 * ignored entirely when the key has no Subject column — a single-subject paper
 * does not need one.
 */
export function findKeyEntry(
  entries: AnswerKeyEntry[],
  subjectName: string,
  number: number,
): AnswerKeyEntry | undefined {
  const bySubject = entries.find(
    (e) =>
      e.number === number &&
      e.subjectName.toLowerCase() === subjectName.toLowerCase(),
  );
  if (bySubject) return bySubject;

  const keyHasSubjects = entries.some((e) => e.subjectName !== "");
  if (keyHasSubjects) return undefined;
  return entries.find((e) => e.number === number);
}
