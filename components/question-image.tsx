import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * A picture pulled out of an uploaded Word document, shown at the size the
 * document lays it out at.
 *
 * Word writes Equation Editor formulae as metafiles and places them inline at
 * text height — 152 x 24 CSS pixels is typical — while a stem diagram might be
 * 400 x 300. Both reach us through the same rasteriser, so the document's own
 * size is the only thing that tells them apart: rendering everything at a fixed
 * cap is what made a one-symbol equation fill the option it belonged to.
 *
 * Images stored before that size was recorded have none, and neither does a
 * plain photograph pasted into the document, so those keep the older capped
 * behaviour rather than being laid out at a guessed size.
 */
export type QuestionImageSource = {
  path: string;
  width?: number | null;
  height?: number | null;
};

export function QuestionImage({
  image,
  alt,
  fallbackWidth,
  fallbackHeight,
  className,
}: {
  image: QuestionImageSource;
  alt: string;
  /** Used only when the document did not record a size. */
  fallbackWidth: number;
  fallbackHeight: number;
  className?: string;
}) {
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const sized = width > 0 && height > 0;

  return (
    <Image
      src={`/api/uploads/${image.path}`}
      alt={alt}
      width={sized ? width : fallbackWidth}
      height={sized ? height : fallbackHeight}
      unoptimized
      className={cn("rounded border border-border bg-white object-contain", className)}
      // max-width keeps a wide diagram inside a phone screen instead of pushing
      // the question off the side of it.
      style={
        sized
          ? { width, height: "auto", maxWidth: "100%" }
          : { maxHeight: fallbackHeight, width: "auto", maxWidth: "100%" }
      }
    />
  );
}
