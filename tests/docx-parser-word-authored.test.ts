import {
  AlignmentType,
  Document,
  LevelFormat,
  Math as OfficeMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSuperScript,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { describe, expect, it } from "vitest";
import { parseQuestionPaper } from "@/lib/docx-parser";

/**
 * Papers as people actually type them in Word, rather than as the template asks.
 *
 * Both cases here came off a real upload that produced nothing but "Ignored text
 * outside any question": the questions were a Word numbered list, so the "1."
 * lives in the list formatting and never appears in the text, and two of the
 * options were equations typed with Insert → Equation, which mammoth drops.
 */

async function wordDocx(children: Paragraph[]): Promise<File> {
  const document = new Document({
    numbering: {
      config: [
        {
          reference: "questions",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START },
            { level: 1, format: LevelFormat.UPPER_LETTER, text: "%2)", alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(document);
  return new File([new Uint8Array(buffer)], "paper.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/** A paragraph Word numbers itself — the number is formatting, not text. */
function numbered(text: string, level = 0): Paragraph {
  return new Paragraph({
    numbering: { reference: "questions", level },
    children: [new TextRun(text)],
  });
}

function plain(text: string): Paragraph {
  return new Paragraph({ text });
}

function fractionOption(prefix: string, numerator: string, denominator: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun(prefix),
      new OfficeMath({
        children: [
          new MathFraction({
            numerator: [new MathRun(numerator)],
            denominator: [new MathRun(denominator)],
          }),
        ],
      }),
    ],
  });
}

const ABCD = [plain("A) a"), plain("B) b"), plain("C) c"), plain("D) d")];

describe("questions Word numbered automatically", () => {
  it("numbers questions that carry no number of their own", async () => {
    const result = await parseQuestionPaper(
      await wordDocx([
        plain("[SUBJECT: Physics]"),
        numbered("A cable supporting a load W is cut in two. Either part supports"),
        plain("A) W/4"),
        plain("B) W/2"),
        plain("C) W"),
        plain("D) 2W"),
        numbered("The breaking stress of a wire of radius 2r is"),
        plain("A) F/4"),
        plain("B) F/2"),
        plain("C) F"),
        plain("D) 2F"),
      ]),
      "exam-auto-1",
    );

    expect(result.questions).toHaveLength(2);
    expect(result.questions.map((q) => q.number)).toEqual([1, 2]);
    expect(result.questions[0].text).toContain("A cable supporting a load W");
    expect(result.questions[0].options.D).toBe("2W");
    expect(result.questions.flatMap((q) => q.issues)).toEqual([]);
    // The reported failure: every line thrown away as stray text.
    expect(result.warnings.some((w) => w.message.includes("Ignored text"))).toBe(false);
    expect(result.warnings.some((w) => w.message.includes("no number"))).toBe(true);
  });

  it("continues from the last typed number in the same subject", async () => {
    const result = await parseQuestionPaper(
      await wordDocx([
        plain("[SUBJECT: Physics]"),
        plain("7. A typed question"),
        ...ABCD,
        numbered("An automatically numbered one"),
        ...ABCD,
      ]),
      "exam-auto-2",
    );

    expect(result.questions.map((q) => q.number)).toEqual([7, 8]);
  });

  it("restarts numbering for each subject", async () => {
    const result = await parseQuestionPaper(
      await wordDocx([
        plain("[SUBJECT: Physics]"),
        numbered("Physics one"),
        ...ABCD,
        plain("[SUBJECT: Chemistry]"),
        numbered("Chemistry one"),
        ...ABCD,
      ]),
      "exam-auto-3",
    );

    expect(result.questions.map((q) => [q.subjectName, q.number])).toEqual([
      ["Physics", 1],
      ["Chemistry", 1],
    ]);
  });

  it("reads options that Word lettered automatically", async () => {
    const result = await parseQuestionPaper(
      await wordDocx([
        plain("[SUBJECT: Physics]"),
        numbered("Which of these is a vector quantity?"),
        numbered("Speed", 1),
        numbered("Mass", 1),
        numbered("Velocity", 1),
        numbered("Time", 1),
      ]),
      "exam-auto-4",
    );

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].options).toEqual({
      A: "Speed",
      B: "Mass",
      C: "Velocity",
      D: "Time",
    });
    expect(result.questions[0].issues).toEqual([]);
  });
});

describe("equations typed with Insert → Equation", () => {
  it("keeps fractions that would otherwise vanish", async () => {
    const result = await parseQuestionPaper(
      await wordDocx([
        plain("[SUBJECT: Physics]"),
        plain("1. A cable supporting W is cut in two. Either part supports"),
        fractionOption("A) ", "W", "4"),
        fractionOption("B) ", "W", "2"),
        plain("C) W"),
        plain("D) 2W"),
      ]),
      "exam-math-1",
    );

    expect(result.questions[0].options).toEqual({
      A: "W/4",
      B: "W/2",
      C: "W",
      D: "2W",
    });
    expect(result.questions[0].issues).toEqual([]);
    expect(
      result.warnings.some((w) => w.message.includes("converted to plain text")),
    ).toBe(true);
  });

  it("renders powers, indices and roots readably", async () => {
    const result = await parseQuestionPaper(
      await wordDocx([
        plain("[SUBJECT: Physics]"),
        plain("1. Evaluate"),
        new Paragraph({
          children: [
            new TextRun("A) "),
            new OfficeMath({
              children: [
                new MathSuperScript({
                  children: [new MathRun("x")],
                  superScript: [new MathRun("2")],
                }),
              ],
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun("B) "),
            new OfficeMath({
              children: [
                new MathSubScript({
                  children: [new MathRun("v")],
                  subScript: [new MathRun("0")],
                }),
              ],
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun("C) "),
            new OfficeMath({ children: [new MathRadical({ children: [new MathRun("2gh")] })] }),
          ],
        }),
        plain("D) none of these"),
      ]),
      "exam-math-2",
    );

    expect(result.questions[0].options.A).toBe("x²");
    expect(result.questions[0].options.B).toBe("v₀");
    expect(result.questions[0].options.C).toBe("√(2gh)");
  });

  it("reads a negative exponent however Word wrote the minus", async () => {
    // The en dash is what autocorrect leaves behind; U+2212 is what the
    // equation editor uses. Both used to surface as "10^(-2)" to the student.
    const power = (prefix: string, minus: string) =>
      new Paragraph({
        children: [
          new TextRun(prefix),
          new TextRun("9.6 × 10"),
          new TextRun({ text: `${minus}2`, superScript: true }),
          new TextRun(" m"),
        ],
      });

    const result = await parseQuestionPaper(
      await wordDocx([
        plain("[SUBJECT: Physics]"),
        plain("1. The increase in its length due to its own weight is"),
        power("A) ", "–"),
        power("B) ", "−"),
        power("C) ", "-"),
        new Paragraph({
          children: [
            new TextRun("D) "),
            new OfficeMath({
              children: [
                new MathSuperScript({
                  children: [new MathRun("10")],
                  superScript: [new MathRun("−7")],
                }),
              ],
            }),
            new TextRun(" m"),
          ],
        }),
      ]),
      "exam-math-4",
    );

    const [question] = result.questions;
    expect(question.options.A).toBe("9.6 × 10⁻² m");
    expect(question.options.B).toBe("9.6 × 10⁻² m");
    expect(question.options.C).toBe("9.6 × 10⁻² m");
    expect(question.options.D).toBe("10⁻⁷ m");
  });

  it("keeps an equation that sits in the question text", async () => {
    const result = await parseQuestionPaper(
      await wordDocx([
        plain("[SUBJECT: Mathematics]"),
        new Paragraph({
          children: [
            new TextRun("1. Differentiate "),
            new OfficeMath({
              children: [
                new MathFraction({
                  numerator: [new MathRun("x + 1")],
                  denominator: [new MathRun("2")],
                }),
              ],
            }),
            new TextRun(" with respect to x."),
          ],
        }),
        ...ABCD,
      ]),
      "exam-math-3",
    );

    expect(result.questions[0].text).toBe("Differentiate (x + 1)/2 with respect to x.");
  });
});
