import { describe, expect, it } from "vitest";
import { layoutQuestion, questionPlainText } from "@/lib/question-layout";

/**
 * An equation image that sits inside a sentence has to stay inside it.
 *
 * The case: a maths paper writes "The common tangent to the circles [x²+y²=4
 * and x²+y²+6x+8y−24=0] also passes through the point:", with the relation
 * itself as an equation image. Stripping the image out left the question
 * reading "the common tangent to the circles also passes through the point:" —
 * unanswerable, and the equation stranded below it.
 *
 * Exercises the real module the screens use; a copy of the logic here would
 * pass happily while they drifted.
 */

const text = (value: string) => ({ kind: "text", value });
const image = (order: number) => ({ kind: "image", order });

describe("layoutQuestion", () => {
  it("puts the equation back in the middle of the sentence", () => {
    expect(
      layoutQuestion("The common tangent to the circles [[#0]] also passes through:", [0]),
    ).toEqual([
      text("The common tangent to the circles "),
      image(0),
      text(" also passes through:"),
    ]);
  });

  it("handles several images in one sentence, in order", () => {
    expect(layoutQuestion("If [[#0]] and [[#1]] then find x.", [0, 1])).toEqual([
      text("If "),
      image(0),
      text(" and "),
      image(1),
      text(" then find x."),
    ]);
  });

  it("puts an unmarked image after the text, as papers stored before this do", () => {
    // Every question uploaded before markers existed has none, and must keep
    // rendering exactly as it did.
    expect(layoutQuestion("Look at the figure and answer:", [0])).toEqual([
      text("Look at the figure and answer:"),
      image(0),
    ]);
  });

  it("keeps an image the text no longer refers to", () => {
    // An admin editing the question can delete a marker. Losing the diagram
    // silently would be worse than showing it at the end.
    expect(layoutQuestion("Rewritten, with no marker.", [0, 1])).toEqual([
      text("Rewritten, with no marker."),
      image(0),
      image(1),
    ]);
  });

  it("drops a marker with no image behind it", () => {
    // A stale marker must never reach a student as literal "[[#3]]".
    expect(layoutQuestion("Before [[#3]] after", [])).toEqual([
      text("Before "),
      text(" after"),
    ]);
  });

  it("leaves text with no markers untouched", () => {
    expect(layoutQuestion("Plain question with no images.", [])).toEqual([
      text("Plain question with no images."),
    ]);
  });

  it("handles a question that is only an image", () => {
    expect(layoutQuestion("[[#0]]", [0])).toEqual([image(0)]);
  });

  it("handles empty text with images", () => {
    expect(layoutQuestion("", [0])).toEqual([image(0)]);
  });
});

describe("questionPlainText", () => {
  it("reads as a sentence with the markers taken out", () => {
    // Used where an image cannot be shown at all — an export, or the prompt a
    // solver reads. A literal marker there is noise at best.
    expect(
      questionPlainText("The common tangent to the circles [[#0]] also passes:"),
    ).toBe("The common tangent to the circles also passes:");
  });

  it("leaves unmarked text alone", () => {
    expect(questionPlainText("Nothing to strip here.")).toBe("Nothing to strip here.");
  });
});
