import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Subject glossaries for Tamil papers.
 *
 * The files are large — Biology alone is ~10,000 entries — so they are never
 * handed to the model wholesale. Each question is scanned for the terms it
 * actually contains, and only those are pinned in the prompt. That keeps the
 * request small and, more importantly, keeps the model from inventing its own
 * rendering of a term the board has already settled on.
 */

export type GlossaryEntry = {
  /** The English term as written in the glossary, e.g. "acute angle". */
  term: string;
  /** The Tamil the board uses for it. */
  tamil: string;
  /** "coinage", "loanword", … — carried through for the prompt's benefit. */
  kind: string;
};

/** Subject name (as stored in the Subject table) -> glossary file. */
const FILE_BY_SUBJECT: Record<string, string> = {
  mathematics: "Tamil-MATH.md",
  maths: "Tamil-MATH.md",
  math: "Tamil-MATH.md",
  physics: "Tamil-PHY.md",
  chemistry: "Tamil-CHE.md",
  biology: "Tamil-BIO.md",
};

export function glossaryFileFor(subject: string): string | null {
  return FILE_BY_SUBJECT[subject.trim().toLowerCase()] ?? null;
}

export function glossaryRoot(): string {
  // turbopackIgnore: the directory is data, not modules — tracing it would pull
  // 1.7 MB of markdown into the server bundle.
  return path.resolve(
    /* turbopackIgnore: true */ process.env.GLOSSARY_DIR ?? "./Glossary",
  );
}

/** Rows look like `| english term | தமிழ் | kind |`. */
function parseGlossary(markdown: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const [term, tamil, kind = ""] = cells;
    // Skip the header and its `| --- |` separator.
    if (!term || !tamil) continue;
    if (/^-+$/.test(term) || term.toLowerCase() === "english term (sense)") continue;
    entries.push({ term, tamil, kind });
  }
  return entries;
}

const cache = new Map<string, GlossaryEntry[]>();

/**
 * Loads one subject's glossary. Cached per process: the files never change at
 * runtime and re-reading 800 KB per question would dominate the request.
 */
export async function loadGlossary(subject: string): Promise<GlossaryEntry[]> {
  const file = glossaryFileFor(subject);
  if (!file) return [];
  const cached = cache.get(file);
  if (cached) return cached;

  let markdown: string;
  try {
    markdown = await fs.readFile(path.join(glossaryRoot(), file), "utf8");
  } catch {
    // A missing glossary must not stop a paper being translated — the model
    // still translates, just without the board's pinned terms.
    cache.set(file, []);
    return [];
  }

  const entries = parseGlossary(markdown);
  cache.set(file, entries);
  return entries;
}

/**
 * Ordinary English words that also exist as glossary entries. Physics lists
 * "NOT", "AND" and "OR" as logic operators and "on" as a closed switch;
 * Chemistry lists "one". In a sentence they are just English, and pinning them
 * actively damages the translation — a paper asking which unit is "NOT" energy
 * came back with a literal "(NOT)" spliced into the Tamil.
 *
 * The logic operators are safe to drop because the real thing is a longer entry
 * — "NOT gate", "AND gate", "OR gate" — which still matches when a question is
 * genuinely about gates. Terms that are technical in their own right, like the
 * mathematical "set", are deliberately not listed here.
 */
const STOPWORDS = new Set([
  "not",
  "and",
  "or",
  "on",
  "one",
  "two",
  "if",
  "then",
  "is",
  "are",
  "the",
  "of",
  "to",
  "in",
  "at",
  "as",
  "by",
  "for",
  "no",
  "so",
  "do",
  "be",
  "all",
  "any",
  "can",
  "may",
]);

/** Terms are matched on word boundaries so "arc" does not fire inside "search". */
function boundaryAt(haystack: string, index: number, length: number): boolean {
  const before = index === 0 ? "" : haystack[index - 1];
  const after = haystack[index + length] ?? "";
  const isWord = (c: string) => /[a-z0-9]/i.test(c);
  return !isWord(before) && !isWord(after);
}

/**
 * Some entries are written as alternatives — "absolute value function or
 * modulus function". A paper says one of them, never the whole string, so each
 * side has to be searchable on its own.
 */
function searchAliases(term: string): string[] {
  if (!/ or /i.test(term)) return [term];
  const parts = term
    .split(/ or /i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  return parts.length > 1 ? parts : [term];
}

/**
 * The glossary entries that actually appear in this text.
 *
 * Longest first. A term is dropped only when the text it matched sits entirely
 * inside a longer match — "absolute value" should not be offered alongside
 * "absolute value function", because handing the model both invites it to
 * translate the phrase twice. Terms that merely overlap are both kept: "acute
 * angle" and "angle between the lines" share a word but are different terms,
 * and the model needs each of them.
 */
export function matchTerms(text: string, entries: GlossaryEntry[]): GlossaryEntry[] {
  if (!text.trim()) return [];
  const haystack = text.toLowerCase();

  type Span = { start: number; end: number; entry: GlossaryEntry };
  const spans: Span[] = [];

  for (const entry of entries) {
    if (STOPWORDS.has(entry.term.trim().toLowerCase())) continue;
    for (const alias of searchAliases(entry.term)) {
      const needle = alias.toLowerCase();
      if (needle.length < 3) continue; // single letters match everywhere
      let from = 0;
      for (;;) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) break;
        from = at + 1;
        if (!boundaryAt(haystack, at, needle.length)) continue;
        spans.push({ start: at, end: at + needle.length, entry });
        break; // one mapping per term is enough for the prompt
      }
    }
  }

  spans.sort((a, b) => b.end - b.start - (a.end - a.start));

  const kept: Span[] = [];
  const seen = new Set<string>();
  for (const span of spans) {
    const contained = kept.some((k) => span.start >= k.start && span.end <= k.end);
    if (contained) continue;
    if (seen.has(span.entry.term)) continue;
    seen.add(span.entry.term);
    kept.push(span);
  }

  // Back into reading order, so the prompt lists terms as they appear.
  kept.sort((a, b) => a.start - b.start);
  return kept.map((k) => k.entry);
}

/** Every term appearing anywhere in a question and its four options. */
export async function termsForQuestion(
  subject: string,
  parts: string[],
): Promise<GlossaryEntry[]> {
  const entries = await loadGlossary(subject);
  if (entries.length === 0) return [];
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const part of parts) {
    for (const match of matchTerms(part, entries)) {
      if (seen.has(match.term)) continue;
      seen.add(match.term);
      out.push(match);
    }
  }
  return out;
}
