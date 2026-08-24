import { describe, expect, it } from "vitest";
import { nothingToTranslate, stillEnglish } from "@/lib/translation-review";

/**
 * The two checks the Tamil review screen uses to tell a correct passthrough
 * apart from a real miss. An admin looking at "9.6 × 10⁻² m" on both sides
 * reasonably reads it as "not translated"; it is in fact the right answer, and
 * the screen has to say which case it is looking at.
 *
 * Exercises the real module the review screen uses — a copy of the logic here
 * would pass happily while the screen drifted.
 */

describe("nothingToTranslate", () => {
  it("is true for a numeric answer with units", () => {
    // Exactly the options from the admin's screenshot.
    expect(nothingToTranslate("9.6 × 10⁻² m")).toBe(true);
    expect(nothingToTranslate("19.2 × 10⁻⁷ m")).toBe(true);
    expect(nothingToTranslate("9.6 m")).toBe(true);
  });

  it("is true for bare numbers and symbols", () => {
    expect(nothingToTranslate("3")).toBe(true);
    expect(nothingToTranslate("2 + 2")).toBe(true);
    expect(nothingToTranslate("−273.15")).toBe(true);
  });

  it("is true for a chemical formula, which must stay exactly as it is", () => {
    // Three-letters-or-more is not enough on its own: these all clear it and
    // none of them is language. Internal capitals are the tell.
    expect(nothingToTranslate("PCl₃")).toBe(true);
    expect(nothingToTranslate("NaOH")).toBe(true);
    expect(nothingToTranslate("H₂SO₄")).toBe(true);
    expect(nothingToTranslate("KMnO₄")).toBe(true);
    expect(nothingToTranslate("DNA")).toBe(true);
  });

  it("is false once there are words to translate", () => {
    expect(nothingToTranslate("pascal")).toBe(false);
    expect(nothingToTranslate("kg m s⁻¹")).toBe(true); // unit symbols, not words
    expect(nothingToTranslate("9.8 metres per second")).toBe(false);
  });

  it("is false for empty input", () => {
    expect(nothingToTranslate("")).toBe(false);
    expect(nothingToTranslate("   ")).toBe(false);
  });
});

describe("stillEnglish", () => {
  it("flags a stem that came back word for word", () => {
    const en = "Which of these is a vector quantity?";
    expect(stillEnglish(en, en)).toBe(true);
  });

  it("does not flag a numeric option that is identical on purpose", () => {
    expect(stillEnglish("9.6 × 10⁻² m", "9.6 × 10⁻² m")).toBe(false);
    expect(stillEnglish("3", "3")).toBe(false);
  });

  it("does not flag a real translation", () => {
    expect(stillEnglish("Which of these is a vector quantity?", "இவற்றுள் எது ஒரு வெக்டர் அளவு?")).toBe(false);
    expect(stillEnglish("pascal", "பாஸ்கல்")).toBe(false);
  });

  it("does not flag when either side is empty", () => {
    // Blank Tamil is caught by the separate "missing" check, which blocks saving.
    expect(stillEnglish("pascal", "")).toBe(false);
    expect(stillEnglish("", "பாஸ்கல்")).toBe(false);
  });

  it("does not flag a formula or an abbreviation the board keeps in English", () => {
    // A chemistry paper is full of these. Marking them "still in English" put a
    // red error on every formula, which is exactly what a failed translation
    // looks like.
    expect(stillEnglish("PCl₃", "PCl₃")).toBe(false);
    expect(stillEnglish("NaOH", "NaOH")).toBe(false);
    expect(stillEnglish("ADP", "ADP")).toBe(false);
  });

  it("still flags real prose that came back untranslated", () => {
    expect(stillEnglish("none of these", "none of these")).toBe(true);
    expect(stillEnglish("oxidation", "oxidation")).toBe(true);
  });
});
