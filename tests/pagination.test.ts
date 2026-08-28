import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  pageWindow,
  resolvePage,
} from "@/lib/pagination";

/**
 * Which slice of a list a page is asking for.
 *
 * Both numbers come out of the URL, so they are whatever somebody typed there.
 * Everything is clamped to something that can actually be shown: a list
 * reporting "page 7 of 3" and displaying nothing is worse than one showing the
 * last page.
 */

describe("resolvePage", () => {
  it("takes the first page by default", () => {
    const page = resolvePage(100, undefined, undefined);
    expect(page).toMatchObject({
      page: 1,
      perPage: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
      from: 1,
      to: DEFAULT_PAGE_SIZE,
      totalPages: 5,
    });
  });

  it("skips to the page asked for", () => {
    expect(resolvePage(100, "3", "20")).toMatchObject({
      page: 3,
      skip: 40,
      from: 41,
      to: 60,
    });
  });

  it("stops the last page short of the end", () => {
    // 47 rows, 20 a page: the third page holds seven.
    expect(resolvePage(47, "3", "20")).toMatchObject({ from: 41, to: 47, totalPages: 3 });
  });

  it("clamps a page past the end to the last one", () => {
    // Deleting the last few students should not leave a bookmark showing
    // nothing at all.
    expect(resolvePage(47, "99", "20")).toMatchObject({ page: 3, from: 41, to: 47 });
  });

  it("clamps a page below the first", () => {
    expect(resolvePage(47, "0", "20").page).toBe(1);
    expect(resolvePage(47, "-5", "20").page).toBe(1);
  });

  it("ignores a page size nobody offered", () => {
    // Otherwise ?perPage=100000 is one query for the whole table.
    expect(resolvePage(100, "1", "99999").perPage).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePage(100, "1", "1").perPage).toBe(DEFAULT_PAGE_SIZE);
  });

  it("ignores nonsense", () => {
    expect(resolvePage(100, "banana", "sausage")).toMatchObject({
      page: 1,
      perPage: DEFAULT_PAGE_SIZE,
    });
    expect(resolvePage(100, "1.5", "20").page).toBe(1);
  });

  it("accepts every size it offers", () => {
    for (const size of PAGE_SIZES) {
      expect(resolvePage(500, "1", String(size)).perPage).toBe(size);
    }
  });

  it("reports one page and no rows for an empty list", () => {
    expect(resolvePage(0, "1", "20")).toMatchObject({
      totalPages: 1,
      from: 0,
      to: 0,
      total: 0,
    });
  });
});

describe("pageWindow", () => {
  it("lists every page when there are few", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it("keeps the ends and a window around the middle", () => {
    // A hundred pages must not become a hundred links.
    expect(pageWindow(50, 100)).toEqual([1, null, 49, 50, 51, null, 100]);
  });

  it("does not leave a gap for a single missing page", () => {
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles the first and last pages", () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });
});
