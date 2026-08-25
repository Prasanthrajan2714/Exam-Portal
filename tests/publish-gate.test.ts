import { describe, expect, it } from "vitest";
import {
  disagreesWithKey,
  publishBlockMessage,
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
