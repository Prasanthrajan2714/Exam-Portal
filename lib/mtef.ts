import { mapScript, SUBSCRIPTS, SUPERSCRIPTS } from "./text-scripts";

/**
 * Reads a MathType equation out of its "Equation Native" stream and writes it
 * as plain text.
 *
 * Word's own Insert → Equation produces OMML, which `lib/omml.ts` already
 * inlines. A paper typed in MathType contains none: every formula is an OLE
 * object with a picture of itself attached, and mammoth can only take the
 * picture. This reads the equation instead, so a MathType paper arrives as text
 * like every other one.
 *
 * The output follows the conventions in `ommlToText` exactly — `(a+b)/2`,
 * `√(2gh)`, `x²` — because a paper can mix both formats and the two halves of
 * it have to read the same.
 *
 * THE RULE THAT MATTERS: anything not understood returns null, and the caller
 * keeps the picture. Not a skipped record, not a guess, not a best effort. A
 * formula left as a picture is a nuisance; a formula quietly decoded into a
 * different expression is a wrong answer in an examination.
 */

// ---------------------------------------------------------------- records

const END = 0x00;
const LINE = 0x01;
const CHAR = 0x02;
const TMPL = 0x03;
const PILE = 0x04;
const EMBELL = 0x06;
const SIZE_FULL = 0x0a;
const SIZE_SUBSYM = 0x0e;
const COLOR = 0x0f;
const COLOR_DEF = 0x10;
const FONT_DEF = 0x11;
const EQN_PREFS = 0x12;
const ENCODING_DEF = 0x13;

/** LINE options: the line is absent altogether. */
const LINE_NULL = 0x01;
/** CHAR options: embellishments follow. */
const CHAR_EMBELL = 0x01;
/** CHAR options: an 8-bit font-specific code follows the 16-bit one. */
const CHAR_FONT_CODE = 0x04;

// ---------------------------------------------------------------- templates

const TEMPLATE = {
  PARENTHESES: 1,
  BRACE: 2,
  VERTICAL_BARS: 4,
  ROOT: 10,
  FRACTION: 11,
  INTEGRAL: 15,
  LIMIT: 23,
  /** Subscript alone. */
  SUBSCRIPT: 27,
  /** Subscript and superscript, either of which may be a null line. */
  SCRIPT: 28,
  /** Subscript and superscript together. */
  SUBSUPERSCRIPT: 29,
} as const;

/**
 * The three selectors that mean "scripts attached to what came before".
 *
 * 28 was the one specified; 27 and 29 were found in a chemistry paper here and
 * identified from their own contents rather than assumed. Every one of the 30-odd
 * 27s in that paper holds its content in the first slot with the second null,
 * and reading them as subscripts produces CH₃Cl, H₂O₂, Na₂S₃O₆ and
 * FeSO₄(NH₄)₂SO₄·6H₂O — each of which the surrounding question names in words.
 * The single 29 holds ["3", "−"], which is HSO₃⁻, an option in a question about
 * the oxidation number of sulphur. All three take the same two slots, so all
 * three render the same way.
 */
const SCRIPT_TEMPLATES: number[] = [
  TEMPLATE.SUBSCRIPT,
  TEMPLATE.SCRIPT,
  TEMPLATE.SUBSUPERSCRIPT,
];

/**
 * Marks MathType writes as separate records, as Unicode combining characters.
 *
 * These are not decoration. A vector arrow is what separates a vector from a
 * scalar and a hat is what separates a unit vector from either, so an equation
 * that loses one is a different equation.
 */
const EMBELLISHMENTS: Record<number, string> = {
  2: "̇", // dot
  3: "̈", // double dot
  4: "⃛", // triple dot
  8: "̃", // tilde
  9: "̂", // hat
  10: "̌", // caron
  11: "⃗", // vector arrow
  12: "̄", // bar
};

/**
 * The only private-use characters that occur in practice.
 *
 * They come from MathType's own fonts, where the private-use area means
 * whatever that font says it means. Anything else in the range is a failure:
 * passed through it would reach a student as an empty box.
 */
const PRIVATE_USE: Record<number, string> = {
  0xef02: " ",
  0xec07: "|",
  0xec08: "|",
};

const PRIVATE_USE_START = 0xe000;
const PRIVATE_USE_END = 0xf8ff;

// ---------------------------------------------------------------- parse tree

type Node =
  | { kind: "char"; text: string }
  | { kind: "line"; children: Node[] }
  | { kind: "nullLine" }
  | { kind: "template"; selector: number; lines: Node[]; glyphs: string[] }
  | { kind: "pile"; rows: Node[] };

/** Thrown internally the moment anything is not understood; never escapes. */
class Unreadable extends Error {}

class Reader {
  private at = 0;

  constructor(private readonly data: Buffer) {}

  get done(): boolean {
    return this.at >= this.data.length;
  }

  byte(): number {
    if (this.at >= this.data.length) throw new Unreadable("past the end");
    return this.data[this.at++];
  }

  uint16(): number {
    if (this.at + 2 > this.data.length) throw new Unreadable("past the end");
    const value = this.data.readUInt16LE(this.at);
    this.at += 2;
    return value;
  }

  /** A NUL-terminated string. */
  zstring(): string {
    const end = this.data.indexOf(0, this.at);
    if (end === -1) throw new Unreadable("unterminated string");
    const text = this.data.subarray(this.at, end).toString("latin1");
    this.at = end + 1;
    return text;
  }

  /**
   * A nibble string: 4-bit values, high nibble first, ending at nibble 0xf and
   * padded to a byte.
   *
   * It has to be walked rather than stepped over, because its length is only
   * knowable by reading it — and a fixed skip lands in the middle of the
   * equation, where the bytes still parse and mean something else entirely.
   */
  nibbleString(): void {
    let high = true;
    for (;;) {
      if (this.at >= this.data.length) throw new Unreadable("past the end");
      const value = high
        ? this.data[this.at] >> 4
        : this.data[this.at] & 0x0f;
      if (high) {
        high = false;
      } else {
        high = true;
        this.at += 1;
      }
      if (value === 0x0f) break;
    }
    if (!high) this.at += 1; // finish the byte the string ended inside
  }

  skip(count: number): void {
    if (this.at + count > this.data.length) throw new Unreadable("past the end");
    this.at += count;
  }
}

function character(code: number): string {
  if (code >= PRIVATE_USE_START && code <= PRIVATE_USE_END) {
    const known = PRIVATE_USE[code];
    if (!known) {
      // A glyph from a font nobody outside MathType has. Rendering it would
      // show a student an empty box, so the picture is the better answer.
      throw new Unreadable(`private-use character ${code.toString(16)}`);
    }
    return known;
  }
  return String.fromCharCode(code);
}

/** Reads records until END, which is consumed. */
function readList(reader: Reader): Node[] {
  const out: Node[] = [];

  for (;;) {
    const tag = reader.byte();

    switch (tag) {
      case END:
        return out;

      case LINE: {
        const options = reader.byte();
        // A null line has no children AND no END of its own. Reading one as an
        // ordinary line consumes the next record as its content and mis-nests
        // every script and radical after it.
        if (options & LINE_NULL) {
          out.push({ kind: "nullLine" });
          break;
        }
        out.push({ kind: "line", children: readList(reader) });
        break;
      }

      case CHAR: {
        const options = reader.byte();
        reader.byte(); // typeface
        const code = reader.uint16();
        if (options & CHAR_FONT_CODE) reader.byte();

        let text = character(code);
        if (options & CHAR_EMBELL) {
          for (const mark of readList(reader)) {
            if (mark.kind === "char") text += mark.text;
          }
        }
        out.push({ kind: "char", text });
        break;
      }

      case TMPL: {
        reader.byte(); // options
        const selector = reader.byte();
        reader.byte(); // variation
        reader.byte(); // template options
        const children = readList(reader);
        out.push({
          kind: "template",
          selector,
          lines: children.filter((c) => c.kind === "line" || c.kind === "nullLine"),
          // The brackets and the integral sign the template drew itself.
          glyphs: children.filter((c) => c.kind === "char").map((c) => c.text),
        });
        break;
      }

      case PILE: {
        reader.byte(); // options
        reader.byte(); // horizontal alignment
        reader.byte(); // vertical alignment
        out.push({ kind: "pile", rows: readList(reader) });
        break;
      }

      case EMBELL: {
        reader.byte(); // options
        const type = reader.byte();
        const mark = EMBELLISHMENTS[type];
        if (!mark) throw new Unreadable(`embellishment ${type}`);
        out.push({ kind: "char", text: mark });
        break;
      }

      case COLOR:
        reader.skip(1);
        break;

      case COLOR_DEF:
        reader.skip(7);
        break;

      case FONT_DEF:
        reader.byte(); // encoding
        reader.zstring();
        break;

      case ENCODING_DEF:
        reader.zstring();
        break;

      case EQN_PREFS: {
        reader.byte(); // options
        for (const _ of ["sizes", "spacing"]) {
          void _;
          const count = reader.byte();
          for (let i = 0; i < count; i++) reader.nibbleString();
        }
        const styles = reader.byte();
        reader.skip(styles * 2);
        break;
      }

      default:
        // Size changes carry no payload and mean nothing to plain text.
        if (tag >= SIZE_FULL && tag <= SIZE_SUBSYM) break;
        throw new Unreadable(`record ${tag.toString(16)}`);
    }
  }
}

// ---------------------------------------------------------------- render

/** `W/4` needs no brackets; `(a+b)/2` does. Same rule as `ommlToText`. */
function bracketIfCompound(part: string): string {
  if (!part) return "";
  if (/^[A-Za-z0-9π]+$/.test(part)) return part;
  if (/^\(.*\)$/.test(part)) return part;
  return `(${part})`;
}

function renderNodes(nodes: Node[]): string {
  let out = "";
  for (const node of nodes) out = append(out, node);
  return out;
}

/**
 * Appends one node to what has been rendered so far.
 *
 * A script template carries only its scripts — the thing being raised is
 * whatever preceded it — so rendering has to be able to reach back at the text
 * already produced rather than treat each node on its own.
 */
function append(out: string, node: Node): string {
  switch (node.kind) {
    case "char":
      return out + node.text;

    case "nullLine":
      return out;

    case "line":
      return out + renderNodes(node.children);

    case "pile":
      return (
        out +
        node.rows
          .filter((row) => row.kind !== "nullLine")
          .map((row) => renderNodes([row]))
          .filter(Boolean)
          .join(", ")
      );

    case "template":
      return renderTemplate(out, node);
  }
}

function renderTemplate(
  out: string,
  node: Extract<Node, { kind: "template" }>,
): string {
  const slot = (index: number): string => {
    const line = node.lines[index];
    if (!line || line.kind === "nullLine") return "";
    return renderNodes([line]);
  };

  // The scripts attach to whatever was rendered before them: MathType stores
  // the base outside the template, as the preceding sibling.
  if (SCRIPT_TEMPLATES.includes(node.selector)) {
    return (
      out + mapScript(slot(0), SUBSCRIPTS, "_") + mapScript(slot(1), SUPERSCRIPTS, "^")
    );
  }

  switch (node.selector) {
    case TEMPLATE.FRACTION:
      return `${out}${bracketIfCompound(slot(0))}/${bracketIfCompound(slot(1))}`;

    case TEMPLATE.ROOT: {
      const index = slot(1);
      const sign = index ? `${mapScript(index, SUPERSCRIPTS, "^")}√` : "√";
      return `${out}${sign}(${slot(0)})`;
    }

    case TEMPLATE.INTEGRAL: {
      const body = slot(0);
      return (
        out +
        (node.glyphs.join("") || "∫") +
        mapScript(slot(1), SUBSCRIPTS, "_") +
        mapScript(slot(2), SUPERSCRIPTS, "^") +
        (body ? ` ${body}` : "")
      );
    }

    case TEMPLATE.LIMIT: {
      const under = slot(1);
      return out + slot(0) + (under ? `(${under})` : "");
    }

    // Delimiters: the glyphs are whatever MathType drew, so a bracket typed as
    // a square one stays square without any of them being hardcoded.
    case TEMPLATE.PARENTHESES:
      return `${out}${node.glyphs[0] ?? "("}${slot(0)}${node.glyphs[1] ?? ")"}`;

    case TEMPLATE.VERTICAL_BARS:
      return `${out}${node.glyphs[0] ?? "|"}${slot(0)}${node.glyphs[1] ?? "|"}`;

    // A piecewise definition. MathType stores only the opening brace.
    case TEMPLATE.BRACE:
      return `${out}${node.glyphs[0] ?? "{"}${renderNodes(node.lines)}`;

    default:
      throw new Unreadable(`template ${node.selector}`);
  }
}

// ---------------------------------------------------------------- entry point

/** Bytes of the OLE equation header, which sit before the MTEF data. */
function mtefStart(stream: Buffer): number | null {
  if (stream.length < 2) return null;
  const headerLength = stream.readUInt16LE(0);
  if (headerLength < 2 || headerLength >= stream.length) return null;
  return headerLength;
}

/**
 * The equation as text, or null when it cannot be read with certainty.
 *
 * MTEF 2 and 3, written by the older "Equation.3" editor, are a different
 * layout and are declined rather than guessed at.
 */
export function mtefToText(stream: Buffer): string | null {
  const start = mtefStart(stream);
  if (start === null) return null;

  try {
    const reader = new Reader(stream.subarray(start));

    const version = reader.byte();
    if (version !== 5) return null;

    reader.skip(4); // platform, product, version, sub-version
    reader.zstring(); // application key, "DSMT6"
    reader.byte(); // options

    const nodes: Node[] = [];
    while (!reader.done) {
      // The stream is a sequence of records rather than one list, so END at the
      // top level closes a list and the next record carries on.
      nodes.push(...readList(reader));
    }

    const text = renderNodes(nodes).replace(/\s+/g, " ").trim();
    // An equation that decodes to nothing tells the caller nothing; the picture
    // at least shows something.
    return text ? text.normalize("NFC") : null;
  } catch (error) {
    if (error instanceof Unreadable) return null;
    // A bug here must not take the upload down with it.
    return null;
  }
}
