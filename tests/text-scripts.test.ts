import { describe, expect, it } from "vitest";
import { mapScript, SUBSCRIPTS, SUPERSCRIPTS } from "@/lib/text-scripts";

/**
 * Negative exponents are the ones that bite: Word's autocorrect, its equation
 * editor and a plain typed hyphen all produce a different character, and the
 * exponent often arrives padded with spacing. Any of those used to fall back to
 * "10^(−2)" on the student's screen.
 */
const sup = (text: string) => mapScript(text, SUPERSCRIPTS, "^");
const sub = (text: string) => mapScript(text, SUBSCRIPTS, "_");

describe("mapScript", () => {
  it("maps every minus sign Word produces", () => {
    for (const minus of ["-", "‐", "‑", "‒", "–", "—", "−"]) {
      expect(sup(`${minus}2`)).toBe("⁻²");
      expect(sup(`${minus}7`)).toBe("⁻⁷");
    }
  });

  it("ignores the spacing Word pads exponents with", () => {
    expect(sup(" -2 ")).toBe("⁻²");
    expect(sup(" −2")).toBe("⁻²");
    expect(sup("− 2")).toBe("⁻²");
  });

  it("maps plain digits, signs and letters", () => {
    expect(sup("2")).toBe("²");
    expect(sup("10")).toBe("¹⁰");
    expect(sup("+3")).toBe("⁺³");
    expect(sup("n")).toBe("ⁿ");
    expect(sup("2n")).toBe("²ⁿ");
    expect(sub("0")).toBe("₀");
    expect(sub("max")).toBe("ₘₐₓ");
  });

  it("marks what it cannot express rather than mangling it", () => {
    // No subscript "b" exists in Unicode, so the whole group stays readable.
    expect(sub("ab")).toBe("_(ab)");
    expect(sup("x+1/y")).toBe("^(x+1/y)");
  });

  it("collapses whitespace in the fallback", () => {
    expect(sup("  x  /  y  ")).toBe("^(x / y)");
  });
});
