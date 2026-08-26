import { describe, expect, it } from "vitest";
import { cleanText } from "@/lib/docx-parser";

/**
 * Word puts an equation image into a run mammoth reports as a subscript, so a
 * maths paper arrives as `<sub><img></sub>` on almost every line.
 *
 * That was invisible while images were being deleted — `<sub> </sub>` maps to
 * nothing. The moment an image left a marker behind, the marker went through the
 * subscript mapping instead and came out as `_([[slot:0]])`: the marker
 * corrupted, and the equation described as a subscript of nothing.
 */

describe("cleanText", () => {
  it("leaves an image marker outside the subscript mapping", () => {
    expect(cleanText("A) <sub>[[slot:0]]</sub>")).toBe("A) [[slot:0]]");
  });

  it("does the same for a superscript", () => {
    expect(cleanText("<sup>[[slot:2]]</sup>")).toBe("[[slot:2]]");
  });

  it("keeps real script text around the marker", () => {
    // If a run genuinely holds both, neither may be lost.
    expect(cleanText("x<sub>1[[slot:0]]</sub>")).toBe("x₁[[slot:0]]");
  });

  it("still maps a real subscript to its own character", () => {
    expect(cleanText("H<sub>2</sub>O")).toBe("H₂O");
    expect(cleanText("x<sup>2</sup>")).toBe("x²");
  });

  it("still falls back for script text with no character of its own", () => {
    // The fallback is what makes an unmappable subscript readable at all.
    expect(cleanText("K<sub>eq</sub>")).toBe("K_(eq)");
  });

  it("strips tags and collapses whitespace", () => {
    expect(cleanText("<strong>Find</strong>   <em>x</em>")).toBe("Find x");
  });
});
