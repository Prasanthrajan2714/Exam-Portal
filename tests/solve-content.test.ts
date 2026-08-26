import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prepareForSolving, type SolvableQuestion } from "@/lib/solutions";
import { ensureDir, resolveUploadPath } from "@/lib/uploads";

/**
 * What the solver is actually shown.
 *
 * A maths paper writes every option as an equation image. Sent only the words,
 * the model worked a question out correctly — "x² + y² = 4a²" — and then had to
 * guess which letter that was, recording option A when it was C, which the
 * publish gate then reported as a disagreement with a key that was right.
 *
 * So the images have to reach it, and be tied to the option they belong to.
 * These check the request that gets built, because the alternative is finding
 * out by paying for a run that comes back wrong.
 */

const EXAM = "solvecontent001";
const DIR = path.join("exams", EXAM, "images");

// A 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function writeImage(name: string, data: Buffer = PNG): Promise<string> {
  const absolute = resolveUploadPath(DIR);
  if (!absolute) throw new Error("bad upload path");
  await ensureDir(absolute);
  await fs.writeFile(path.join(absolute, name), data);
  return `${DIR.split(path.sep).join("/")}/${name}`;
}

afterAll(async () => {
  const dir = resolveUploadPath(path.join("exams", EXAM));
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

function question(over: Partial<SolvableQuestion> = {}): SolvableQuestion {
  return {
    index: 0,
    subjectName: "Mathematics",
    text: "What is 2 + 2?",
    optionA: "3",
    optionB: "4",
    optionC: "5",
    optionD: "6",
    images: [],
    ...over,
  };
}

const textOf = (blocks: Awaited<ReturnType<typeof prepareForSolving>>) =>
  blocks
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");

const imagesOf = (blocks: Awaited<ReturnType<typeof prepareForSolving>>) =>
  blocks.filter((b) => b.type === "image");

describe("prepareForSolving", () => {
  it("sends a question with no images as text alone", async () => {
    const blocks = await prepareForSolving(question());
    expect(imagesOf(blocks)).toHaveLength(0);
    expect(textOf(blocks)).toContain("What is 2 + 2?");
    expect(textOf(blocks)).toContain("A: 3");
  });

  it("attaches an option that is only a picture, and says which it is", async () => {
    // The exact shape that produced the wrong letter.
    const blocks = await prepareForSolving(
      question({
        optionA: "[[#0]]",
        optionB: "[[#1]]",
        optionC: "[[#2]]",
        optionD: "[[#3]]",
        images: [
          { target: "A", order: 0, path: await writeImage("a.png") },
          { target: "B", order: 1, path: await writeImage("b.png") },
          { target: "C", order: 2, path: await writeImage("c.png") },
          { target: "D", order: 3, path: await writeImage("d.png") },
        ],
      }),
    );

    expect(imagesOf(blocks)).toHaveLength(4);
    const text = textOf(blocks);
    // Each option names its own picture, so an answer can be tied to a letter.
    expect(text).toContain("A: [image 1]");
    expect(text).toContain("B: [image 2]");
    expect(text).toContain("C: [image 3]");
    expect(text).toContain("D: [image 4]");
  });

  it("sends the picture as base64 with a media type the API accepts", async () => {
    const blocks = await prepareForSolving(
      question({
        text: "Find [[#0]].",
        images: [{ target: "STEM", order: 0, path: await writeImage("stem.png") }],
      }),
    );

    const [image] = imagesOf(blocks);
    expect(image).toBeDefined();
    const source = (image as { source: { type: string; media_type: string; data: string } })
      .source;
    expect(source.type).toBe("base64");
    expect(source.media_type).toBe("image/png");
    expect(Buffer.from(source.data, "base64").subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
  });

  it("keeps an equation in the middle of the sentence where it belongs", async () => {
    const blocks = await prepareForSolving(
      question({
        text: "The common tangent to [[#0]] also passes through:",
        images: [{ target: "STEM", order: 0, path: await writeImage("mid.png") }],
      }),
    );
    expect(textOf(blocks)).toContain(
      "Question: The common tangent to [image 1] also passes through:",
    );
  });

  it("says so when a picture cannot be shown, rather than leaving a silent gap", async () => {
    // A .wmf that never rasterised. Deleting the reference would hand over a
    // sentence that reads as complete, which is what invites a guess.
    const blocks = await prepareForSolving(
      question({
        text: "Given [[#0]], find x.",
        images: [{ target: "STEM", order: 0, path: `${DIR}/eq.wmf` }],
      }),
    );
    expect(imagesOf(blocks)).toHaveLength(0);
    const text = textOf(blocks);
    expect(text).toContain("could not be shown");
    expect(text).toContain("set confident to false");
  });

  it("survives an image whose file has gone", async () => {
    const blocks = await prepareForSolving(
      question({
        text: "Read [[#0]].",
        images: [{ target: "STEM", order: 0, path: `${DIR}/absent.png` }],
      }),
    );
    expect(imagesOf(blocks)).toHaveLength(0);
    expect(textOf(blocks)).toContain("could not be shown");
  });

  it("attaches an image a paper stored before markers existed", async () => {
    // No [[#n]] in the text; the image still has to reach the model.
    const blocks = await prepareForSolving(
      question({
        text: "Identify the circuit shown below.",
        images: [{ target: "STEM", order: 0, path: await writeImage("old.png") }],
      }),
    );
    expect(imagesOf(blocks)).toHaveLength(1);
    expect(textOf(blocks)).toContain("[image 1]");
  });

  it("refuses to leave the upload directory", async () => {
    const blocks = await prepareForSolving(
      question({
        text: "Read [[#0]].",
        images: [{ target: "STEM", order: 0, path: "../../../.env" }],
      }),
    );
    expect(imagesOf(blocks)).toHaveLength(0);
  });
});
