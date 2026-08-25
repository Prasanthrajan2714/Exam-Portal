import { describe, expect, it } from "vitest";
import {
  disagreesWithKey,
  publishBlockMessage,
  solutionState,
  solutionsBlockingPublish,
} from "@/lib/solutions";

/**
 * A paper may only be published once it carries worked solutions and those
 * solutions agree with the uploaded answer key.
 *
 * The disagreement case is the one that matters: a wrong key marks correct
 * students wrong and nothing downstream would ever notice. Because the solution
 * is worked out without being shown the key, the two agreeing is real evidence.
 */

const q = (
  number: number,
  correctOption: "A" | "B" | "C" | "D",
  solution: string | null,
  solvedOption: "A" | "B" | "C" | "D" | null,
) => ({ number, correctOption, solution, solvedOption });

describe("solutionsBlockingPublish", () => {
  it("lets a fully solved, agreeing paper through", () => {
    expect(
      solutionsBlockingPublish([
        q(1, "A", "Because one.", "A"),
        q(2, "C", "Because two.", "C"),
      ]),
    ).toBeNull();
  });

  it("blocks a paper with no solutions at all", () => {
    const block = solutionsBlockingPublish([q(1, "A", null, null), q(2, "B", null, null)]);
    expect(block).toEqual({ kind: "UNSOLVED", count: 2 });
  });

  it("counts a blank solution as unsolved", () => {
    // An admin can clear the box after it was drafted; that is not a solution.
    const block = solutionsBlockingPublish([q(1, "A", "   ", "A"), q(2, "B", "Fine.", "B")]);
    expect(block).toEqual({ kind: "UNSOLVED", count: 1 });
  });

  it("counts a solution with no answer as unsolved", () => {
    const block = solutionsBlockingPublish([q(1, "A", "Some words.", null)]);
    expect(block).toEqual({ kind: "UNSOLVED", count: 1 });
  });

  it("names every question where the key and the solution disagree", () => {
    const block = solutionsBlockingPublish([
      q(1, "A", "Working.", "A"),
      q(2, "B", "Working.", "C"),
      q(3, "D", "Working.", "A"),
    ]);
    expect(block).toEqual({ kind: "DISAGREE", numbers: [2, 3] });
  });

  it("reports missing solutions before disagreements", () => {
    // Chasing a disagreement is pointless while half the paper is unsolved.
    const block = solutionsBlockingPublish([
      q(1, "A", null, null),
      q(2, "B", "Working.", "C"),
    ]);
    expect(block?.kind).toBe("UNSOLVED");
  });

  it("treats an empty paper as nothing to block", () => {
    // The "upload a paper first" rule owns that case, and owns it earlier.
    expect(solutionsBlockingPublish([])).toBeNull();
  });
});

describe("publishBlockMessage", () => {
  it("says how many are unsolved", () => {
    expect(publishBlockMessage({ kind: "UNSOLVED", count: 3 })).toMatch(/3 question/);
  });

  it("names the disagreeing questions and why it matters", () => {
    const message = publishBlockMessage({ kind: "DISAGREE", numbers: [2, 7] });
    expect(message).toContain("2, 7");
    expect(message).toMatch(/marks correct answers wrong/);
  });
});

describe("disagreesWithKey", () => {
  it("is true only when a solved answer differs from the key", () => {
    expect(disagreesWithKey({ solvedOption: "D", correctOption: "A" })).toBe(true);
    expect(disagreesWithKey({ solvedOption: "A", correctOption: "A" })).toBe(false);
  });

  it("is false for a question not solved yet", () => {
    // Unsolved is a separate block with a separate message; treating it as a
    // disagreement would put a question with no working into the settle screen,
    // where there is nothing to settle against.
    expect(disagreesWithKey({ solvedOption: null, correctOption: "A" })).toBe(false);
  });
});

describe("solutionState", () => {
  it("is SOLVED only with both a working and the answer it reaches", () => {
    expect(solutionState({ solution: "Because x = 2.", solvedOption: "B" })).toBe(
      "SOLVED",
    );
  });

  it("is UNANSWERABLE when the model wrote something but would not commit", () => {
    // What a question whose equation lives in an image produces. Storing the
    // guess as an answer would count it as an independent second opinion it is
    // not, and would show "the equation is not available" to the batch as their
    // worked solution.
    expect(
      solutionState({
        solution: "The equation is given only in the image, which is not available.",
        solvedOption: null,
      }),
    ).toBe("UNANSWERABLE");
  });

  it("is NONE when nothing has been written", () => {
    expect(solutionState({ solution: null, solvedOption: null })).toBe("NONE");
    expect(solutionState({ solution: "   ", solvedOption: null })).toBe("NONE");
  });

  it("treats a blanked working as unsolved even with an answer beside it", () => {
    // An admin who empties the box has withdrawn the solution; publishing must
    // not sail past on the leftover option.
    expect(solutionState({ solution: "", solvedOption: "B" })).toBe("NONE");
  });
});
