import { prisma } from "./db";

/**
 * Base username from a student's name: lowercase, letters and digits only.
 * "Arjun R. Kumar" -> "arjunrkumar"
 */
export function baseUsername(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return cleaned.slice(0, 20) || "student";
}

/**
 * Unique username for a new student. Appends the smallest free numeric suffix.
 *
 * `taken` lets a bulk import reserve names generated earlier in the same batch,
 * which the database cannot yet know about — without it, two "Arjun Kumar" rows
 * in one spreadsheet would both resolve to `arjunkumar` and the insert would fail.
 */
export async function generateUsername(
  name: string,
  taken: Set<string> = new Set(),
): Promise<string> {
  const base = baseUsername(name);

  const existing = await prisma.user.findMany({
    where: { username: { startsWith: base } },
    select: { username: true },
  });
  const used = new Set(existing.map((u) => u.username));
  for (const t of taken) used.add(t);

  if (!used.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  // Effectively unreachable; keeps the function total rather than looping forever.
  return `${base}${Date.now().toString(36)}`;
}
