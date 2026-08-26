import "server-only";
import fs from "node:fs/promises";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { layoutQuestion } from "./question-layout";
import { resolveUploadPath } from "./uploads";

/**
 * A finished paper as a Word document, with or without its worked solutions.
 *
 * Kept out of the route so it can be run against a real paper in a test: the
 * failure modes here are all in the data — an image file that has been cleared
 * off disk, a metafile no Word build will accept, a question that is nothing but
 * a diagram — and none of them should cost the whole download.
 */

export type PaperExam = {
  name: string;
  batch: { name: string };
};

export type PaperQuestion = {
  number: number;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: "A" | "B" | "C" | "D";
  solution: string | null;
  subject: { name: string };
  images: {
    order: number;
    target: string;
    path: string;
    width: number | null;
    height: number | null;
  }[];
};

const OPTIONS = ["A", "B", "C", "D"] as const;

/**
 * One question's text with its images where the document had them.
 *
 * A picture cannot sit inside a run of text in a .docx the way it does in HTML,
 * so an image becomes its own paragraph and the text breaks around it. The
 * reading order survives, which is what matters on paper.
 */
async function questionParagraphs(
  text: string,
  images: PaperQuestion["images"],
): Promise<Paragraph[]> {
  const byOrder = new Map(images.map((i) => [i.order, i]));
  const parts = layoutQuestion(
    text,
    images.map((i) => i.order),
  );

  const out: Paragraph[] = [];
  let pending = "";

  const flush = () => {
    if (pending.trim()) {
      out.push(new Paragraph({ children: [new TextRun({ text: pending.trim() })] }));
    }
    pending = "";
  };

  for (const part of parts) {
    if (part.kind === "text") {
      pending += part.value;
      continue;
    }

    const image = byOrder.get(part.order);
    if (!image) continue;

    const absolute = resolveUploadPath(image.path);
    // Word takes these; a stray .wmf that never rasterised does not, and would
    // throw while packing rather than merely look wrong.
    if (!absolute || !/\.(png|jpe?g|gif|bmp)$/i.test(absolute)) continue;

    let data: Buffer;
    try {
      data = await fs.readFile(absolute);
    } catch {
      // A file cleared off disk must not cost the whole download.
      continue;
    }

    flush();
    out.push(
      new Paragraph({
        children: [
          new ImageRun({
            data,
            transformation: {
              width: image.width && image.width > 0 ? image.width : 240,
              height: image.height && image.height > 0 ? image.height : 80,
            },
            type: /\.png$/i.test(absolute) ? "png" : "jpg",
          }),
        ],
      }),
    );
  }

  flush();
  // A question reduced to nothing at all would silently merge into the one
  // above it, so leave a mark that something was there.
  return out.length > 0 ? out : [new Paragraph({ children: [new TextRun({ text: "—" })] })];
}

export async function buildPaperDocument(
  exam: PaperExam,
  questions: PaperQuestion[],
  withSolutions: boolean,
): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: exam.name,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `${exam.batch.name} · ${
            withSolutions ? "with worked solutions" : "questions only"
          }`,
          italics: true,
        }),
      ],
    }),
    new Paragraph({ text: "" }),
  ];

  let subject = "";
  for (const q of questions) {
    if (q.subject.name !== subject) {
      subject = q.subject.name;
      children.push(new Paragraph({ text: subject, heading: HeadingLevel.HEADING_2 }));
    }

    children.push(
      new Paragraph({ children: [new TextRun({ text: `${q.number}.`, bold: true })] }),
    );
    children.push(
      ...(await questionParagraphs(
        q.text,
        q.images.filter((i) => i.target === "STEM"),
      )),
    );

    for (const key of OPTIONS) {
      const text = { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD }[key];
      const mark = withSolutions && key === q.correctOption ? " ✓" : "";
      children.push(
        ...(await questionParagraphs(
          `${key}) ${text}${mark}`,
          q.images.filter((i) => i.target === key),
        )),
      );
    }

    if (withSolutions) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Answer: ${q.correctOption}`, bold: true })],
        }),
      );
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: q.solution?.trim() || "No worked solution recorded." }),
          ],
        }),
      );
    }

    children.push(new Paragraph({ text: "" }));
  }

  const document = new Document({ sections: [{ children }] });
  return Packer.toBuffer(document);
}

/** "JEE Mock 3 — with-solutions.docx" */
export function paperFileName(examName: string, withSolutions: boolean): string {
  const safe = examName.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "paper";
  return `${safe} - ${withSolutions ? "with-solutions" : "questions-only"}.docx`;
}
