/**
 * Working out which slice of a list a page is asking for.
 *
 * Page and page-size arrive from the URL, so they are whatever someone typed
 * there: a page past the end, a size nobody offered, a word. Everything is
 * clamped to something that can actually be shown — a list that reports "page 7
 * of 3" and displays nothing is worse than one that shows the last page.
 */

/** The sizes offered. Anything else in the URL falls back to the default. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 20;

export type Page = {
  page: number;
  perPage: number;
  totalPages: number;
  /** For the query. */
  skip: number;
  take: number;
  /** 1-based positions of the first and last row shown; 0 when there are none. */
  from: number;
  to: number;
  total: number;
};

function readInt(value: unknown): number | null {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) ? parsed : null;
}

export function resolvePage(total: number, page: unknown, perPage: unknown): Page {
  const size = readInt(perPage);
  const chosen =
    size !== null && (PAGE_SIZES as readonly number[]).includes(size)
      ? size
      : DEFAULT_PAGE_SIZE;

  const rows = Math.max(0, Math.trunc(total));
  // One page even when empty, so "page 1 of 1" reads sensibly against no rows.
  const totalPages = Math.max(1, Math.ceil(rows / chosen));

  const asked = readInt(page) ?? 1;
  const current = Math.min(Math.max(1, asked), totalPages);

  const skip = (current - 1) * chosen;
  return {
    page: current,
    perPage: chosen,
    totalPages,
    skip,
    take: chosen,
    from: rows === 0 ? 0 : skip + 1,
    to: Math.min(skip + chosen, rows),
    total: rows,
  };
}

/**
 * The page numbers to offer, with nulls where a run was left out.
 *
 * Always the first and last, and a window around the current one, so a hundred
 * pages do not become a hundred links.
 */
export function pageWindow(page: number, totalPages: number, span = 1): (number | null)[] {
  const wanted = new Set<number>([1, totalPages]);
  for (let i = page - span; i <= page + span; i++) {
    if (i >= 1 && i <= totalPages) wanted.add(i);
  }

  const numbers = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let previous = 0;
  for (const number of numbers) {
    if (previous && number - previous > 1) out.push(null);
    out.push(number);
    previous = number;
  }
  return out;
}
