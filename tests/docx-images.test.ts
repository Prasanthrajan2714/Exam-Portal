import fs from "node:fs/promises";
import path from "node:path";
import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { afterAll, describe, expect, it } from "vitest";
import { layoutQuestion, questionPlainText } from "@/lib/question-layout";
import { parseQuestionPaper } from "@/lib/docx-parser";
import { resolveUploadPath, uploadRoot } from "@/lib/uploads";

/**
 * Physics and Chemistry papers routinely carry diagrams, so a paper whose
 * figures were dropped would be unusable. These build a .docx with genuinely
 * embedded images and check they come out attached to the right question.
 */

// A 1x1 PNG — the smallest thing Word will accept as an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const EXAM_ID = "imgtest001";

function imageParagraph(prefix: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: prefix }),
      new ImageRun({
        data: PNG,
        transformation: { width: 40, height: 40 },
        type: "png",
      }),
    ],
  });
}

async function docxWithImages(): Promise<File> {
  const children: Paragraph[] = [
    new Paragraph({ text: "[SUBJECT: Physics]" }),
    imageParagraph("1. Identify the circuit shown below. "),
    new Paragraph({ text: "A) Series" }),
    new Paragraph({ text: "B) Parallel" }),
    new Paragraph({ text: "C) Mixed" }),
    new Paragraph({ text: "D) Open" }),
    new Paragraph({ text: "2. Which graph matches the motion?" }),
    imageParagraph("A) "),
    new Paragraph({ text: "B) plain option" }),
    new Paragraph({ text: "C) another option" }),
    new Paragraph({ text: "D) last option" }),
  ];

  const document = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(document);
  return new File([new Uint8Array(buffer)], "paper-with-images.docx");
}

afterAll(async () => {
  const dir = resolveUploadPath(path.join("exams", EXAM_ID));
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe("images embedded in a question paper", () => {
  it("extracts them, writes them to disk and attributes them correctly", async () => {
    const result = await parseQuestionPaper(await docxWithImages(), EXAM_ID);

    expect(result.questions).toHaveLength(2);

    // Q1's figure belongs to the question stem.
    const [first, second] = result.questions;
    const stemImages = first.images.filter((i) => i.target === "STEM");
    expect(stemImages).toHaveLength(1);
    // The text keeps a marker where the document had the image, so it can be
    // put back in the same place. Here that is the end of the sentence; in a
    // maths paper the equation sits mid-sentence and the position is the whole
    // point. The number is the image's index in this question's own list.
    expect(first.text).toBe("Identify the circuit shown below. [[#0]]");
    expect(questionPlainText(first.text)).toBe("Identify the circuit shown below.");
    expect(layoutQuestion(first.text, [0])).toEqual([
      { kind: "text", value: "Identify the circuit shown below. " },
      { kind: "image", order: 0 },
    ]);

    // Q2's figure sits inside option A, not the stem.
    const optionImages = second.images.filter((i) => i.target === "A");
    expect(optionImages).toHaveLength(1);
    expect(second.images.filter((i) => i.target === "STEM")).toHaveLength(0);

    // Neither question should be flagged: an option carrying only a diagram is
    // legitimate, so "empty option A" must not be reported for Q2.
    expect(first.issues).toEqual([]);
    expect(second.issues).toEqual([]);

    // The file really exists where the database will point at it.
    const stored = resolveUploadPath(stemImages[0].path);
    expect(stored).not.toBeNull();
    expect(stored!.startsWith(uploadRoot())).toBe(true);
    const bytes = await fs.readFile(stored!);
    expect(bytes.length).toBeGreaterThan(0);

    // Paths are URL-shaped, since they are served through /api/uploads.
    expect(stemImages[0].path).toMatch(/^exams\/imgtest001\/images\/[a-f0-9]+\.png$/);
  });

  it("stores one copy of an image repeated across questions", async () => {
    // Content-addressed by hash: a logo on every page must not become 60 files.
    const result = await parseQuestionPaper(await docxWithImages(), EXAM_ID);
    const paths = result.questions.flatMap((q) => q.images.map((i) => i.path));
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(1);
  });
});

describe("upload path safety", () => {
  it("refuses paths that escape the upload directory", () => {
    // These arrive from the database and from URLs, so traversal has to be
    // impossible rather than merely unlikely.
    expect(resolveUploadPath("../../../.env")).toBeNull();
    expect(resolveUploadPath("../secrets.txt")).toBeNull();
    expect(resolveUploadPath("exams/abc/images/ok.png")).not.toBeNull();
  });
});
