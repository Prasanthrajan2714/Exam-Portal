import Image from "next/image";
import { cn } from "@/lib/utils";

// The logo is a square JPEG with a white field, so it always sits on a white
// tile — on the dark theme the tile is what keeps the black wordmark readable.
export function BrandMark({
  className,
  size = 32,
  eager = false,
}: {
  className?: string;
  size?: number;
  eager?: boolean;
}) {
  return (
    <Image
      src="/logo.jpeg"
      alt="FirstBench"
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      className={cn(
        "shrink-0 rounded-lg bg-white object-contain ring-1 ring-border",
        className,
      )}
    />
  );
}

// Logo + wordmark. Used in the sidebar, the mobile header and the exam runner
// so every screen carries the same lockup.
export function BrandLockup({
  size = 32,
  label = "FirstBench Exams",
  className,
  eager = false,
}: {
  size?: number;
  label?: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark size={size} eager={eager} />
      <span className="truncate text-sm font-semibold tracking-tight">
        {label}
      </span>
    </span>
  );
}
