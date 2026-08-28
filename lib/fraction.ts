/**
 * Finding the fractions in a line of plain text, so they can be set the way
 * they are written by hand.
 *
 * Question text is stored as text and stays that way — it has to survive an
 * Excel export and a Word round trip, and the textarea an admin types into is
 * the source of truth. This is a reading of that text at display time and
 * nothing more.
 *
 * THE RULE, decided deliberately and implemented as stated: a slash divides a
 * fraction when both sides are an operand, where an operand is a bracketed group
 * or a run of symbol characters that is not two-or-more letters on its own.
 *
 *   stacks:      1/2   x/y   2/(π+5)   (a+b)/2   (2t dt)/(x−2)
 *   left alone:  and/or   km/h
 *
 * `m/s` stacks. Plain text cannot tell it from `x/y` — the same three characters
 * — and that trade was made knowingly. Predictable beats clever here: an admin
 * who can say what the rule is can work with it, and one who cannot is left
 * guessing why two similar lines came out differently.
 */

export type MathPart =
  | { kind: "text"; value: string }
  | { kind: "fraction"; numerator: MathPart[]; denominator: MathPart[] };

/**
 * What can make up an operand: letters, digits, combining marks, the
 * super/subscript digits and letters, and the few loose symbols that belong to
 * a quantity rather than separating two of them.
 *
 * `_` and `^` are in here because a worked solution writes the scripts Unicode
 * has no character for as markup — `d_Cu`, `x^{n+1}` — and `Formula` reads that
 * markup within each piece of text this leaves behind. Left out, `x_1/y` would
 * split between the `_` and the `1`, stranding the marker as a literal
 * underscore and losing the subscript it was there to make.
 */
const SYMBOL = /[\p{L}\p{N}\p{M}°′√_^]/u;

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

type Unit =
  /** Not part of any operand: an operator, a space, a stray bracket. */
  | { kind: "other"; text: string }
  | { kind: "slash" }
  /** A run of symbol characters. */
  | { kind: "symbols"; text: string; operand: boolean }
  /** A bracketed group. The brackets are its own, so stacking drops them. */
  | { kind: "group"; open: string; inner: string; close: string }
  /**
   * A name applied to a bracketed group — `f(x)`, `sin(x/2)`, `√(2)`. The
   * brackets belong to the function, not to the group, so they stay put when
   * the whole thing is stacked.
   */
  | { kind: "call"; name: string; open: string; inner: string; close: string };

const isOperand = (unit: Unit): boolean =>
  unit.kind === "group" || unit.kind === "call" || (unit.kind === "symbols" && unit.operand);

/**
 * The end of the bracketed group starting at `from`, or -1 when it never
 * closes. Nested brackets of any type count, so `(a[b])` is one group.
 */
function groupEnd(text: string, from: number): number {
  const stack: string[] = [OPENERS[text[from]]];

  for (let i = from + 1; i < text.length; i++) {
    const char = text[i];
    if (OPENERS[char]) {
      stack.push(OPENERS[char]);
      continue;
    }
    if (!CLOSERS.has(char)) continue;
    // A closer that does not match is somebody else's, or a typo; either way
    // this group is not well-formed and is left as plain text.
    if (char !== stack[stack.length - 1]) return -1;
    stack.pop();
    if (stack.length === 0) return i;
  }
  return -1;
}

function symbolsUnit(text: string): Unit {
  // "and", "km" and "or" are words. One letter is a variable, and anything
  // carrying a digit, a mark or a symbol is a quantity.
  const lettersOnly = /^\p{L}+$/u.test(text);
  return { kind: "symbols", text, operand: !(lettersOnly && text.length >= 2) };
}

/** Breaks a line into the pieces the rule is stated in terms of. */
function scan(text: string): Unit[] {
  const units: Unit[] = [];
  let i = 0;

  const pushOther = (value: string) => {
    const last = units[units.length - 1];
    if (last?.kind === "other") last.text += value;
    else units.push({ kind: "other", text: value });
  };

  while (i < text.length) {
    const char = text[i];

    if (char === "/") {
      units.push({ kind: "slash" });
      i += 1;
      continue;
    }

    if (OPENERS[char]) {
      const end = groupEnd(text, i);
      if (end === -1) {
        pushOther(char);
        i += 1;
        continue;
      }

      const group = {
        open: char,
        inner: text.slice(i + 1, end),
        close: text[end],
      };

      // A group straight after a name is that name's argument list, so the two
      // are one operand and the brackets are not the group's to drop.
      const previous = units[units.length - 1];
      if (previous?.kind === "symbols") {
        units[units.length - 1] = { kind: "call", name: previous.text, ...group };
      } else {
        units.push({ kind: "group", ...group });
      }

      i = end + 1;
      continue;
    }

    if (SYMBOL.test(char)) {
      let end = i;
      while (end < text.length && SYMBOL.test(text[end])) end += 1;
      units.push(symbolsUnit(text.slice(i, end)));
      i = end;
      continue;
    }

    pushOther(char);
    i += 1;
  }

  return units;
}

/** A unit as it reads in place, brackets and all. */
function unitParts(unit: Unit): MathPart[] {
  return mergeText(rawUnitParts(unit));
}

function rawUnitParts(unit: Unit): MathPart[] {
  switch (unit.kind) {
    case "group":
      // Recursed into even when it is not being stacked, so the fraction in
      // `sin(x/2)` is still found.
      return [
        { kind: "text", value: unit.open },
        ...parseFractions(unit.inner),
        { kind: "text", value: unit.close },
      ];
    case "call":
      return [
        { kind: "text", value: unit.name + unit.open },
        ...parseFractions(unit.inner),
        { kind: "text", value: unit.close },
      ];
    case "slash":
      return [{ kind: "text", value: "/" }];
    default:
      return [{ kind: "text", value: unit.text }];
  }
}

/**
 * A unit as it reads once stacked.
 *
 * A bracketed operand loses its brackets: the rule has already grouped what
 * sits under the line, so `2/(π+5)` reads as 2 over π+5, never as 2 over (π+5).
 */
function stackedParts(unit: Unit): MathPart[] {
  return unit.kind === "group" ? parseFractions(unit.inner) : unitParts(unit);
}

/**
 * Runs of plain text come out of the scan one unit at a time — "π", "+", "5".
 * Joined back up they are one string again, which is what a caller wants to
 * draw and what a reader wants to select.
 */
function mergeText(parts: MathPart[]): MathPart[] {
  const out: MathPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (part.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = { kind: "text", value: last.value + part.value };
    } else {
      out.push(part);
    }
  }
  return out;
}

export function parseFractions(text: string): MathPart[] {
  const units = scan(text);
  const out: MathPart[] = [];
  let i = 0;

  while (i < units.length) {
    const unit = units[i];
    const divides =
      isOperand(unit) &&
      units[i + 1]?.kind === "slash" &&
      units[i + 2] !== undefined &&
      isOperand(units[i + 2]);

    if (!divides) {
      out.push(...unitParts(unit));
      i += 1;
      continue;
    }

    // `a/b/c` reads as (a/b)/c: each slash takes what has been built so far.
    let numerator = stackedParts(unit);
    let j = i + 1;
    while (units[j]?.kind === "slash" && units[j + 1] !== undefined && isOperand(units[j + 1])) {
      numerator = [
        { kind: "fraction", numerator, denominator: stackedParts(units[j + 1]) },
      ];
      j += 2;
    }

    out.push(...numerator);
    i = j;
  }

  return mergeText(out);
}

/**
 * Whether stacking would change anything, so callers can skip the markup — and
 * so the upload preview knows whether an option has anything to preview.
 *
 * Recurses, because the only fraction in `sin(x/2)` is inside a group.
 */
export function hasFraction(text: string): boolean {
  if (!text.includes("/")) return false;
  // A group's contents are spliced into the list around it, so the fraction in
  // `sin(x/2)` shows up here. Only a fraction inside another fraction is nested,
  // and that one has an enclosing fraction to be found by.
  return parseFractions(text).some((part) => part.kind === "fraction");
}
