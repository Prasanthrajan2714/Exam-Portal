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
 * Does this contain an actual word, as opposed to a quantity or a formula?
 *
 * "Any letter" is far too loose — "9.6 × 10⁻² m" and "kg m s⁻¹" are all letters
 * and all untranslatable. Length alone is not enough either: "PCl₃" and "NaOH"
 * clear three letters and must stay exactly as they are, and flagging them as
 * untranslated puts a red error on every chemical formula in a chemistry paper.
 *
 * What separates prose from a symbol is its shape. English words are lowercase,
 * or capitalised and then lowercase. Element symbols and abbreviations carry
 * capitals inside them — PCl, NaOH, KMnO₄, DNA, ADP — so a run with an internal
 * capital is chemistry, not language.
 */
export function hasWords(value: string): boolean {
  const runs = value.match(/\p{L}{3,}/gu);
  if (!runs) return false;
  return runs.some((run) => {
    const rest = run.slice(1);
    // all lowercase, or one leading capital followed by lowercase
    return rest === rest.toLowerCase();
  });
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
