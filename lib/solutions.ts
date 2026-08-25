import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { termsForQuestion } from "./glossary";

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
  /** True when a question carries diagrams the model cannot see. */
  hasImages: boolean;
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
    .filter((q) => q.solvedOption !== q.correctOption)
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

For each question:
1. Work it out. Show the reasoning a student needs: the principle or formula, the substitution, the arithmetic. Keep it to the point — a few sentences, or a short sequence of steps.
2. State which option that working arrives at.
3. Say whether you are confident. Set confident to false when the question depends on a diagram you cannot see, is ambiguous, appears to have no correct option among the four, or you are genuinely unsure. A false here is useful; a confident wrong answer is not.

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

function render(q: SolvableQuestion, glossary: string): string {
  return [
    `<question index="${q.index}" subject="${q.subjectName}">`,
    glossary,
    q.hasImages
      ? `Note: this question carries a diagram or formula image you cannot see. If the working depends on it, say so and set confident to false.`
      : "",
    `Question: ${q.text}`,
    `A: ${q.optionA}`,
    `B: ${q.optionB}`,
    `C: ${q.optionC}`,
    `D: ${q.optionD}`,
    `</question>`,
  ]
    .filter(Boolean)
    .join("\n");
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
      return render(q, glossary);
    }),
  );

  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 32000,
    system: system(medium),
    thinking: { type: "adaptive" },
    // Solving is the point; this is not a task to skimp reasoning on.
    output_config: { effort: "high" },
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_solutions" },
    messages: [
      {
        role: "user",
        content: `Solve these ${questions.length} question(s).\n\n${rendered.join("\n\n")}`,
      },
    ],
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
