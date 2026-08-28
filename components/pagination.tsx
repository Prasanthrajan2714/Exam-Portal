import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PAGE_SIZES, pageWindow, type Page } from "@/lib/pagination";
import { cn } from "@/lib/utils";

/**
 * Page links and a page-size choice, both as plain links.
 *
 * Everything lives in the URL, so a page of a filtered list can be bookmarked,
 * shared or reloaded and comes back the same — and the page it sits on stays a
 * server component.
 */
export function Pagination({
  page,
  params,
  label = "rows",
}: {
  page: Page;
  /** The filters in force, carried through every link. */
  params: Record<string, string | undefined>;
  label?: string;
}) {
  const href = (next: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...next })) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    const search = query.toString();
    return search ? `?${search}` : "?";
  };

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {page.total === 0
          ? `No ${label}`
          : `Showing ${page.from}–${page.to} of ${page.total} ${label}`}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>Show</span>
          {PAGE_SIZES.map((size) => (
            <Link
              key={size}
              // Back to the first page: staying on page 7 while the size changes
              // lands somewhere unrelated to what was being read.
              href={href({ perPage: size, page: 1 })}
              className={cn(
                "rounded px-1.5 py-0.5 tabular-nums transition-colors",
                size === page.perPage
                  ? "bg-primary-soft font-semibold text-primary-ink"
                  : "hover:bg-surface-muted hover:text-foreground",
              )}
            >
              {size}
            </Link>
          ))}
        </div>

        {page.totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              asChild={page.page > 1}
              variant="ghost"
              size="sm"
              disabled={page.page === 1}
            >
              {page.page > 1 ? (
                <Link href={href({ page: page.page - 1 })}>Previous</Link>
              ) : (
                <span>Previous</span>
              )}
            </Button>

            {pageWindow(page.page, page.totalPages).map((number, i) =>
              number === null ? (
                <span key={`gap${i}`} className="px-1 text-muted-foreground">
                  …
                </span>
              ) : (
                <Link
                  key={number}
                  href={href({ page: number })}
                  aria-current={number === page.page ? "page" : undefined}
                  className={cn(
                    "min-w-8 rounded-[var(--radius-app)] px-2 py-1 text-center text-sm tabular-nums transition-colors",
                    number === page.page
                      ? "bg-primary font-semibold text-primary-foreground"
                      : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  {number}
                </Link>
              ),
            )}

            <Button
              asChild={page.page < page.totalPages}
              variant="ghost"
              size="sm"
              disabled={page.page === page.totalPages}
            >
              {page.page < page.totalPages ? (
                <Link href={href({ page: page.page + 1 })}>Next</Link>
              ) : (
                <span>Next</span>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
