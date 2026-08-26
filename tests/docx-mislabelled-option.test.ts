import { Document, Packer, Paragraph } from "docx";
import { describe, expect, it } from "vitest";
import { parseQuestionPaper } from "@/lib/docx-parser";

/**
 * A real paper labelled its four options "A) B) C) B)".
 *
 * Taking the label at its word overwrote option B and left D empty, which the
 * preview reported as "Option D is empty" — true, and no help at all in finding
 * the typo three lines above it.
 */

async function paper(options: string[]): Promise<File> {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "[SUBJECT: Mathematics]" }),
          new Paragraph({ text: "1. Which is correct?" }),
          ...options.map((o) => new Paragraph({ text: o })),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);
  return new File([new Uint8Array(buffer)], "paper.docx");
}

describe("a paper that labels two options the same", () => {
  it("puts the repeat in the free slot rather than overwriting", async () => {
    const result = await parseQuestionPaper(
      await paper(["A) one", "B) two", "C) three", "B) four"]),
      "mislabel001",
    );

    const [q] = result.questions;
    expect(q.options).toEqual({ A: "one", B: "two", C: "three", D: "four" });
    // The question is complete, so it must not be flagged unpublishable.
    expect(q.issues).toEqual([]);
  });

  it("says the label was wrong instead of leaving it to be guessed", async () => {
    const result = await parseQuestionPaper(
      await paper(["A) one", "B) two", "C) three", "B) four"]),
      "mislabel002",
    );

    const warning = result.warnings.find((w) => w.message.includes("two options"));
    expect(warning, "the mislabelling must be reported").toBeDefined();
    expect(warning!.message).toContain("B)");
    expect(warning!.message).toContain("option D");
  });

  it("leaves a correctly labelled paper alone", async () => {
    const result = await parseQuestionPaper(
      await paper(["A) one", "B) two", "C) three", "D) four"]),
      "mislabel003",
    );

    expect(result.questions[0].options).toEqual({
      A: "one",
      B: "two",
      C: "three",
      D: "four",
    });
    expect(result.warnings.filter((w) => w.message.includes("two options"))).toEqual([]);
  });

  it("reports a fifth option rather than dropping it in silence", async () => {
    const result = await parseQuestionPaper(
      await paper(["A) one", "B) two", "C) three", "D) four", "A) five"]),
      "mislabel004",
    );

    expect(result.questions[0].options).toEqual({
      A: "one",
      B: "two",
      C: "three",
      D: "four",
    });
    expect(
      result.warnings.some((w) => w.message.includes("more than four options")),
    ).toBe(true);
  });
});
