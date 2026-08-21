import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Generates the question-paper template.
 *
 * When an exam id is supplied the template is pre-filled with that exam's own
 * subjects and question counts — the commonest upload failure is a paper whose
 * shape doesn't match what the exam expects, and handing the admin a skeleton
 * with the right headings and numbering removes most of it.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const examId = new URL(request.url).searchParams.get("examId");

  let examName = "";
  let structure: { subject: string; count: number }[] = [];

  if (examId) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        examSubjects: {
          include: { subject: true },
          orderBy: { order: "asc" },
        },
      },
    });
    if (exam) {
      examName = exam.name;
      structure = exam.examSubjects.map((es) => ({
        subject: es.subject.name,
        count: es.questionCount,
      }));
    }
  }

  if (structure.length === 0) {
    structure = [{ subject: "Mathematics", count: 2 }];
  }

  const children: Paragraph[] = [
    new Paragraph({
      text: examName || "Question Paper",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "FirstBench question paper template",
          italics: true,
          color: "666666",
        }),
      ],
    }),
    new Paragraph({ text: "" }),
    instruction("How to fill this in — delete this block before uploading"),
    bullet("Keep every [SUBJECT: …] heading exactly as it is."),
    bullet("Number questions from 1 within each subject, e.g. 1. 2. 3."),
    bullet("Give exactly four options, labelled A) B) C) D), one per line."),
    bullet("Pictures and diagrams may be pasted straight in — they are picked up automatically."),
    bullet("Put the correct answers in the separate .xlsx answer key, not here."),
    new Paragraph({ text: "" }),
  ];

  for (const { subject, count } of structure) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `[SUBJECT: ${subject}]`, bold: true, size: 28 }),
        ],
        spacing: { before: 300, after: 160 },
      }),
    );

    // Two worked examples, then bare numbered stubs — enough to show the shape
    // without making the admin delete 45 filled-in placeholders.
    const examples = Math.min(count, 2);
    for (let n = 1; n <= examples; n++) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${n}. `, bold: true }),
            new TextRun({ text: `Type the ${subject.toLowerCase()} question here.` }),
          ],
          spacing: { before: 160 },
        }),
      );
      for (const letter of ["A", "B", "C", "D"]) {
        children.push(
          new Paragraph({ text: `${letter}) Option ${letter}`, spacing: { after: 20 } }),
        );
      }
    }

    for (let n = examples + 1; n <= count; n++) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${n}. `, bold: true })],
          spacing: { before: 160 },
        }),
      );
      for (const letter of ["A", "B", "C", "D"]) {
        children.push(new Paragraph({ text: `${letter}) `, spacing: { after: 20 } }));
      }
    }
  }

  const document = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(document);

  const safeName = (examName || "question-paper")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}-template.docx"`,
      "Cache-Control": "no-store",
    },
  });
}

function instruction(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: "B45309" })],
    spacing: { after: 80 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, color: "666666" })],
    bullet: { level: 0 },
  });
}
