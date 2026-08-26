import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildPaperDocument, paperFileName, type PaperQuestion } from "@/lib/paper-document";

/**
 * The downloadable paper.
 *
 * Everything that can go wrong here is in the data rather than the code — an
 * image cleared off disk, a metafile Word will not accept, a question that is
 * only a diagram — and none of it may cost the whole download. So these feed it
 * the awkward cases and check a real .docx still comes out.
 */

const exam = { name: "JEE Mock 3", batch: { name: "IIT Batch" } };

function question(over: Partial<PaperQuestion> = {}): PaperQuestion {
  return {
    number: 1,
    text: "What is 2 + 2?",
    optionA: "3",
    optionB: "4",
    optionC: "5",
    optionD: "6",
    correctOption: "B",
    solution: "Two and two make four.",
    subject: { name: "Mathematics" },
    images: [],
    ...over,
  };
}

/** A .docx is a zip; this is the cheapest proof it is a real one. */
async function documentText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = zip.file("word/document.xml");
  expect(xml, "a .docx must contain word/document.xml").not.toBeNull();
  return xml!.async("string");
}

describe("buildPaperDocument", () => {
  it("writes the questions without giving the answers away", async () => {
    const text = await documentText(
      await buildPaperDocument(exam, [question()], false),
    );
    expect(text).toContain("What is 2 + 2?");
    expect(text).toContain("questions only");
    // The whole point of the questions-only copy.
    expect(text).not.toContain("Two and two make four.");
    expect(text).not.toContain("Answer: B");
  });

  it("writes the working and the answer when asked for", async () => {
    const text = await documentText(
      await buildPaperDocument(exam, [question()], true),
    );
    expect(text).toContain("Two and two make four.");
    expect(text).toContain("Answer: B");
    expect(text).toContain("with worked solutions");
  });

  it("says so rather than inventing a solution that was never written", async () => {
    const text = await documentText(
      await buildPaperDocument(exam, [question({ solution: null })], true),
    );
    expect(text).toContain("No worked solution recorded");
  });

  it("survives an image whose file is gone", async () => {
    // Replacing a paper clears its directory; a row can outlive its file.
    const buffer = await buildPaperDocument(
      exam,
      [
        question({
          text: "Read the graph [[#0]] and answer.",
          images: [
            {
              order: 0,
              target: "STEM",
              path: "exams/nope/images/missing.png",
              width: 100,
              height: 80,
            },
          ],
        }),
      ],
      false,
    );
    const text = await documentText(buffer);
    // The words survive; only the picture is lost.
    expect(text).toContain("Read the graph");
    expect(text).toContain("and answer.");
  });

  it("skips a format Word will not take rather than throwing", async () => {
    // A .wmf that never rasterised would fail while packing, losing the paper.
    const text = await documentText(
      await buildPaperDocument(
        exam,
        [
          question({
            text: "Given [[#0]], find x.",
            images: [
              {
                order: 0,
                target: "STEM",
                path: "exams/abc/images/equation.wmf",
                width: 100,
                height: 20,
              },
            ],
          }),
        ],
        false,
      ),
    );
    expect(text).toContain("Given");
    expect(text).toContain("find x.");
  });

  it("leaves a mark where a question is nothing but a lost diagram", async () => {
    // Otherwise it merges silently into the question above it.
    const text = await documentText(
      await buildPaperDocument(
        exam,
        [
          question({
            text: "[[#0]]",
            images: [
              {
                order: 0,
                target: "STEM",
                path: "exams/nope/images/missing.png",
                width: 100,
                height: 80,
              },
            ],
          }),
        ],
        false,
      ),
    );
    expect(text).toContain("—");
  });

  it("groups the questions under their subject", async () => {
    const text = await documentText(
      await buildPaperDocument(
        exam,
        [
          question({ number: 1 }),
          question({ number: 2, subject: { name: "Physics" } }),
        ],
        false,
      ),
    );
    expect(text).toContain("Mathematics");
    expect(text).toContain("Physics");
  });

  it("copes with a paper that has no questions at all", async () => {
    const text = await documentText(await buildPaperDocument(exam, [], false));
    expect(text).toContain("JEE Mock 3");
  });
});

describe("paperFileName", () => {
  it("says which copy it is", () => {
    expect(paperFileName("JEE Mock 3", true)).toBe("JEE Mock 3 - with-solutions.docx");
    expect(paperFileName("JEE Mock 3", false)).toBe("JEE Mock 3 - questions-only.docx");
  });

  it("strips what a filename cannot carry", () => {
    // The name goes into a Content-Disposition header, where a quote or a
    // newline is not merely untidy.
    expect(paperFileName('Term "1" / Unit 2', false)).toBe(
      "Term 1  Unit 2 - questions-only.docx",
    );
    expect(paperFileName("Mock\nTest", true)).toBe("MockTest - with-solutions.docx");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(paperFileName("???", true)).toBe("paper - with-solutions.docx");
  });
});
