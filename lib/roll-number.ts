/**
 * Roll numbers built from the batch a student joins and the year it runs in.
 *
 * A username generated from a name — `arjunkumar`, `arjunkumar2` — says nothing
 * about who the student is, collides between two people of the same name, and
 * leaves the second of them wondering why they are the one with a 2. A roll
 * number says which class and which session, which is what a school already
 * uses to identify a student on paper.
 *
 * The parts are the batch, the academic year and a running number within that
 * pair, so `IIT MAINS` in `2026-27` gives `iitm2627001`. It is stored as the
 * username, because that is what a student signs in with and there is no reason
 * for them to have two identifiers.
 */

/** Longest a batch code may be, so a roll number stays short enough to say. */
const MAX_BATCH_CODE = 6;

/**
 * The short code for a batch: "Foundation 6th" is F6, "NEET" is NEET.
 *
 * Word by word. A number in the name is the part that distinguishes one class
 * from the next, so its digits are kept — F6 and F7 are different batches and
 * must not both shorten to F. An acronym is kept whole while it fits, because
 * NEET means something to a school and N does not. Anything else contributes
 * its initial.
 */
export function batchCode(name: string): string {
  const tokens = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  let code = "";
  for (const token of tokens) {
    // "6th" is the number six, not a word beginning with a six.
    const digits = token.replace(/\D/g, "");
    if (digits) {
      code += digits;
      continue;
    }
    // An acronym stays whole while there is room; past that it drops to its
    // initial rather than being sliced into something unpronounceable.
    const whole = token === token.toUpperCase();
    code +=
      whole && code.length + token.length <= MAX_BATCH_CODE ? token : token[0];
  }

  // Lowercase because that is what a username is; every screen shows it back in
  // capitals, and signing in is case-insensitive either way.
  return code.slice(0, MAX_BATCH_CODE).toLowerCase() || "batch";
}

/**
 * The digits of an academic year: "2026-27" and "2026-2027" both give "2627".
 *
 * Empty when there is no year, which is the case for every batch created before
 * the field existed — the roll number then leaves that part out rather than
 * inventing one.
 */
export function yearCode(academicYear: string | null | undefined): string {
  if (!academicYear) return "";
  const digits = academicYear.replace(/\D/g, "");
  if (digits.length === 8) return digits.slice(2, 4) + digits.slice(6, 8); // 20262027
  if (digits.length === 6) return digits.slice(2, 4) + digits.slice(4, 6); // 202627
  if (digits.length === 4) return digits.slice(2, 4); // 2026
  return digits.slice(0, 4);
}

/**
 * The fixed part every student in one batch and year shares. The running number
 * is appended to this, and it is also what an existing roll number is matched
 * against to find where the count has got to.
 */
export function rollPrefix(
  batchName: string,
  academicYear: string | null | undefined,
): string {
  return `${batchCode(batchName)}${yearCode(academicYear)}`;
}

/** `iitm2627` + 7 -> `iitm2627007`. Past 999 it simply keeps counting. */
export function rollNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(Math.max(1, sequence)).padStart(3, "0")}`;
}

/**
 * The next free roll number for a prefix, given the ones already taken.
 *
 * Counts from the highest number in use rather than from how many exist: a
 * student who has left should not hand their number to the next one to arrive,
 * because a roll number that has been on a mark sheet must not come back
 * attached to somebody else.
 */
export function nextRollNumber(prefix: string, taken: Iterable<string>): string {
  let highest = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);

  for (const name of taken) {
    const match = pattern.exec(name);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isFinite(number) && number > highest) highest = number;
  }

  return rollNumber(prefix, highest + 1);
}

/**
 * What an academic year has to look like, or null when it is fine.
 *
 * Two consecutive years, written either way round: "2026-27" or "2026-2027".
 * Consecutive because a session that ran from 2026 to 2029 is not a session,
 * and catching it here is cheaper than finding it in a roll number later.
 */
export function academicYearError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^(\d{4})\s*[-/–]\s*(\d{2}|\d{4})$/.exec(trimmed);
  if (!match) {
    return 'Write the session as "2026-27" or "2026-2027".';
  }

  const start = Number(match[1]);
  const end = match[2].length === 2 ? Number(String(start).slice(0, 2) + match[2]) : Number(match[2]);
  if (end !== start + 1) {
    return "An academic year runs across two consecutive years.";
  }
  return null;
}

/** "2026-2027" and "2026 - 27" both settle as "2026-27". */
export function normaliseAcademicYear(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || academicYearError(trimmed)) return trimmed || null;

  const match = /^(\d{4})\s*[-/–]\s*(\d{2}|\d{4})$/.exec(trimmed)!;
  return `${match[1]}-${match[2].slice(-2)}`;
}

/**
 * A roll number as it is written down: `f62627001` shows as `F62627001`.
 *
 * Stored lowercase because that is what a username is here, and signing in
 * lowercases whatever is typed — so a student reading the capitals off a slip
 * and typing them in gets in either way.
 */
export function formatRollNumber(username: string): string {
  return username.toUpperCase();
}
