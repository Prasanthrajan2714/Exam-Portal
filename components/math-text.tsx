import { parseFractions, type MathPart } from "@/lib/fraction";

/**
 * Draws a line of question text with its fractions stacked.
 *
 * Nothing is stored differently: the text remains `2/(π+5)` in the database,
 * in the textarea an admin types into, and in an Excel export. This is a reading
 * of it, and the rule for what counts as a fraction lives in `lib/fraction.ts`.
 *
 * `renderLeaf` is how the two callers differ. A worked solution's text also
 * carries `_` and `^` script markup, so `Formula` hands its leaves on to the
 * script parser; question text has none and passes them straight through.
 */
export function MathText({
  text,
  renderLeaf,
}: {
  text: string;
  renderLeaf?: (value: string, key: string) => React.ReactNode;
}) {
  const leaf = renderLeaf ?? ((value: string, key: string) => <span key={key}>{value}</span>);
  return <>{renderParts(parseFractions(text), leaf, "f")}</>;
}

function renderParts(
  parts: MathPart[],
  leaf: (value: string, key: string) => React.ReactNode,
  prefix: string,
): React.ReactNode[] {
  return parts.map((part, i) => {
    const key = `${prefix}-${i}`;
    if (part.kind === "text") return leaf(part.value, key);

    return (
      <span
        key={key}
        // Sits on the line where the slash used to, and no taller than it has
        // to be: a stacked fraction in the middle of a sentence should not push
        // the lines around it apart.
        className="mx-0.5 inline-flex flex-col items-center align-middle leading-tight"
      >
        <span className="px-1">{renderParts(part.numerator, leaf, `${key}n`)}</span>
        {/* Read aloud, the two halves would otherwise run together as one
            number with nothing between them. */}
        <span className="sr-only"> over </span>
        {/*
          A filled block, not a border. app/globals.css carries an unlayered
          `* { border-color: var(--border) }`, and unlayered CSS outranks
          Tailwind's utility layer — so every border-colour utility in this app
          is silently overridden and a border-t rule would come out the pale
          grey of a card edge instead of the colour of the text.
        */}
        <span aria-hidden className="h-px w-full bg-current" />
        <span className="px-1">{renderParts(part.denominator, leaf, `${key}d`)}</span>
      </span>
    );
  });
}
