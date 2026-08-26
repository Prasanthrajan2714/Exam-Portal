import { QuestionImage, type QuestionImageSource } from "@/components/question-image";
import { layoutQuestion } from "@/lib/question-layout";
import { cn } from "@/lib/utils";

/**
 * A question or option, with its images where the document put them.
 *
 * The placement rule lives in `layoutQuestion`; this only draws the result. An
 * equation set mid-sentence is rendered inline with the words around it, because
 * that is what it is — not a figure that deserves a line of its own.
 */

export type PlacedImage = QuestionImageSource & { id: string; order: number };

export function QuestionText({
  text,
  images,
  alt,
  fallbackWidth,
  fallbackHeight,
  className,
}: {
  text: string;
  /** The images belonging to this part of the question. */
  images: PlacedImage[];
  alt: string;
  fallbackWidth: number;
  fallbackHeight: number;
  className?: string;
}) {
  const byOrder = new Map(images.map((i) => [i.order, i]));
  const parts = layoutQuestion(
    text,
    images.map((i) => i.order),
  );

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {parts.map((part, i) => {
        if (part.kind === "text") return <span key={`t${i}`}>{part.value}</span>;

        const image = byOrder.get(part.order);
        if (!image) return null;
        return (
          <QuestionImage
            key={image.id}
            image={image}
            alt={alt}
            fallbackWidth={fallbackWidth}
            fallbackHeight={fallbackHeight}
            className="mx-1 inline-block align-middle"
          />
        );
      })}
    </span>
  );
}
