import { Document, Packer, Paragraph, TextRun } from "docx";
import { describe, expect, it } from "vitest";
import { parseQuestionPaper } from "@/lib/docx-parser";

/**
 * The parser is the riskiest part of the system — a mis-read paper means a
 * whole batch sits a wrong exam. These build genuine .docx files in memory and
 * push them through the real parser.
 */

async function docxFrom(lines: (string | Paragraph)[]): Promise<File> {
  const document = new Document({
    sections: [
      {
        children: lines.map((line) =>
          typeof line === "string" ? new Paragraph({ text: line }) : line,
        ),
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);
  return new File([new Uint8Array(buffer)], "paper.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

const SIMPLE = [
  "[SUBJECT: Physics]",
  "1. What is the SI unit of force?",
  "A) Joule",
  "B) Newton",
  "C) Watt",
  "D) Pascal",
  "2. Which quantity is a vector?",
  "A) Speed",
  "B) Mass",
  "C) Velocity",
  "D) Time",
];

describe("parseQuestionPaper", () => {
  it("reads questions, options and the subject heading", async () => {
    const result = await parseQuestionPaper(await docxFrom(SIMPLE), "exam-test-1");

    expect(result.questions).toHaveLength(2);
    expect(result.subjectNames).toEqual(["Physics"]);

    const [first, second] = result.questions;
    expect(first.subjectName).toBe("Physics");
    expect(first.number).toBe(1);
    expect(first.text).toBe("What is the SI unit of force?");
    expect(first.options).toEqual({
      A: "Joule",
      B: "Newton",
      C: "Watt",
      D: "Pascal",
    });
    expect(first.issues).toEqual([]);

    expect(second.number).toBe(2);
    expect(second.options.C).toBe("Velocity");
  });

  it("handles several subjects and restarts numbering in each", async () => {
    const result = await parseQuestionPaper(
      await docxFrom([
        ...SIMPLE,
        "[SUBJECT: Chemistry]",
        "1. What is the atomic number of carbon?",
        "A) 4",
        "B) 6",
        "C) 8",
        "D) 12",
      ]),
      "exam-test-2",
    );

    expect(result.questions).toHaveLength(3);
    expect(result.subjectNames).toEqual(["Physics", "Chemistry"]);
    const chemistry = result.questions.filter((q) => q.subjectName === "Chemistry");
    expect(chemistry).toHaveLength(1);
    expect(chemistry[0].number).toBe(1);
    expect(chemistry[0].options.B).toBe("6");
  });

  it("accepts the numbering and bracket styles people actually type", async () => {
    const result = await parseQuestionPaper(
      await docxFrom([
        "[SUBJECT: Mathematics]",
        "Q1. First question",
        "(A) alpha",
        "(B) beta",
        "(C) gamma",
        "(D) delta",
        "2) Second question",
        "a. lower a",
        "b. lower b",
        "c. lower c",
        "d. lower d",
      ]),
      "exam-test-3",
    );

    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].number).toBe(1);
    expect(result.questions[0].options.A).toBe("alpha");
    // Option letters are case-insensitive — many papers use lowercase.
    expect(result.questions[1].number).toBe(2);
    expect(result.questions[1].options.D).toBe("lower d");
  });

  it("joins text that Word split across paragraphs", async () => {
    const result = await parseQuestionPaper(
      await docxFrom([
        "[SUBJECT: Physics]",
        "1. A body starts from rest and accelerates uniformly.",
        "Find the distance covered in the first five seconds.",
        "A) 10 m",
        "B) 20 m",
        "C) 25 m",
        "D) 50 m",
      ]),
      "exam-test-4",
    );

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].text).toBe(
      "A body starts from rest and accelerates uniformly. Find the distance covered in the first five seconds.",
    );
  });

  it("preserves superscripts instead of silently flattening them", async () => {
    // x2 would be a different — and wrong — question from x².
    const paragraph = new Paragraph({
      children: [
        new TextRun({ text: "1. Differentiate x" }),
        new TextRun({ text: "2", superScript: true }),
        new TextRun({ text: " with respect to x." }),
      ],
    });
    const result = await parseQuestionPaper(
      await docxFrom([
        "[SUBJECT: Mathematics]",
        paragraph,
        "A) x",
        "B) 2x",
        "C) x/2",
        "D) 1",
      ]),
      "exam-test-5",
    );

    expect(result.questions[0].text).toBe("Differentiate x² with respect to x.");
  });

  it("flags a question that is missing an option", async () => {
    const result = await parseQuestionPaper(
      await docxFrom([
        "[SUBJECT: Physics]",
        "1. Incomplete question",
        "A) only one",
        "B) two",
        "C) three",
      ]),
      "exam-test-6",
    );

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].issues.join(" ")).toContain("Option D");
  });

  it("flags duplicate question numbers within a subject", async () => {
    const result = await parseQuestionPaper(
      await docxFrom([
        "[SUBJECT: Physics]",
        "1. First",
        "A) a",
        "B) b",
        "C) c",
        "D) d",
        "1. Duplicate number",
        "A) a",
        "B) b",
        "C) c",
        "D) d",
      ]),
      "exam-test-7",
    );

    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].issues.join(" ")).toContain("more than once");
  });

  it("warns rather than throwing when the document has no questions", async () => {
    const result = await parseQuestionPaper(
      await docxFrom(["Just some prose.", "No questions at all."]),
      "exam-test-8",
    );

    expect(result.questions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.message.includes("No questions"))).toBe(true);
  });

  it("flags questions that appear before any subject heading", async () => {
    const result = await parseQuestionPaper(
      await docxFrom(["1. Orphan question", "A) a", "B) b", "C) c", "D) d"]),
      "exam-test-9",
    );

    expect(result.questions[0].subjectName).toBe("");
    expect(result.questions[0].issues.join(" ")).toContain("No subject");
  });
});
