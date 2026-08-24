import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { type GlossaryEntry, termsForQuestion } from "./glossary";

/**
 * Tamil translation for question papers.
 *
 * The board's terminology is not negotiable, so the glossary terms found in a
 * question are pinned in the prompt and the model is told to use them verbatim.
 * Everything around them — the sentence, the instruction, the distractors — is
 * ordinary translation. Numbers, symbols and formulae are left alone, because a
 * "translated" equation is a broken one.
 */

export type TranslatableQuestion = {
  /** Position in the paper, echoed back so results can be reattached. */
  index: number;
  subjectName: string;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
};

export type TranslatedQuestion = {
  index: number;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  /** The glossary terms pinned for this question, for the admin's review. */
  termsUsed: { term: string; tamil: string }[];
};

export class TranslationConfigError extends Error {}

export function translationConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const SYSTEM = `You translate multiple-choice examination questions from English into Tamil for a school examination board.

Rules, in order of priority:

1. TERMINOLOGY IS FIXED. Each question comes with a list of approved term translations. Where the English contains one of those terms, you must use the approved Tamil exactly as given. Do not substitute a synonym, do not re-inflect it beyond what Tamil grammar requires to fit the sentence, and do not translate it yourself.
2. LEAVE THE MATHEMATICS ALONE. Numbers, digits, variables, units, symbols, equations, chemical formulae and option letters stay exactly as they are. "9.8 m/s²" stays "9.8 m/s²". Never convert digits to Tamil numerals.
3. TRANSLATE EVERYTHING ELSE NATURALLY. The stem and the options should read as a Tamil examination paper, not as word-for-word English.
4. PRESERVE MEANING PRECISELY. These are graded questions: a distractor that becomes correct, or a negation that is dropped, makes the paper wrong. Keep "not", "except", "incorrect" and similar exactly as forceful as in the English.
5. DO NOT ANSWER, EXPLAIN OR RENUMBER. Translate only. Keep the four options in their original order — option A must remain option A.

Return only the translation, through the provided tool.`;

const TOOL: Anthropic.Tool = {
  name: "record_translation",
  description: "Record the Tamil translation of the questions.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number", description: "The index given in the input." },
            text: { type: "string", description: "The question stem in Tamil." },
            optionA: { type: "string" },
            optionB: { type: "string" },
            optionC: { type: "string" },
            optionD: { type: "string" },
          },
          required: ["index", "text", "optionA", "optionB", "optionC", "optionD"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  strict: true,
};

function renderQuestion(q: TranslatableQuestion, terms: GlossaryEntry[]): string {
  const glossary = terms.length
    ? terms.map((t) => `  - "${t.term}" -> ${t.tamil}`).join("\n")
    : "  (no approved terms found in this question)";
  return [
    `<question index="${q.index}" subject="${q.subjectName}">`,
    `Approved terminology (use these exactly):`,
    glossary,
    `Stem: ${q.text}`,
    `A: ${q.optionA}`,
    `B: ${q.optionB}`,
    `C: ${q.optionC}`,
    `D: ${q.optionD}`,
    `</question>`,
  ].join("\n");
}

/**
 * Translates a batch of questions. Batched rather than one call per question:
 * a paper is 30–180 questions, and the per-request overhead dominates at that
 * size. Kept small enough that one bad batch does not lose the whole paper.
 */
export async function translateBatch(
  questions: TranslatableQuestion[],
): Promise<TranslatedQuestion[]> {
  if (questions.length === 0) return [];
  if (!translationConfigured()) {
    throw new TranslationConfigError(
      "Tamil translation needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env and restart the server.",
    );
  }

  const client = new Anthropic();

  const withTerms = await Promise.all(
    questions.map(async (q) => ({
      question: q,
      terms: await termsForQuestion(q.subjectName, [
        q.text,
        q.optionA,
        q.optionB,
        q.optionC,
        q.optionD,
      ]),
    })),
  );

  const prompt = withTerms
    .map(({ question, terms }) => renderQuestion(question, terms))
    .join("\n\n");

  // Streamed: a full paper's worth of Tamil is well past the point where a
  // non-streaming request risks an HTTP timeout.
  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 32000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_translation" },
    messages: [
      {
        role: "user",
        content: `Translate these ${questions.length} question(s) into Tamil.\n\n${prompt}`,
      },
    ],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The translation request was declined. Check the paper for anything unexpected and try again.",
    );
  }

  const call = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "record_translation",
  );
  if (!call) throw new Error("The model returned no translation.");

  const payload = call.input as { questions?: TranslatedQuestion[] };
  const byIndex = new Map(
    (payload.questions ?? []).map((q) => [Number(q.index), q]),
  );

  return withTerms.map(({ question, terms }) => {
    const got = byIndex.get(question.index);
    if (!got) {
      throw new Error(
        `The translation came back missing question ${question.index + 1}.`,
      );
    }
    return {
      index: question.index,
      text: String(got.text ?? ""),
      optionA: String(got.optionA ?? ""),
      optionB: String(got.optionB ?? ""),
      optionC: String(got.optionC ?? ""),
      optionD: String(got.optionD ?? ""),
      termsUsed: terms.map((t) => ({ term: t.term, tamil: t.tamil })),
    };
  });
}
