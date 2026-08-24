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

  it("flags a term the board keeps in English only when it stands alone as a stem", () => {
    // "ADP" identical on both sides is correct — it is a kept-in-English term —
    // but it has letters and no Tamil, so the screen marks it for a human look
    // rather than silently accepting it.
    expect(stillEnglish("ADP", "ADP")).toBe(true);
  });
});
