import Image from "next/image";
import { cn } from "@/lib/utils";

// A PNG with the white field cut away, so the badge sits straight on whatever
// is behind it instead of on a white tile of its own. The JPEG it was made from
// could not carry transparency, which is why the tile existed at all.
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
      src="/logo.png"
      alt="FirstBench"
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      className={cn("shrink-0 object-contain", className)}
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
