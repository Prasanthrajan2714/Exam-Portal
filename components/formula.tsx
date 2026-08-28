import { MathText } from "@/components/math-text";
import { parseFormula } from "@/lib/formula";
import { cn } from "@/lib/utils";

/**
 * A worked solution: fractions stacked, subscripts and superscripts set as such.
 *
 * The two passes are ordered. Fractions are found first, because the rule reads
 * whole operands and `x_1/y_1` has to be seen as two of them; the script markup
 * is then read within each piece of text that survives.
 *
 * `sub` and `sup` are styled rather than left to the browser: the default
 * `vertical-align` grows the line box, so a paragraph with a few subscripts in
 * it ends up with visibly uneven leading. Shifting them by a relative offset
 * keeps every line the same height.
 */
export function Formula({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      <MathText text={text} renderLeaf={scripted} />
    </span>
  );
}

function scripted(value: string, key: string): React.ReactNode {
  return (
    <span key={key}>
      {parseFormula(value).map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
        return (
          <span
            key={i}
            className={cn(
              "relative align-baseline text-[0.72em] leading-none",
              seg.kind === "sub" ? "-bottom-[0.22em]" : "-top-[0.42em]",
            )}
          >
            {seg.value}
          </span>
        );
      })}
    </span>
  );
}
