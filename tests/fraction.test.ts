import { describe, expect, it } from "vitest";
import { hasFraction, parseFractions, type MathPart } from "@/lib/fraction";

/**
 * Which slashes divide a fraction.
 *
 * The rule is stated in `lib/fraction.ts` and these are its cases — including,
 * as importantly, the ones it must leave alone. Plain text cannot distinguish
 * `m/s` from `x/y`, so the rule is deliberately simple and the cases it gets
 * "wrong" are known and accepted rather than patched around.
 */

const text = (value: string): MathPart => ({ kind: "text", value });
const over = (numerator: MathPart[], denominator: MathPart[]): MathPart => ({
  kind: "fraction",
  numerator,
  denominator,
});

/** A fraction's two halves as flat strings, for readable expectations. */
function shape(parts: MathPart[]): unknown {
  return parts.map((part) =>
    part.kind === "text" ? part.value : [shape(part.numerator), shape(part.denominator)],
  );
}

describe("what stacks", () => {
  it("stacks two numbers", () => {
    expect(parseFractions("1/2")).toEqual([over([text("1")], [text("2")])]);
  });

  it("stacks two single letters", () => {
    expect(shape(parseFractions("x/y"))).toEqual([[["x"], ["y"]]]);
  });

  it("stacks a bracketed side and drops its brackets", () => {
    // The line already groups what sits under it; keeping the brackets would
    // say it twice.
    expect(shape(parseFractions("2/(π+5)"))).toEqual([[["2"], ["π+5"]]]);
    expect(shape(parseFractions("(a+b)/2"))).toEqual([[["a+b"], ["2"]]]);
  });

  it("stacks a group containing spaces and words", () => {
    expect(shape(parseFractions("(2t dt)/(x−2)"))).toEqual([[["2t dt"], ["x−2"]]]);
  });

  it("stacks a unit, knowingly", () => {
    // Indistinguishable from x/y in plain text. Documented, not fixed.
    expect(shape(parseFractions("m/s"))).toEqual([[["m"], ["s"]]]);
  });

  it("stacks around the words either side of it", () => {
    expect(shape(parseFractions("speed is 1/2 of it"))).toEqual([
      "speed is ",
      [["1"], ["2"]],
      " of it",
    ]);
  });

  it("stacks something carrying a superscript", () => {
    expect(shape(parseFractions("x²/y³"))).toEqual([[["x²"], ["y³"]]]);
  });
});

describe("what is left alone", () => {
  it("leaves two words alone", () => {
    expect(parseFractions("and/or")).toEqual([text("and/or")]);
  });

  it("leaves a unit written as two letters alone", () => {
    expect(shape(parseFractions("km/h"))).toEqual(["km/h"]);
  });

  it("leaves a slash with nothing on one side alone", () => {
    expect(shape(parseFractions("x/"))).toEqual(["x/"]);
    expect(shape(parseFractions("/2"))).toEqual(["/2"]);
  });

  it("leaves a slash between an operand and a word alone", () => {
    expect(shape(parseFractions("2/none"))).toEqual(["2/none"]);
  });

  it("leaves text with no slash alone", () => {
    expect(parseFractions("nothing here")).toEqual([text("nothing here")]);
  });

  it("leaves an unclosed bracket alone rather than swallowing the rest", () => {
    expect(shape(parseFractions("(a+b/2"))).toEqual(["(a+", [["b"], ["2"]]]);
  });

  it("handles empty text", () => {
    expect(parseFractions("")).toEqual([]);
  });
});

describe("brackets that belong to a function", () => {
  it("keeps the whole call as the numerator", () => {
    // `f(x)` over 2, not `f` over `x)` and not x over 2.
    expect(shape(parseFractions("f(x)/2"))).toEqual([[["f(x)"], ["2"]]]);
  });

  it("keeps the whole call as the denominator", () => {
    expect(shape(parseFractions("1/f(x)"))).toEqual([[["1"], ["f(x)"]]]);
  });

  it("does not drop a function's brackets when it is stacked", () => {
    expect(shape(parseFractions("sin(x)/2"))).toEqual([[["sin(x)"], ["2"]]]);
  });

  it("still finds the fraction inside a function's argument", () => {
    // The group is not an operand of any slash, but it has to be read into.
    expect(shape(parseFractions("sin(x/2)"))).toEqual(["sin(", [["x"], ["2"]], ")"]);
  });

  it("reads into a bracketed group that is not stacked", () => {
    expect(shape(parseFractions("(a + 1/2)"))).toEqual(["(a + ", [["1"], ["2"]], ")"]);
  });
});

describe("fractions inside fractions", () => {
  it("takes a bracketed group whole as the numerator", () => {
    // Scanning character by character would make the numerator `b`.
    expect(shape(parseFractions("(a/b)/c"))).toEqual([[[[["a"], ["b"]]], ["c"]]]);
  });

  it("takes a bracketed group whole as the denominator", () => {
    expect(shape(parseFractions("c/(a/b)"))).toEqual([[["c"], [[["a"], ["b"]]]]]);
  });

  it("reads a chain left to right", () => {
    expect(shape(parseFractions("a/b/c"))).toEqual([[[[["a"], ["b"]]], ["c"]]]);
  });

  it("nests a fraction inside a bracketed numerator", () => {
    expect(shape(parseFractions("(1/2 + x)/3"))).toEqual([
      [[[["1"], ["2"]], " + x"], ["3"]],
    ]);
  });
});

describe("hasFraction", () => {
  it("is true only when stacking would change something", () => {
    expect(hasFraction("1/2")).toBe(true);
    expect(hasFraction("and/or")).toBe(false);
    expect(hasFraction("no slash at all")).toBe(false);
  });

  it("finds one nested inside a group", () => {
    // The upload preview uses this to decide whether an option has anything
    // worth previewing, so a fraction it cannot see is one nobody sees.
    expect(hasFraction("sin(x/2)")).toBe(true);
  });
});

describe("alongside the script markup a worked solution uses", () => {
  it("keeps a marked-up subscript with the symbol it belongs to", () => {
    // Split between the `_` and the `1`, the marker is stranded as a literal
    // underscore and the subscript it was there to make is lost.
    expect(shape(parseFractions("x_1/y"))).toEqual([[["x_1"], ["y"]]]);
  });

  it("stacks a symbol whose subscript is a word", () => {
    // `Cu` alone is two letters and no operand; `d_Cu` is a quantity.
    expect(shape(parseFractions("d_Cu/2"))).toEqual([[["d_Cu"], ["2"]]]);
  });

  it("keeps a braced index with its symbol", () => {
    expect(shape(parseFractions("F_{net}/2"))).toEqual([[["F_{net}"], ["2"]]]);
  });

  it("keeps a marked-up superscript with its base", () => {
    expect(shape(parseFractions("2^3/4"))).toEqual([[["2^3"], ["4"]]]);
  });
});
