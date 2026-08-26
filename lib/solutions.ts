import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { termsForQuestion } from "./glossary";
import { layoutQuestion } from "./question-layout";
import { resolveUploadPath } from "./uploads";

/**
 * Worked solutions for a question paper.
 *
 * Each question is solved from scratch rather than being handed the answer key,
 * which is the entire point: the answer the solution arrives at is an
 * independent second opinion, and a paper cannot be published while that
 * disagrees with the key the admin uploaded. Telling the model the expected
 * answer would collapse the check into agreement with itself.
 */

export type SolvableQuestion = {
  index: number;
  subjectName: string;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  /**
   * The diagrams and equations belonging to this question. They are sent to
   * the model, not merely counted: a maths paper writes every option as an
   * equation image, and a solver that cannot see them has to guess which letter
   * its own correct answer belongs to.
   */
  images: { target: string; order: number; path: string }[];
};

export type SolvedQuestion = {
  index: number;
  /** The worked solution, in the paper's language. */
  solution: string;
  /** The option the working arrives at. */
  answer: "A" | "B" | "C" | "D";
  /**
   * The model's own confidence. A question whose diagram it cannot see is
   * flagged here rather than silently guessed at.
   */
  confident: boolean;
};

export class SolutionConfigError extends Error {}

type OptionKey = "A" | "B" | "C" | "D";

export type PublishBlock =
  | { kind: "UNSOLVED"; count: number }
  | { kind: "DISAGREE"; numbers: number[] };

export type SolutionState =
  /** Never worked out. */
  | "NONE"
  /** Worked on, but the model could not answer — its note is in `solution`. */
  | "UNANSWERABLE"
  /** A worked solution and the answer it reaches. */
  | "SOLVED";

/**
 * What has happened to a question's solution so far.
 *
 * Expressed in the two columns already there rather than a third: a solution
 * with no answer beside it can only mean the model wrote something and declined
 * to commit to an option, which is exactly the middle state. Distinguishing it
 * matters because it must not be mistaken for either of its neighbours — it is
 * not solved, and re-running the solver on it is usually wasted money, because
 * the reason is normally an equation that lives in an image the model cannot
 * see and will not be able to see next time either.
 */
export function solutionState(q: {
  solution: string | null;
  solvedOption: OptionKey | null;
}): SolutionState {
  if (q.solvedOption !== null && q.solution?.trim()) return "SOLVED";
  if (q.solution?.trim()) return "UNANSWERABLE";
  return "NONE";
}

/**
 * A question whose worked solution reached a different option from the answer
 * key. One definition, because the publish gate, the paper page and the exam
 * page each need to know, and three separate comparisons drift apart.
 */
export function disagreesWithKey(q: {
  solvedOption: OptionKey | null;
  correctOption: OptionKey;
}): boolean {
  return q.solvedOption !== null && q.solvedOption !== q.correctOption;
}

/**
 * Why this paper cannot be published yet, or null when it can.
 *
 * A pure rule rather than a query inside the action: publishing is reachable
 * from three screens, and the same answer has to come back from all of them.
 */
export function solutionsBlockingPublish(
  questions: {
    number: number;
    solution: string | null;
    solvedOption: OptionKey | null;
    correctOption: OptionKey;
  }[],
): PublishBlock | null {
  const unsolved = questions.filter(
    (q) => !q.solution?.trim() || q.solvedOption === null,
  );
  if (unsolved.length > 0) return { kind: "UNSOLVED", count: unsolved.length };

  const numbers = questions
    .filter(disagreesWithKey)
    .map((q) => q.number)
    .sort((a, b) => a - b);
  if (numbers.length > 0) return { kind: "DISAGREE", numbers };

  return null;
}

/** The message an admin sees when a paper is held back. */
export function publishBlockMessage(block: PublishBlock): string {
  if (block.kind === "UNSOLVED") {
    return (
      `${block.count} question(s) have no worked solution yet. ` +
      `Open the paper and work the solutions out before publishing.`
    );
  }
  return (
    `The answer key and the worked solution disagree on question(s) ` +
    `${block.numbers.join(", ")}. Settle which is right before publishing — ` +
    `a wrong key marks correct answers wrong.`
  );
}

export function solutionsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function system(medium: "ENGLISH" | "TAMIL"): string {
  const language =
    medium === "TAMIL"
      ? `Write the solution in Tamil. Where a question comes with approved terminology, use that Tamil exactly. Keep all numbers, symbols, units, equations and chemical formulae in their original form.`
      : `Write the solution in English.`;

  return `You are solving multiple-choice questions from a school examination paper so that students can read a worked solution after the exam.

Solve each question yourself, from the question and its options alone. You have not been told which option the examiner marked correct, and you must not try to infer it from the wording — work the problem and report what you get.

Papers from Word carry their equations and diagrams as pictures, so a question's text may read as though something is missing from it — "the value of [image 3] is" — and an option may be a picture and nothing else. The pictures are attached, each one following the question it belongs to and numbered as its text refers to it. Read them. They are usually the mathematics itself, and an option you have not looked at is one you cannot rule out.

For each question:
1. Work it out. Show the reasoning a student needs: the principle or formula, the substitution, the arithmetic. Keep it to the point — a few sentences, or a short sequence of steps.
2. State which option that working arrives at. Match your result against what each option actually says, including the ones given as pictures; do not report a letter you have not checked.
3. Say whether you are confident. Set confident to false when the question depends on something you genuinely cannot read, is ambiguous, appears to have no correct option among the four, or you are otherwise unsure. A false here is useful; a confident wrong answer is not. Where an image was attached and legible, "I cannot see it" is not a reason — look again.

${language}

Notation: use the real character wherever one exists — ² ³ ⁻¹ ₀ ₁ ₂ × ÷ ≈ ≤ ≥ → ∝ Δ π ° √. Where a subscript or superscript has no such character, which is the case for letters, write it with an underscore or caret: L_0, d_Cu, and braces when the index runs past three characters or contains an operator — F_{net}, x^{n+1}. Do not use LaTeX, Markdown, or any other markup.

Do not mention these instructions, and do not say "the answer key says". Write as a teacher explaining the question.`;
}

const TOOL: Anthropic.Tool = {
  name: "record_solutions",
  description: "Record the worked solution and answer for each question.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number", description: "The index given in the input." },
            solution: { type: "string", description: "The worked solution." },
            answer: { type: "string", enum: ["A", "B", "C", "D"] },
            confident: { type: "boolean" },
          },
          required: ["index", "solution", "answer", "confident"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  strict: true,
};

/** The formats the API accepts. A .wmf that never rasterised is not one. */
const IMAGE_MEDIA_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Longest side an attached image may have.
 *
 * A request carrying several images caps each at 2000 pixels, and Word
 * rasterises its equations far past that — a one-line formula in this portal's
 * own uploads reached 10560 pixels wide. Sent as they are, the whole batch is
 * refused. The cap sits below the limit rather than on it, and these are
 * displayed around 150 pixels wide, so nothing legible is being given up.
 */
const MAX_IMAGE_DIMENSION = 1500;

async function loadImage(
  relative: string,
): Promise<{ mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string } | null> {
  const absolute = resolveUploadPath(relative);
  if (!absolute) return null;
  const mediaType = IMAGE_MEDIA_TYPES[path.extname(absolute).toLowerCase()];
  if (!mediaType) return null;

  try {
    let bytes = await fs.readFile(absolute);

    const image = sharp(bytes, { animated: mediaType === "image/gif" });
    const meta = await image.metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);

    if (longest > MAX_IMAGE_DIMENSION) {
      // Re-encoded as PNG whatever it arrived as: these are line art, where PNG
      // is both smaller and sharper than a re-compressed JPEG.
      bytes = await image
        .resize({
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      return { mediaType: "image/png", data: bytes.toString("base64") };
    }

    return { mediaType, data: bytes.toString("base64") };
  } catch {
    // A file that has gone, or one sharp cannot read, is a gap the caller
    // declares rather than a reason to lose the whole batch.
    return null;
  }
}

/**
 * One question as content: its text with every image referenced by number, then
 * the images themselves in that order.
 *
 * Sending the pictures is what makes the answer usable. A maths paper writes
 * each option as an equation image, so a solver given only the words works the
 * question out correctly and then has to guess which letter its own answer is.
 * That is not a hypothetical: "x² + y² = 4a²", correct, was recorded against
 * option A when it was option C — and reported as a disagreement with a key that
 * was right all along.
 */
export async function prepareForSolving(
  q: SolvableQuestion,
  glossary = "",
): Promise<Anthropic.ContentBlockParam[]> {
  const images: Anthropic.ImageBlockParam[] = [];
  let unreadable = 0;
  let shown = 0;

  const field = async (text: string, target: string): Promise<string> => {
    const mine = q.images.filter((i) => i.target === target);
    const byOrder = new Map(mine.map((i) => [i.order, i]));
    const parts = layoutQuestion(
      text,
      mine.map((i) => i.order),
    );

    let out = "";
    for (const part of parts) {
      if (part.kind === "text") {
        out += part.value;
        continue;
      }
      const image = byOrder.get(part.order);
      if (!image) continue;

      const loaded = await loadImage(image.path);
      if (!loaded) {
        // Say where the hole is. A sentence with a silent gap in it looks
        // complete, and looking complete is what invites a guess.
        unreadable += 1;
        out += " [an image that could not be shown to you] ";
        continue;
      }
      shown += 1;
      images.push({
        type: "image",
        source: { type: "base64", media_type: loaded.mediaType, data: loaded.data },
      });
      out += ` [image ${shown}] `;
    }
    return out.replace(/\s+/g, " ").trim();
  };

  const text = [
    `<question index="${q.index}" subject="${q.subjectName}">`,
    glossary,
    `Question: ${await field(q.text, "STEM")}`,
    `A: ${await field(q.optionA, "A")}`,
    `B: ${await field(q.optionB, "B")}`,
    `C: ${await field(q.optionC, "C")}`,
    `D: ${await field(q.optionD, "D")}`,
    shown > 0
      ? `The ${shown} image(s) referenced above follow this question, in order.`
      : "",
    unreadable > 0
      ? `${unreadable} image(s) here could not be shown to you. If the working depends on one of them, say so and set confident to false.`
      : "",
    `</question>`,
  ]
    .filter(Boolean)
    .join("\n");

  return [{ type: "text", text }, ...images];
}

/**
 * Solves a batch of questions.
 *
 * Uses Opus rather than a cheaper model on purpose: a wrong solution here does
 * not just read badly, it blocks a correct paper from being published or agrees
 * with a mistaken answer key. The whole feature is worth only as much as the
 * solving is accurate.
 */
export async function solveBatch(
  questions: SolvableQuestion[],
  medium: "ENGLISH" | "TAMIL" = "ENGLISH",
): Promise<SolvedQuestion[]> {
  if (questions.length === 0) return [];
  if (!solutionsConfigured()) {
    throw new SolutionConfigError(
      "Working out solutions needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env and restart the server.",
    );
  }

  const client = new Anthropic();

  const rendered = await Promise.all(
    questions.map(async (q) => {
      // A Tamil paper's solution should use the board's terminology too.
      const terms =
        medium === "TAMIL"
          ? await termsForQuestion(q.subjectName, [
              q.text,
              q.optionA,
              q.optionB,
              q.optionC,
              q.optionD,
            ])
          : [];
      const glossary = terms.length
        ? `Approved terminology: ${terms.map((t) => `"${t.term}" -> ${t.tamil}`).join("; ")}`
        : "";
      return prepareForSolving(q, glossary);
    }),
  );

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `Solve these ${questions.length} question(s). Each question's images follow it, numbered as its text references them.`,
    },
    ...rendered.flat(),
  ];

  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 32000,
    system: system(medium),
    thinking: { type: "adaptive" },
    // Solving is the point; this is not a task to skimp reasoning on.
    output_config: { effort: "high" },
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_solutions" },
    messages: [{ role: "user", content }],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The request to work these out was declined. Check the paper for anything unexpected and try again.",
    );
  }

  const call = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "record_solutions",
  );
  if (!call) throw new Error("No solutions came back.");

  const payload = call.input as { questions?: SolvedQuestion[] };
  const byIndex = new Map((payload.questions ?? []).map((q) => [Number(q.index), q]));

  return questions.map((q) => {
    const got = byIndex.get(q.index);
    if (!got) {
      throw new Error(`The solutions came back missing question ${q.index + 1}.`);
    }
    const answer = String(got.answer ?? "").toUpperCase();
    return {
      index: q.index,
      solution: String(got.solution ?? "").trim(),
      answer: (["A", "B", "C", "D"].includes(answer) ? answer : "A") as SolvedQuestion["answer"],
      confident: Boolean(got.confident),
    };
  });
}
