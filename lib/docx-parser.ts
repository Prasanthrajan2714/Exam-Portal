import "server-only";
import mammoth from "mammoth";
import { inlineEquations } from "./omml";
import { mapScript, SUBSCRIPTS, SUPERSCRIPTS } from "./text-scripts";
import { saveExamImage, type StoredImage } from "./uploads";

/**
 * Parses a question paper from the .docx template into structured questions.
 *
 * The template is deliberately strict — Word documents in the wild have no
 * reliable structure — but the parser is forgiving about the things people
 * genuinely vary (".", ")" after numbers; "Q1" vs "1"; extra blank lines), and
 * every result goes to an admin preview screen before anything is saved. The
 * parser's job is to get it 95% right and to be honest about the rest.
 */

export type OptionKey = "A" | "B" | "C" | "D";

export type ParsedImage = {
  /** Upload-root-relative path. */
  path: string;
  /**
   * The size the document lays this out at, in CSS pixels — 0 when unknown.
   * Word writes Equation Editor formulae as text-height metafiles, so without
   * carrying this an inline formula displays at whatever it was rasterised to.
   */
  width: number;
  height: number;
  target: "STEM" | OptionKey;
};

export type ParsedQuestion = {
  /** Sequential index within the whole document, for stable React keys. */
  index: number;
  subjectName: string;
  number: number;
  text: string;
  options: Record<OptionKey, string>;
  images: ParsedImage[];
  /** Problems the admin must look at — a question with any of these is not publishable. */
  issues: string[];
};

export type ParseWarning = { line: number; message: string };

export type ParsedPaper = {
  questions: ParsedQuestion[];
  /** Subjects in the order they appeared. */
  subjectNames: string[];
  warnings: ParseWarning[];
};

const OPTION_KEYS: OptionKey[] = ["A", "B", "C", "D"];

// ---------------------------------------------------------------- html → lines

/** An image on a line, before it is known which part of a question it belongs to. */
type FragmentImage = Omit<ParsedImage, "target">;

type Fragment = {
  text: string;
  images: FragmentImage[];
  /** Depth of the ordered list this line came from; 0 when it is a plain paragraph. */
  orderedDepth: number;
};

/**
 * Word's automatic numbering is not stored in the paragraph text — a question
 * typed as a numbered list arrives as "A cable that can support…" with no "1."
 * anywhere. Mammoth does render those paragraphs as <ol><li>, so the list
 * structure is marked here and used later to recognise a question that carries
 * no number of its own.
 */
const ORDERED_ITEM = "\uE000";

function markOrderedItems(html: string): string {
  const stack: string[] = [];
  return html.replace(/<(\/?)(ol|ul|li)\b[^>]*>/gi, (tagText, slash: string, name: string) => {
    const tag = name.toLowerCase();
    if (tag === "li") {
      if (slash) return tagText;
      // A nested list closes inside its parent item, so the parent's own </li>
      // arrives after the children: without a break here the first sub-item
      // would be glued onto the end of the text above it.
      const depth = stack.filter((entry) => entry === "ol").length;
      return `${tagText}\n${ORDERED_ITEM.repeat(depth)}`;
    }
    if (slash) stack.pop();
    else stack.push(tag);
    return tagText;
  });
}

/**
 * Mammoth emits predictable, shallow HTML (`<p>`, `<strong>`, `<em>`, `<sup>`,
 * `<sub>`, `<img>`, tables), so paragraphs are split with a regex rather than by
 * pulling in a DOM implementation on the server.
 */
function htmlToFragments(html: string): Fragment[] {
  // Treat block boundaries as line breaks. Table cells become their own lines,
  // which is what a paper laid out in a 2-column table needs.
  const withBreaks = markOrderedItems(html)
    .replace(/<\/(p|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n");

  return withBreaks.split("\n").map((rawLine) => {
    const images: FragmentImage[] = [];
    // Image placeholders were injected by encodeImageRef. Each leaves a token
    // behind rather than a space: a maths paper writes the relation itself as an
    // equation image mid-sentence, and dropping the position turns "the common
    // tangent to the circles [x²+y²=4 and …] also passes through" into "the
    // common tangent to the circles also passes through" with the equation
    // stranded underneath.
    const withoutImages = rawLine.replace(
      /<img[^>]*src="upload:([^"]+)"[^>]*>/gi,
      (_match, src: string) => {
        const slot = images.push(decodeImageRef(decodeHtml(src))) - 1;
        return ` [[slot:${slot}]] `;
      },
    );
    const text = cleanText(withoutImages);
    const orderedDepth = countLeading(text, ORDERED_ITEM);
    return { text: text.slice(orderedDepth).trim(), images, orderedDepth };
  });
}

function countLeading(text: string, char: string): number {
  let count = 0;
  while (text[count] === char) count += 1;
  return count;
}

/**
 * Maps a `<sup>`/`<sub>` to real characters, but never swallows an image.
 *
 * Word writes an equation image into a run mammoth reports as a subscript, so
 * every equation in a maths paper arrives as `<sub><img></sub>`. Feeding that
 * through the script mapping produced `_([[slot:0]])` — it corrupted the marker,
 * and it claimed the equation was a subscript of nothing. The image comes out
 * whole and only the text around it is treated as script.
 */
function scriptReplacer(table: Record<string, string>, fallback: string) {
  return (_match: string, inner: string) => {
    const tokens: string[] = [];
    const rest = inner.replace(/\[\[slot:\d+\]\]/g, (token) => {
      tokens.push(token);
      return "";
    });
    const mapped = mapScript(rest, table, fallback);
    return tokens.length > 0 ? `${mapped}${tokens.join("")}` : mapped;
  };
}

/**
 * HTML for one line, reduced to text. Exported for its own tests: the sup/sub
 * handling is where Word documents fight back hardest.
 *
 * Runs after image tags have become slot tokens, so it must leave those alone.
 */
export function cleanText(html: string): string {
  const converted = html
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, scriptReplacer(SUPERSCRIPTS, "^"))
    .replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, scriptReplacer(SUBSCRIPTS, "_"));
  return decodeHtml(stripTags(converted)).replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    );
}

/**
 * Mammoth's image hook can only hand the HTML a `src` string, so the document's
 * intended display size rides along inside the placeholder and is unpacked when
 * the placeholder is read back out.
 */
const IMAGE_REF_RE = /^(\d+)x(\d+):([\s\S]+)$/;

function encodeImageRef(stored: StoredImage): string {
  return `upload:${stored.width}x${stored.height}:${stored.path}`;
}

function decodeImageRef(src: string): FragmentImage {
  const match = src.match(IMAGE_REF_RE);
  // A bare path stays valid — it just means no size was recorded.
  if (!match) return { path: src, width: 0, height: 0 };
  return { path: match[3], width: Number(match[1]), height: Number(match[2]) };
}

/** Where a fragment's own image sat, before the question owns it. */
const SLOT_RE = /\[\[slot:(\d+)\]\]/g;

/**
 * Moves a fragment's images onto the question under `target`, and rewrites the
 * slot tokens in `text` to the position each image ends up at.
 *
 * The number in the stored marker is the image's index in the question's own
 * list, which is exactly the `order` it is saved with — so rendering can find it
 * again with no extra column.
 *
 * Images whose token did not survive are still kept, appended to the end as they
 * always were. A paper is not worth losing a diagram over, and every question
 * stored before markers existed reads that way too.
 */
function attachImages(
  question: ParsedQuestion,
  fragment: Fragment,
  target: "STEM" | OptionKey,
  text: string,
): string {
  const placed = new Set<number>();

  const marked = text.replace(SLOT_RE, (_match, slot: string) => {
    const image = fragment.images[Number(slot)];
    if (!image) return "";
    placed.add(Number(slot));
    const order = question.images.length;
    question.images.push({ ...image, target });
    return `[[#${order}]]`;
  });

  fragment.images.forEach((image, slot) => {
    if (!placed.has(slot)) question.images.push({ ...image, target });
  });

  return marked.replace(/\s+/g, " ").trim();
}

/** Drops slot tokens from text that is being thrown away or matched against. */
function withoutSlots(text: string): string {
  return text.replace(SLOT_RE, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- patterns

const SUBJECT_RE = /^\[?\s*subject\s*[:\-]\s*(.+?)\s*\]?$/i;
// "1." / "1)" / "Q1." / "Q. 1" — all common in papers people actually type.
const QUESTION_RE = /^(?:q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*[.):\]]\s*(.*)$/i;
const OPTION_RE = /^\(?([a-dA-D])\)?\s*[.)\]:]\s*(.*)$/;

// ---------------------------------------------------------------- main

export async function parseQuestionPaper(
  file: File,
  examId: string,
): Promise<ParsedPaper> {
  const original = Buffer.from(await file.arrayBuffer());
  // Word equations are markup mammoth drops, so they are turned into text
  // before it ever sees the document.
  const { buffer, converted: equationsConverted, empty: equationsEmpty } =
    await inlineEquations(original);

  // Images are written to disk during conversion and referenced by a token that
  // survives the HTML-to-text pass below.
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          const data = await image.read();
          const stored = await saveExamImage(
            examId,
            Buffer.from(data),
            image.contentType ?? "image/png",
          );
          return { src: encodeImageRef(stored) };
        } catch {
          // A single unreadable image must not abort the whole paper.
          return { src: "" };
        }
      }),
    },
  );

  const fragments = htmlToFragments(result.value);

  const questions: ParsedQuestion[] = [];
  const subjectNames: string[] = [];
  const warnings: ParseWarning[] = [];

  let currentSubject = "";
  let current: ParsedQuestion | null = null;
  // Which part of the current question new text/images belong to.
  let cursor: "STEM" | OptionKey | null = null;
  // Highest number seen per subject, so questions Word numbered automatically
  // can carry on from where the typed ones left off.
  const lastNumber = new Map<string, number>();
  let autoNumbered = 0;

  const flush = () => {
    if (current) questions.push(current);
    current = null;
    cursor = null;
  };

  fragments.forEach((fragment, i) => {
    const line = i + 1;
    const text = fragment.text;

    if (!text && fragment.images.length === 0) return;

    // --- subject header
    const subjectMatch = text.match(SUBJECT_RE);
    if (subjectMatch) {
      flush();
      currentSubject = subjectMatch[1].trim();
      if (currentSubject && !subjectNames.includes(currentSubject)) {
        subjectNames.push(currentSubject);
      }
      return;
    }

    // --- new question
    const questionMatch = text.match(QUESTION_RE);
    // An option line like "1) ..." can't exist, but "A) 12" can look numeric —
    // require the option test to fail first.
    if (questionMatch && !OPTION_RE.test(text)) {
      flush();
      current = {
        index: questions.length,
        subjectName: currentSubject,
        number: Number(questionMatch[1]),
        text: "",
        options: { A: "", B: "", C: "", D: "" },
        images: [],
        issues: [],
      };
      cursor = "STEM";
      lastNumber.set(currentSubject, Number(questionMatch[1]));
      current.text = attachImages(current, fragment, "STEM", questionMatch[2].trim());
      if (!currentSubject) {
        warnings.push({
          line,
          message: `Question ${questionMatch[1]} appears before any [SUBJECT: …] heading.`,
        });
      }
      return;
    }

    // --- option
    const optionMatch = text.match(OPTION_RE);
    if (optionMatch && current) {
      const labelled = optionMatch[1].toUpperCase() as OptionKey;

      // Papers are typed by hand and mislabel an option often enough to matter:
      // this one runs "A) B) C) B)", so taking the label at its word overwrote
      // option B and left D empty — reported as "Option D is empty", which sends
      // the admin looking at the wrong line. The second B goes to the first free
      // slot instead, and the mislabelling is said out loud.
      const taken =
        Boolean(current.options[labelled]) ||
        current.images.some((i) => i.target === labelled);
      const key = taken
        ? OPTION_KEYS.find(
            (k) => !current!.options[k] && !current!.images.some((i) => i.target === k),
          )
        : labelled;

      if (!key) {
        warnings.push({
          line,
          message: `Question ${current.number} has more than four options — "${labelled})" could not be placed.`,
        });
        return;
      }
      if (key !== labelled) {
        warnings.push({
          line,
          message:
            `Question ${current.number} labels two options "${labelled})". ` +
            `The second has been read as option ${key} — check it is the right way round.`,
        });
      }

      current.options[key] = attachImages(current, fragment, key, optionMatch[2].trim());
      cursor = key;
      return;
    }

    // --- a question Word numbered for us
    // The number only exists as list formatting, so the list item itself is the
    // signal. Nested items are the options of the item above them, which is how
    // a paper with automatically lettered options is laid out.
    // A line holding nothing but an image is not a new question, whatever list
    // formatting it carries — it is a continuation of the one above.
    if (fragment.orderedDepth === 1 && withoutSlots(text)) {
      flush();
      const number = (lastNumber.get(currentSubject) ?? 0) + 1;
      lastNumber.set(currentSubject, number);
      autoNumbered += 1;
      current = {
        index: questions.length,
        subjectName: currentSubject,
        number,
        text: "",
        options: { A: "", B: "", C: "", D: "" },
        images: [],
        issues: [],
      };
      cursor = "STEM";
      current.text = attachImages(current, fragment, "STEM", text);
      if (!currentSubject) {
        warnings.push({
          line,
          message: `Question ${number} appears before any [SUBJECT: …] heading.`,
        });
      }
      return;
    }

    if (fragment.orderedDepth > 1 && current) {
      const slot = OPTION_KEYS.find(
        (key) => !current!.options[key] && !current!.images.some((i) => i.target === key),
      );
      if (slot) {
        current.options[slot] = attachImages(current, fragment, slot, text);
        cursor = slot;
        return;
      }
    }

    // --- continuation of whatever we are inside
    if (current && cursor) {
      const marked = attachImages(current, fragment, cursor, text);
      if (marked) {
        if (cursor === "STEM") {
          current.text = `${current.text} ${marked}`.trim();
        } else {
          current.options[cursor] = `${current.options[cursor]} ${marked}`.trim();
        }
      }
      return;
    }

    // --- stray content outside any question
    if (withoutSlots(text) && !current) {
      warnings.push({
        line,
        message: `Ignored text outside any question: “${text.slice(0, 60)}${
          text.length > 60 ? "…" : ""
        }”`,
      });
    }
  });

  flush();

  // Re-index after the fact so indices are contiguous.
  questions.forEach((q, i) => {
    q.index = i;
    q.issues = validateQuestion(q);
  });

  if (autoNumbered > 0) {
    warnings.push({
      line: 0,
      message:
        `${autoNumbered} question${autoNumbered === 1 ? "" : "s"} had no number in the ` +
        "document — Word's automatic list numbering is not saved as text, so they were " +
        "numbered in the order they appear. Check the numbering in the preview below.",
    });
  }

  if (equationsConverted > 0) {
    warnings.push({
      line: 0,
      message:
        `${equationsConverted} Word equation${equationsConverted === 1 ? " was" : "s were"} ` +
        "converted to plain text (for example W/4, x², √(2gh)). Check they read correctly " +
        "below — anything wrong is easier to retype here than in Word.",
    });
  }

  if (equationsEmpty > 0) {
    warnings.push({
      line: 0,
      message:
        `${equationsEmpty} equation${equationsEmpty === 1 ? "" : "s"} held no readable text ` +
        "and could not be converted. Retype those in the preview, or paste them into the " +
        "document as pictures instead.",
    });
  }

  if (questions.length === 0) {
    warnings.push({
      line: 0,
      message:
        "No questions were recognised. Check the document follows the template: a [SUBJECT: …] heading, then numbered questions with A) to D) options.",
    });
  }

  // Duplicate numbers within a subject would collide on the unique index.
  const seen = new Map<string, number>();
  for (const q of questions) {
    const key = `${q.subjectName}#${q.number}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const q of questions) {
    if ((seen.get(`${q.subjectName}#${q.number}`) ?? 0) > 1) {
      q.issues.push(`Question number ${q.number} is used more than once in ${q.subjectName || "this subject"}`);
    }
  }

  return { questions, subjectNames, warnings };
}

function validateQuestion(q: ParsedQuestion): string[] {
  const issues: string[] = [];
  const hasStemImage = q.images.some((i) => i.target === "STEM");

  if (!q.text && !hasStemImage) issues.push("Question text is empty");
  if (!q.subjectName) issues.push("No subject — add a [SUBJECT: …] heading above it");

  for (const key of OPTION_KEYS) {
    const hasImage = q.images.some((i) => i.target === key);
    if (!q.options[key] && !hasImage) issues.push(`Option ${key} is empty`);
  }

  const filled = OPTION_KEYS.map((k) => q.options[k]).filter(Boolean);
  if (new Set(filled).size !== filled.length) {
    issues.push("Two options have identical text");
  }

  return issues;
}
