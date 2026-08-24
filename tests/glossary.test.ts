import { describe, expect, it } from "vitest";
import { glossaryFileFor, loadGlossary, matchTerms, termsForQuestion } from "@/lib/glossary";

/**
 * Runs against the real glossary files — the point is that the matcher works on
 * the board's actual terminology, not on a fixture that flatters it.
 */

describe("glossaryFileFor", () => {
  it("maps each subject to its file", () => {
    expect(glossaryFileFor("Mathematics")).toBe("Tamil-MATH.md");
    expect(glossaryFileFor("Physics")).toBe("Tamil-PHY.md");
    expect(glossaryFileFor("Chemistry")).toBe("Tamil-CHE.md");
    expect(glossaryFileFor("Biology")).toBe("Tamil-BIO.md");
  });

  it("is case and whitespace insensitive", () => {
    expect(glossaryFileFor("  physics ")).toBe("Tamil-PHY.md");
  });

  it("returns null for a subject with no glossary", () => {
    expect(glossaryFileFor("Computer Science")).toBeNull();
  });
});

describe("loadGlossary", () => {
  it("parses the real files and skips their header rows", async () => {
    const maths = await loadGlossary("Mathematics");
    expect(maths.length).toBeGreaterThan(1000);
    for (const entry of maths.slice(0, 50)) {
      expect(entry.term).not.toMatch(/^-+$/);
      expect(entry.term.toLowerCase()).not.toBe("english term (sense)");
      expect(entry.tamil.length).toBeGreaterThan(0);
    }
  });

  it("carries the board's Tamil across", async () => {
    const maths = await loadGlossary("Mathematics");
    const acute = maths.find((e) => e.term === "acute angle");
    expect(acute?.tamil).toBe("குறுங்கோணம்");
  });

  it("returns nothing for a subject with no glossary", async () => {
    expect(await loadGlossary("Computer Science")).toEqual([]);
  });
});

describe("matchTerms", () => {
  it("finds a term that is present", async () => {
    const maths = await loadGlossary("Mathematics");
    const hits = matchTerms("Find the acute angle between the lines.", maths);
    expect(hits.map((h) => h.term)).toContain("acute angle");
  });

  it("matches one side of an \"X or Y\" entry, as a paper would write it", async () => {
    const maths = await loadGlossary("Mathematics");
    const hits = matchTerms("State the absolute value function.", maths).map((h) => h.term);
    expect(hits).toContain("absolute value function or modulus function");
    // Contained inside the longer match, so it must not be offered as well.
    expect(hits).not.toContain("absolute value");
  });

  it("keeps two terms that merely overlap", async () => {
    const maths = await loadGlossary("Mathematics");
    const hits = matchTerms("Find the acute angle between the lines.", maths).map((h) => h.term);
    // They share the word "angle" but are different terms; the model needs both.
    expect(hits).toContain("acute angle");
    expect(hits).toContain("angle between the lines");
    // "angle" alone sits inside both, so it is redundant.
    expect(hits).not.toContain("angle");
  });

  it("respects word boundaries", async () => {
    const maths = await loadGlossary("Mathematics");
    // "arc" must not fire inside "search" or "March".
    const hits = matchTerms("The research in March was thorough.", maths);
    expect(hits.map((h) => h.term)).not.toContain("arc");
  });

  it("returns nothing for text with no technical terms", async () => {
    const maths = await loadGlossary("Mathematics");
    expect(matchTerms("Which of the following is correct?", maths).length).toBe(0);
  });

  it("handles empty input", async () => {
    const maths = await loadGlossary("Mathematics");
    expect(matchTerms("   ", maths)).toEqual([]);
  });
});

describe("termsForQuestion", () => {
  it("gathers terms across the stem and every option, without duplicates", async () => {
    const terms = await termsForQuestion("Physics", [
      "What is the acceleration of the body?",
      "acceleration due to gravity",
      "acceleration",
      "velocity",
      "momentum",
    ]);
    const names = terms.map((t) => t.term);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("acceleration");
    expect(names.some((n) => n.includes("velocity") || n === "momentum")).toBe(true);
  });

  it("is empty for a subject with no glossary", async () => {
    expect(await termsForQuestion("Computer Science", ["binary tree"])).toEqual([]);
  });
});
