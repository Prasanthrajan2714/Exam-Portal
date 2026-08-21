import "server-only";
import mammoth from "mammoth";
import { inlineEquations } from "./omml";
import { mapScript, SUBSCRIPTS, SUPERSCRIPTS } from "./text-scripts";
import { saveExamImage } from "./uploads";

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

type Fragment = {
  text: string;
  images: string[];
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
    const images: string[] = [];
    // Image placeholders were injected as <img src="upload:<path>">.
    const withoutImages = rawLine.replace(
      /<img[^>]*src="upload:([^"]+)"[^>]*>/gi,
      (_match, src: string) => {
        images.push(decodeHtml(src));
        return " ";
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

function cleanText(html: string): string {
  const converted = html
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, (_m, inner: string) =>
      mapScript(inner, SUPERSCRIPTS, "^"),
    )
    .replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, (_m, inner: string) =>
      mapScript(inner, SUBSCRIPTS, "_"),
    );
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
          return { src: `upload:${stored}` };
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
        text: questionMatch[2].trim(),
        options: { A: "", B: "", C: "", D: "" },
        images: [],
        issues: [],
      };
      cursor = "STEM";
      lastNumber.set(currentSubject, Number(questionMatch[1]));
      for (const src of fragment.images) {
        current.images.push({ path: src, target: "STEM" });
      }
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
      const key = optionMatch[1].toUpperCase() as OptionKey;
      current.options[key] = optionMatch[2].trim();
      cursor = key;
      for (const src of fragment.images) {
        current.images.push({ path: src, target: key });
      }
      return;
    }

    // --- a question Word numbered for us
    // The number only exists as list formatting, so the list item itself is the
    // signal. Nested items are the options of the item above them, which is how
    // a paper with automatically lettered options is laid out.
    if (fragment.orderedDepth === 1 && text) {
      flush();
      const number = (lastNumber.get(currentSubject) ?? 0) + 1;
      lastNumber.set(currentSubject, number);
      autoNumbered += 1;
      current = {
        index: questions.length,
        subjectName: currentSubject,
        number,
        text,
        options: { A: "", B: "", C: "", D: "" },
        images: [],
        issues: [],
      };
      cursor = "STEM";
      for (const src of fragment.images) {
        current.images.push({ path: src, target: "STEM" });
      }
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
        current.options[slot] = text;
        cursor = slot;
        for (const src of fragment.images) {
          current.images.push({ path: src, target: slot });
        }
        return;
      }
    }

    // --- continuation of whatever we are inside
    if (current && cursor) {
      if (text) {
        if (cursor === "STEM") {
          current.text = `${current.text} ${text}`.trim();
        } else {
          current.options[cursor] = `${current.options[cursor]} ${text}`.trim();
        }
      }
      for (const src of fragment.images) {
        current.images.push({ path: src, target: cursor });
      }
      return;
    }

    // --- stray content outside any question
    if (text && !current) {
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
