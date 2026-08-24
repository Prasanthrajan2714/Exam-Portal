/**
 * Telling a correct passthrough apart from a missed translation.
 *
 * A Tamil paper's numeric options come back identical to the English, because
 * "9.6 × 10⁻² m" is the same in every language. To an admin reviewing the paper
 * that looks exactly like a failure, so the review screen has to say which case
 * it is looking at — and it must not cry wolf on the quantities, which are the
 * options most likely to look untranslated.
 *
 * Not `server-only`: the review screen is a client component.
 */

/**
 * Does this contain an actual word, as opposed to a quantity?
 *
 * Testing for "any letter" is not enough — "9.6 × 10⁻² m" and "kg m s⁻¹" are
 * all letters and all untranslatable. Unit symbols run to one or two characters,
 * so a run of three or more is what marks real prose ("pascal", "erg").
 */
export function hasWords(value: string): boolean {
  return /\p{L}{3,}/u.test(value);
}

/** A quantity with nothing translatable in it: identical Tamil is correct here. */
export function nothingToTranslate(value: string): boolean {
  return value.trim().length > 0 && !hasWords(value);
}

/**
 * Words came back unchanged — a real miss rather than numbers passing through.
 * Blank Tamil is deliberately not flagged here; the separate "missing" check
 * owns that case and blocks saving on it.
 */
export function stillEnglish(english: string, tamil: string): boolean {
  if (!english.trim() || !tamil.trim()) return false;
  if (english.trim() !== tamil.trim()) return false;
  return hasWords(english) && !/[஀-௿]/.test(tamil);
}
