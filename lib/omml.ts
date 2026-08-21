import "server-only";
import JSZip from "jszip";
import { mapScript, SUBSCRIPTS, SUPERSCRIPTS } from "./text-scripts";

/**
 * Turns Word equations into plain text before the paper is parsed.
 *
 * Word stores anything typed with Insert → Equation as OMML (`<m:oMath>`), a
 * markup island mammoth does not understand and drops on the floor. In a
 * physics or maths paper that silently empties whole options — "A) W/4" arrives
 * as "A)" with nothing after it — so the document is rewritten first, replacing
 * each equation with a readable text run that mammoth does keep.
 *
 * The rendering is deliberately plain (`W/4`, `x²`, `√(2gh)`): it has to be
 * readable in a table cell on a student's screen, and it is shown to the admin
 * in the upload preview before anything is saved.
 */

/** How the rewrite went, so the parser can warn about what it could not read. */
export type MathRewrite = {
  buffer: Buffer;
  /** Equations converted to text. */
  converted: number;
  /** Equations that held no readable text at all (hand-drawn ink, images). */
  empty: number;
};

const DOCUMENT_PART = "word/document.xml";

export async function inlineEquations(buffer: Buffer): Promise<MathRewrite> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    // Not a readable zip — let mammoth produce the real error message.
    return { buffer, converted: 0, empty: 0 };
  }

  const part = zip.file(DOCUMENT_PART);
  if (!part) return { buffer, converted: 0, empty: 0 };

  const xml = await part.async("string");
  if (!xml.includes("<m:oMath")) return { buffer, converted: 0, empty: 0 };

  let converted = 0;
  let empty = 0;

  // Display equations sit in their own <m:oMathPara>; replacing only the inner
  // <m:oMath> would leave the text inside an element mammoth skips wholesale,
  // so the whole paragraph wrapper is swapped for a real <w:p>.
  const withoutParas = replaceElements(xml, "m:oMathPara", (inner) => {
    const text = ommlToText(inner);
    if (!text) {
      empty += 1;
      return "";
    }
    converted += 1;
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  });

  const rewritten = replaceElements(withoutParas, "m:oMath", (inner) => {
    const text = ommlToText(inner);
    if (!text) {
      empty += 1;
      return "";
    }
    converted += 1;
    return `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  });

  zip.file(DOCUMENT_PART, rewritten);
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer: out, converted, empty };
}

// ---------------------------------------------------------------- xml walking

/**
 * Replaces every `<tag>…</tag>` (nesting included) using `render` on its inner
 * XML. A real DOM would be heavier than this needs to be: OMML is well-formed
 * by construction, and only one element name is being matched at a time.
 */
function replaceElements(
  xml: string,
  tag: string,
  render: (inner: string) => string,
): string {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, "g");
  let out = "";
  let cursor = 0;

  for (let match = open.exec(xml); match; match = open.exec(xml)) {
    if (match.index < cursor) continue;
    const contentStart = match.index + match[0].length;
    const end = findClosing(xml, tag, contentStart);
    if (end === -1) break;

    out += xml.slice(cursor, match.index) + render(xml.slice(contentStart, end.inner));
    cursor = end.after;
    open.lastIndex = cursor;
  }

  return out + xml.slice(cursor);
}

/** Position of the matching close tag, honouring nested elements of the same name. */
function findClosing(
  xml: string,
  tag: string,
  from: number,
): { inner: number; after: number } | -1 {
  const scanner = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, "g");
  scanner.lastIndex = from;
  let depth = 1;

  for (let match = scanner.exec(xml); match; match = scanner.exec(xml)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) {
      return { inner: match.index, after: match.index + match[0].length };
    }
  }
  return -1;
}

/** Direct children of an OMML fragment, in document order. */
function children(xml: string): { tag: string; inner: string; attrs: string }[] {
  const out: { tag: string; inner: string; attrs: string }[] = [];
  const opener = /<(m:[a-zA-Z]+)((?:\s[^>]*?)?)(\/?)>/g;
  let cursor = 0;

  for (let match = opener.exec(xml); match; match = opener.exec(xml)) {
    if (match.index < cursor) continue;
    const [full, tag, attrs, selfClosing] = match;
    if (selfClosing) {
      out.push({ tag, attrs, inner: "" });
      cursor = match.index + full.length;
      opener.lastIndex = cursor;
      continue;
    }
    const end = findClosing(xml, tag, match.index + full.length);
    if (end === -1) break;
    out.push({ tag, attrs, inner: xml.slice(match.index + full.length, end.inner) });
    cursor = end.after;
    opener.lastIndex = cursor;
  }

  return out;
}

/** The first child with this tag, if any — OMML puts operands in named slots. */
function slot(xml: string, tag: string): string | null {
  const found = children(xml).find((child) => child.tag === tag);
  return found ? found.inner : null;
}

function attribute(xml: string, tag: string, name: string): string | null {
  const found = children(xml).find((child) => child.tag === tag);
  if (!found) return null;
  const match = found.attrs.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

// ---------------------------------------------------------------- omml → text

export function ommlToText(xml: string): string {
  return children(xml)
    .map((child) => renderNode(child.tag, child.inner))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function renderNode(tag: string, inner: string): string {
  switch (tag) {
    // A run: its <m:t> holds the literal characters.
    case "m:r":
      return children(inner)
        .filter((child) => child.tag === "m:t")
        .map((child) => decodeXml(child.inner))
        .join("");

    case "m:t":
      return decodeXml(inner);

    // Properties describe formatting, never content.
    case "m:rPr":
    case "m:ctrlPr":
    case "m:fPr":
    case "m:dPr":
    case "m:radPr":
    case "m:naryPr":
    case "m:sSupPr":
    case "m:sSubPr":
    case "m:sSubSupPr":
    case "m:funcPr":
    case "m:mPr":
    case "m:limLowPr":
    case "m:limUppPr":
    case "m:barPr":
    case "m:accPr":
    case "m:groupChrPr":
    case "m:eqArrPr":
    case "m:boxPr":
    case "m:phantPr":
      return "";

    case "m:f": {
      const numerator = ommlToText(slot(inner, "m:num") ?? "");
      const denominator = ommlToText(slot(inner, "m:den") ?? "");
      return `${bracketIfCompound(numerator)}/${bracketIfCompound(denominator)}`;
    }

    case "m:sSup": {
      const base = ommlToText(slot(inner, "m:e") ?? "");
      const exponent = ommlToText(slot(inner, "m:sup") ?? "");
      return base + mapScript(exponent, SUPERSCRIPTS, "^");
    }

    case "m:sSub": {
      const base = ommlToText(slot(inner, "m:e") ?? "");
      const index = ommlToText(slot(inner, "m:sub") ?? "");
      return base + mapScript(index, SUBSCRIPTS, "_");
    }

    case "m:sSubSup": {
      const base = ommlToText(slot(inner, "m:e") ?? "");
      const index = ommlToText(slot(inner, "m:sub") ?? "");
      const exponent = ommlToText(slot(inner, "m:sup") ?? "");
      return (
        base + mapScript(index, SUBSCRIPTS, "_") + mapScript(exponent, SUPERSCRIPTS, "^")
      );
    }

    case "m:rad": {
      const degree = ommlToText(slot(inner, "m:deg") ?? "");
      const radicand = ommlToText(slot(inner, "m:e") ?? "");
      const root = degree ? `${mapScript(degree, SUPERSCRIPTS, "^")}√` : "√";
      return `${root}(${radicand})`;
    }

    // Bracketed group: Word stores the brackets it drew as attributes.
    case "m:d": {
      const begin = attribute(inner, "m:dPr", "m:begChr") ?? "(";
      const end = attribute(inner, "m:dPr", "m:endChr") ?? ")";
      const separator = attribute(inner, "m:dPr", "m:sepChr") ?? ",";
      const parts = children(inner)
        .filter((child) => child.tag === "m:e")
        .map((child) => ommlToText(child.inner));
      return `${begin}${parts.join(separator)}${end}`;
    }

    // ∑, ∫ and friends, with their limits.
    case "m:nary": {
      const operator = attribute(inner, "m:naryPr", "m:chr") ?? "∫";
      const lower = ommlToText(slot(inner, "m:sub") ?? "");
      const upper = ommlToText(slot(inner, "m:sup") ?? "");
      const body = ommlToText(slot(inner, "m:e") ?? "");
      return (
        operator +
        mapScript(lower, SUBSCRIPTS, "_") +
        mapScript(upper, SUPERSCRIPTS, "^") +
        (body ? ` ${body}` : "")
      );
    }

    case "m:func": {
      const name = ommlToText(slot(inner, "m:fName") ?? "");
      const argument = ommlToText(slot(inner, "m:e") ?? "");
      return `${name}(${argument})`;
    }

    case "m:limLow":
    case "m:limUpp": {
      const base = ommlToText(slot(inner, "m:e") ?? "");
      const limit = ommlToText(slot(inner, "m:lim") ?? "");
      return limit ? `${base}(${limit})` : base;
    }

    case "m:bar":
    case "m:acc":
    case "m:groupChr":
    case "m:box":
    case "m:phant":
      return ommlToText(slot(inner, "m:e") ?? "");

    // Rows, cells and everything else: keep the text, drop the layout.
    default:
      return ommlToText(inner);
  }
}

/** `W/4` needs no brackets; `(a+b)/2` does. */
function bracketIfCompound(part: string): string {
  if (!part) return "";
  if (/^[A-Za-z0-9π]+$/.test(part)) return part;
  if (/^\(.*\)$/.test(part)) return part;
  return `(${part})`;
}

function decodeXml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
