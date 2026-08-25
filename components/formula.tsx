import { parseFormula } from "@/lib/formula";
import { cn } from "@/lib/utils";

/**
 * A worked solution, with its subscripts and superscripts set as such.
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
      {parseFormula(text).map((seg, i) => {
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
