import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { findKeyEntry, parseAnswerKey } from "@/lib/answer-key";

async function keyFile(
  headers: string[],
  rows: (string | number)[][],
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Answer Key");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([new Uint8Array(buffer as ArrayBuffer)], "key.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseAnswerKey", () => {
  it("reads subject, number and correct option", async () => {
    const result = await parseAnswerKey(
      await keyFile(
        ["Subject", "Q.No", "Correct Option"],
        [
          ["Physics", 1, "B"],
          ["Physics", 2, "D"],
        ],
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      subjectName: "Physics",
      number: 1,
      correctOption: "B",
    });
  });

  it("accepts the answer formats people actually type", async () => {
    const result = await parseAnswerKey(
      await keyFile(
        ["Subject", "Q.No", "Answer"],
        [
          ["Physics", 1, "a"],
          ["Physics", 2, "(C)"],
          ["Physics", 3, "Option D"],
          ["Physics", 4, 2], // numbered options: 2 -> B
        ],
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.entries.map((e) => e.correctOption)).toEqual(["A", "C", "D", "B"]);
  });

  it("matches headers loosely", async () => {
    const result = await parseAnswerKey(
      await keyFile(
        ["subject_name", "question no", "CORRECT ANSWER"],
        [["Chemistry", 1, "A"]],
      ),
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].subjectName).toBe("Chemistry");
  });

  it("reads optional per-question mark overrides", async () => {
    const result = await parseAnswerKey(
      await keyFile(
        ["Subject", "Q.No", "Correct Option", "Marks", "Negative"],
        [["Physics", 1, "A", 8, 2]],
      ),
    );
    expect(result.entries[0].marks).toBe(8);
    expect(result.entries[0].negativeMarks).toBe(2);
  });

  it("stores negative marks as a magnitude even when written as -1", async () => {
    const result = await parseAnswerKey(
      await keyFile(
        ["Subject", "Q.No", "Correct Option", "Negative"],
        [["Physics", 1, "A", -1]],
      ),
    );
    expect(result.entries[0].negativeMarks).toBe(1);
  });

  it("reports a bad option rather than guessing", async () => {
    const result = await parseAnswerKey(
      await keyFile(["Subject", "Q.No", "Correct Option"], [["Physics", 1, "E"]]),
    );
    expect(result.entries).toHaveLength(0);
    expect(result.errors[0]).toContain("not one of A, B, C or D");
  });

  it("reports duplicate entries for the same question", async () => {
    const result = await parseAnswerKey(
      await keyFile(
        ["Subject", "Q.No", "Correct Option"],
        [
          ["Physics", 1, "A"],
          ["Physics", 1, "B"],
        ],
      ),
    );
    expect(result.entries).toHaveLength(1);
    expect(result.errors[0]).toContain("more than once");
  });
});

describe("findKeyEntry", () => {
  const entries = [
    { subjectName: "Physics", number: 1, correctOption: "A" as const, marks: null, negativeMarks: null },
    { subjectName: "Chemistry", number: 1, correctOption: "B" as const, marks: null, negativeMarks: null },
  ];

  it("matches on subject and number, ignoring case", () => {
    expect(findKeyEntry(entries, "physics", 1)?.correctOption).toBe("A");
    expect(findKeyEntry(entries, "CHEMISTRY", 1)?.correctOption).toBe("B");
  });

  it("returns nothing when the subject is not in a subject-bearing key", () => {
    expect(findKeyEntry(entries, "Biology", 1)).toBeUndefined();
  });

  it("falls back to number alone when the key has no subject column", () => {
    // A single-subject paper does not need to repeat the subject on every row.
    const bare = [
      { subjectName: "", number: 1, correctOption: "C" as const, marks: null, negativeMarks: null },
    ];
    expect(findKeyEntry(bare, "Mathematics", 1)?.correctOption).toBe("C");
  });
});
