import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

/**
 * Saving a paper failed with `Unknown argument \`width\`` because the running
 * server still held a Prisma client generated before QuestionImage gained its
 * size columns. The columns and the client now agree; this pins that, so the
 * same drift shows up here rather than as a crash while publishing.
 */

const TAG = "__imgsize__";
const created: string[] = [];

afterAll(async () => {
  if (created.length) {
    await prisma.exam.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.batch.deleteMany({ where: { name: TAG } });
});

describe("writing a question with a sized image", () => {
  it("stores the size the document laid it out at", async () => {
    const subject = await prisma.subject.findFirst({ orderBy: { order: "asc" } });
    expect(subject, "the seed provides subjects").not.toBeNull();

    const batch = await prisma.batch.create({ data: { name: TAG } });
    const now = new Date();
    const exam = await prisma.exam.create({
      data: {
        name: `${TAG} exam`,
        batchId: batch.id,
        examDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
        startsAt: now,
        endsAt: new Date(now.getTime() + 60 * 60_000),
        durationMinutes: 30,
        examSubjects: { create: [{ subjectId: subject!.id, questionCount: 1, order: 0 }] },
      },
    });
    created.push(exam.id);

    // Exactly the shape publishPaper builds, including the size that broke it.
    const question = await prisma.question.create({
      data: {
        exam: { connect: { id: exam.id } },
        subject: { connect: { id: subject!.id } },
        number: 1,
        text: "இல் உள்ள C இன் ஆக்சிஜனேற்ற எண்கள் முறையே",
        optionA: "+4, 0,-4",
        optionB: "-4, 0 +4",
        optionC: "-2,0,+2",
        optionD: "+2,0,-2",
        sourceText: "The oxidation numbers of C in are respectively",
        correctOption: "C",
        images: {
          create: [
            { path: `exams/${exam.id}/images/equation.png`, target: "STEM", width: 152, height: 24, order: 0 },
          ],
        },
      },
      include: { images: true },
    });

    expect(question.images).toHaveLength(1);
    // Text height, not the raster's 1400px.
    expect(question.images[0].width).toBe(152);
    expect(question.images[0].height).toBe(24);

    // An image with no recorded size stays null so the renderer falls back
    // rather than laying out at zero.
    const plain = await prisma.questionImage.create({
      data: { questionId: question.id, path: `exams/${exam.id}/images/photo.png`, target: "A", order: 1 },
    });
    expect(plain.width).toBeNull();
    expect(plain.height).toBeNull();
  });
});
