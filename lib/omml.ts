import "server-only";
import JSZip from "jszip";
import { mtefToText } from "./mtef";
import { readOleStream } from "./ole";
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
  /**
   * MathType objects that could not be read with certainty and were left as
   * the pictures Word embedded alongside them.
   */
  pictures: number;
};

const DOCUMENT_PART = "word/document.xml";

export async function inlineEquations(buffer: Buffer): Promise<MathRewrite> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    // Not a readable zip — let mammoth produce the real error message.
    return { buffer, converted: 0, empty: 0, pictures: 0 };
  }

  const part = zip.file(DOCUMENT_PART);
  if (!part) return { buffer, converted: 0, empty: 0, pictures: 0 };

  const xml = await part.async("string");
  const hasOmml = xml.includes("<m:oMath");
  const hasObjects = xml.includes("<o:OLEObject");
  if (!hasOmml && !hasObjects) return { buffer, converted: 0, empty: 0, pictures: 0 };

  let converted = 0;
  let empty = 0;
  let pictures = 0;

  // Reading the embedded objects is async and the rewrite below is not, so the
  // equations are decoded up front and the rewrite only consults the result.
  const decoded = hasObjects ? await decodeEmbeddedEquations(zip, xml) : new Map();

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

  // MathType formulae are OLE objects, not OMML. The whole enclosing run is
  // replaced rather than just the <w:object>: Word writes an inline equation
  // into a run carrying <w:vertAlign w:val="subscript"/>, mammoth reports that
  // faithfully, and cleanText would then set the entire formula as a subscript
  // of the words in front of it. Nothing on that run describes the text going in
  // its place, so its <w:rPr> goes with the object.
  const withObjects = replaceElements(rewritten, "w:r", (inner, attrs) => {
    const id = oleRelationshipId(inner);
    if (!id) return `<w:r${attrs}>${inner}</w:r>`;

    const text = decoded.get(id);
    if (!text) {
      // Left byte-for-byte, so mammoth still extracts the picture and nothing
      // is lost.
      pictures += 1;
      return `<w:r${attrs}>${inner}</w:r>`;
    }

    converted += 1;
    // Padded either side: Word lays an equation out as an object of its own, so
    // the text around it frequently has no space of its own and "the circles
    // [x²+y²=4] also passes" would come out as "…=4also passes". cleanText
    // collapses runs of whitespace, so a spare space costs nothing.
    return `<w:r><w:t xml:space="preserve"> ${escapeXml(text)} </w:t></w:r>`;
  });

  zip.file(DOCUMENT_PART, withObjects);
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer: out, converted, empty, pictures };
}

// ------------------------------------------------------- embedded (MathType)

/** The relationship id of an `Equation.*` OLE object inside a run, if any. */
function oleRelationshipId(runXml: string): string | null {
  const object = /<o:OLEObject\b([^>]*)>/i.exec(runXml);
  if (!object) return null;

  const progId = /ProgID="([^"]*)"/i.exec(object[1])?.[1] ?? "";
  // "Equation.DSMT4" is MathType; "Equation.3" is the older editor, whose
  // streams this cannot read. Both are declined here only by their contents.
  if (!/^Equation\./i.test(progId)) return null;

  return /r:id="([^"]*)"/i.exec(object[1])?.[1] ?? null;
}

/**
 * Reads every MathType object the document references and decodes it.
 *
 * Returns a map from relationship id to text, with null for the ones that could
 * not be read — those keep their picture.
 */
async function decodeEmbeddedEquations(
  zip: JSZip,
  xml: string,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();

  const rels = zip.file("word/_rels/document.xml.rels");
  if (!rels) return out;
  const relsXml = await rels.async("string");

  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)>/gi)) {
    const id = /Id="([^"]*)"/i.exec(match[1])?.[1];
    const target = /Target="([^"]*)"/i.exec(match[1])?.[1];
    // Targets are relative to word/, which is where document.xml lives.
    if (id && target) targets.set(id, `word/${decodeXml(target).replace(/^\/+/, "")}`);
  }

  // The same object can be referenced more than once; read each part only once.
  const wanted = new Set<string>();
  for (const run of xml.matchAll(/<o:OLEObject\b([^>]*)>/gi)) {
    const progId = /ProgID="([^"]*)"/i.exec(run[1])?.[1] ?? "";
    if (!/^Equation\./i.test(progId)) continue;
    const id = /r:id="([^"]*)"/i.exec(run[1])?.[1];
    if (id) wanted.add(id);
  }

  for (const id of wanted) {
    const path = targets.get(id);
    const file = path ? zip.file(path) : null;
    if (!file) {
      out.set(id, null);
      continue;
    }
    try {
      const stream = readOleStream(await file.async("nodebuffer"), "Equation Native");
      out.set(id, stream ? mtefToText(stream) : null);
    } catch {
      out.set(id, null);
    }
  }

  return out;
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
  render: (inner: string, attrs: string) => string,
): string {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, "g");
  let out = "";
  let cursor = 0;

  for (let match = open.exec(xml); match; match = open.exec(xml)) {
    if (match.index < cursor) continue;
    const contentStart = match.index + match[0].length;
    const end = findClosing(xml, tag, contentStart);
    if (end === -1) break;

    out += xml.slice(cursor, match.index) + render(xml.slice(contentStart, end.inner), match[1] ?? "");
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
