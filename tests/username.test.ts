import { beforeEach, describe, expect, it, vi } from "vitest";

// generateUsername queries existing users; stand in for the database so the
// collision logic can be tested without one.
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { user: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

const { baseUsername, generateUsername } = await import("@/lib/username");

describe("baseUsername", () => {
  it("lowercases and strips everything that is not a letter or digit", () => {
    expect(baseUsername("Arjun Kumar")).toBe("arjunkumar");
    expect(baseUsername("Arjun R. Kumar")).toBe("arjunrkumar");
    expect(baseUsername("O'Brien-Smith")).toBe("obriensmith");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(baseUsername("José Álvarez")).toBe("josealvarez");
  });

  it("caps the length", () => {
    expect(baseUsername("A".repeat(50)).length).toBe(20);
  });

  it("falls back to 'student' when nothing usable is left", () => {
    expect(baseUsername("!!! ???")).toBe("student");
    expect(baseUsername("")).toBe("student");
  });
});

describe("generateUsername", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns the plain base name when it is free", async () => {
    findMany.mockResolvedValue([]);
    expect(await generateUsername("Arjun Kumar")).toBe("arjunkumar");
  });

  it("appends the smallest free suffix when the name is taken", async () => {
    findMany.mockResolvedValue([{ username: "arjunkumar" }]);
    expect(await generateUsername("Arjun Kumar")).toBe("arjunkumar2");
  });

  it("skips over suffixes already in use", async () => {
    findMany.mockResolvedValue([
      { username: "arjunkumar" },
      { username: "arjunkumar2" },
      { username: "arjunkumar3" },
    ]);
    expect(await generateUsername("Arjun Kumar")).toBe("arjunkumar4");
  });

  it("respects names reserved earlier in the same import", async () => {
    // Two identical names in one spreadsheet: the database knows about neither,
    // so without the reserved set both would resolve to the same username and
    // the second insert would fail.
    findMany.mockResolvedValue([]);
    const taken = new Set<string>();

    const first = await generateUsername("Priya Sharma", taken);
    taken.add(first);
    const second = await generateUsername("Priya Sharma", taken);

    expect(first).toBe("priyasharma");
    expect(second).toBe("priyasharma2");
  });

  it("combines database rows and in-flight reservations", async () => {
    findMany.mockResolvedValue([{ username: "priyasharma" }]);
    expect(await generateUsername("Priya Sharma", new Set(["priyasharma2"]))).toBe(
      "priyasharma3",
    );
  });
});
