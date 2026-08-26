/**
 * Where a question's images sit within its text.
 *
 * A maths paper writes the relation itself as an equation image in the middle of
 * a sentence — "The common tangent to the circles [x²+y²=4 and …] also passes
 * through the point:". The parser leaves a `[[#n]]` marker at that spot, where n
 * is the image's `order`, and this says how to lay the two back out together.
 *
 * A rule rather than logic inside the component, so it can be tested against the
 * cases that matter without rendering anything.
 */

export type QuestionPart =
  | { kind: "text"; value: string }
  | { kind: "image"; order: number };

const MARKER_RE = /\[\[#(\d+)\]\]/g;

export function layoutQuestion(text: string, orders: number[]): QuestionPart[] {
  const have = new Set(orders);
  const used = new Set<number>();
  const parts: QuestionPart[] = [];
  let last = 0;

  for (const match of text.matchAll(MARKER_RE)) {
    const order = Number(match[1]);
    const at = match.index ?? 0;

    if (at > last) parts.push({ kind: "text", value: text.slice(last, at) });
    last = at + match[0].length;

    // A marker with no image behind it is dropped rather than shown: a student
    // must never read a literal "[[#3]]".
    if (!have.has(order)) continue;
    used.add(order);
    parts.push({ kind: "image", order });
  }

  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });

  // Anything the markers did not account for goes after the text. That covers
  // every question stored before markers existed, and one whose text an admin
  // has edited past its markers — neither may lose a diagram silently.
  for (const order of orders) {
    if (!used.has(order)) parts.push({ kind: "image", order });
  }

  return parts;
}

/** The text alone, for anywhere an image cannot be shown. */
export function questionPlainText(text: string): string {
  return text.replace(MARKER_RE, " ").replace(/\s+/g, " ").trim();
}
