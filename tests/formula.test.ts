import { describe, expect, it } from "vitest";
import { hasFormulaMarkup, parseFormula } from "@/lib/formula";

/**
 * Reading a worked solution's notation without wrecking its prose.
 *
 * Every case below is taken from, or modelled on, solutions this portal has
 * actually produced. The prose cases matter as much as the notation ones: the
 * text being parsed is mostly ordinary English, and a fill-in-the-blank turning
 * into a subscript would be worse than the literal "_A" this fixes.
 */

const text = (v: string) => ({ kind: "text", value: v });
const sub = (v: string) => ({ kind: "sub", value: v });
const sup = (v: string) => ({ kind: "sup", value: v });

describe("parseFormula", () => {
  it("reads the capital-letter subscripts Unicode cannot express", () => {
    // The exact string that was on screen as "ΔL_A : ΔL_B".
    expect(parseFormula("ΔL_A : ΔL_B")).toEqual([
      text("ΔL"),
      sub("A"),
      text(" : ΔL"),
      sub("B"),
    ]);
  });

  it("reads two-letter element subscripts", () => {
    expect(parseFormula("d_Cu² = d_Al²")).toEqual([
      text("d"),
      sub("Cu"),
      text("² = d"),
      sub("Al"),
      text("²"),
    ]);
  });

  it("stops the subscript at the next symbol, not the next space", () => {
    expect(parseFormula("Y_Al/Y_Cu")).toEqual([
      text("Y"),
      sub("Al"),
      text("/Y"),
      sub("Cu"),
    ]);
  });

  it("reads superscripts, including signed exponents", () => {
    expect(parseFormula("10^-3")).toEqual([text("10"), sup("-3")]);
    expect(parseFormula("x^2")).toEqual([text("x"), sup("2")]);
  });

  it("takes a braced index whole, however long", () => {
    expect(parseFormula("F_{net} = ma")).toEqual([
      text("F"),
      sub("net"),
      text(" = ma"),
    ]);
    expect(parseFormula("x^{n+1}")).toEqual([text("x"), sup("n+1")]);
  });

  it("leaves a fill-in-the-blank alone", () => {
    // A paper writes blanks like this constantly. Turning "___" into a
    // subscript would corrupt the question rather than fix the notation.
    const blank = "their increase in length will be in the ratio___.";
    expect(parseFormula(blank)).toEqual([text(blank)]);
  });

  it("leaves a lone underscore in prose alone", () => {
    expect(parseFormula("fill in the _ here")).toEqual([
      text("fill in the _ here"),
    ]);
  });

  it("leaves an identifier too long to be an index alone", () => {
    // snake_case is not notation; the length guard is what tells them apart.
    expect(parseFormula("max_value")).toEqual([text("max_value")]);
  });

  it("leaves an unclosed brace alone rather than swallowing the rest", () => {
    expect(parseFormula("d_{Cu = 2")).toEqual([text("d_{Cu = 2")]);
  });

  it("passes ordinary prose through untouched", () => {
    const prose =
      "Breaking stress = breaking force/area is a property of the material only.";
    expect(parseFormula(prose)).toEqual([text(prose)]);
  });

  it("passes Unicode notation through untouched", () => {
    // Digits already have real subscripts and superscripts, so solutions use
    // them and nothing here should interfere.
    const s = "Δl₁ : Δl₂ = 1 : 1, with 9.6×10⁻² m and d².";
    expect(parseFormula(s)).toEqual([text(s)]);
  });

  it("handles empty input", () => {
    expect(parseFormula("")).toEqual([]);
  });
});

describe("hasFormulaMarkup", () => {
  it("is true only when rendering would change something", () => {
    expect(hasFormulaMarkup("ΔL_A")).toBe(true);
    expect(hasFormulaMarkup("Δl₁ : Δl₂ = 1 : 1")).toBe(false);
    expect(hasFormulaMarkup("in the ratio___.")).toBe(false);
  });
});
