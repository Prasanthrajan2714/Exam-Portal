/**
 * Turning the notation in a worked solution into something readable.
 *
 * Solutions come back with Unicode wherever Unicode has a character — Δl₁, d²,
 * 9.6×10⁻² — because that reads correctly with no help from us. Unicode has no
 * subscript for capital letters, though, so a subscripted symbol has to be
 * written as markup: ΔL_A, d_Cu, Y_{Al}. Printed literally that is exactly what
 * an admin reported as the solutions "looking wrong".
 *
 * The parsing below is deliberately timid, because the same text is ordinary
 * prose. A paper writes a blank as "in the ratio___", and a fill-in-the-blank
 * turning into a subscript would be a worse bug than the one being fixed. So a
 * marker only counts as notation when it is attached to a symbol and followed
 * by something that looks like an index.
 */

export type FormulaSegment =
  | { kind: "text"; value: string }
  | { kind: "sub"; value: string }
  | { kind: "sup"; value: string };

/**
 * Longest bare index accepted without braces. Covers what a paper actually
 * writes — L_0, d_Cu, F_net — while leaving snake_case words and stray
 * underscores in prose alone. Anything longer must use braces, where the intent
 * is explicit.
 */
const MAX_BARE = 3;

export function parseFormula(text: string): FormulaSegment[] {
  const out: FormulaSegment[] = [];
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ kind: "text", value: buf });
      buf = "";
    }
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch !== "_" && ch !== "^") {
      buf += ch;
      i++;
      continue;
    }

    const kind = ch === "_" ? "sub" : "sup";

    // A run of markers is a blank to be filled in, not notation.
    if (text[i + 1] === ch) {
      while (i < text.length && text[i] === ch) {
        buf += text[i];
        i++;
      }
      continue;
    }

    // Notation attaches to a symbol. A marker after a space, or opening the
    // text, is punctuation of some other kind.
    const prev = text[i - 1];
    if (prev === undefined || /\s/.test(prev)) {
      buf += ch;
      i++;
      continue;
    }

    const rest = text.slice(i + 1);

    // Braced form: the author has said what the index is, so take it whole.
    const braced = /^\{([^}]+)\}/.exec(rest);
    if (braced) {
      flush();
      out.push({ kind, value: braced[1] });
      i += 1 + braced[0].length;
      continue;
    }

    // Bare form: one run of digits or one run of letters, kept short.
    const bare = /^[+-]?(?:\d+|\p{L}+)/u.exec(rest);
    if (bare && bare[0].length <= MAX_BARE) {
      flush();
      out.push({ kind, value: bare[0] });
      i += 1 + bare[0].length;
      continue;
    }

    buf += ch;
    i++;
  }

  flush();
  return out;
}

/** Whether rendering would change anything — lets callers skip the markup. */
export function hasFormulaMarkup(text: string): boolean {
  return parseFormula(text).some((s) => s.kind !== "text");
}
