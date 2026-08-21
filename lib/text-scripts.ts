/**
 * Superscript and subscript mapping, shared by the .docx text pass and the
 * equation reader.
 *
 * Flattening these silently would turn x² into x2 and 10⁻³ into 10-3 — wrong
 * answers in a maths or physics paper, with nothing on screen to hint at it.
 */

export const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  // Unicode has a superscript for every lowercase letter except q.
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ",
  i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ",
  r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};

export const SUBSCRIPTS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  // Subscript letters are a much smaller set; the rest fall back to _(…).
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ",
  n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

/**
 * Word writes minus signs half a dozen ways — autocorrect turns a typed hyphen
 * into an en dash, and the equation editor uses U+2212 — and it pads exponents
 * with spacing characters. Left alone, any of those makes "10⁻²" fail to map
 * and fall back to the unreadable "10^(−2)".
 */
const DASHES = /[\u2010-\u2015\u2043\u2212\ufe58\ufe63\uff0d]/g;
const BLANKS = /[\s\u00a0\u2000-\u200d\u202f\u205f\u2060\u3000]/g;

function normalise(text: string): string {
  return text.replace(BLANKS, "").replace(DASHES, "-");
}

/**
 * All-or-nothing: a half-converted exponent is more confusing than a marked
 * one, so anything the table cannot express falls back to `^(…)` / `_(…)`.
 */
export function mapScript(
  plain: string,
  table: Record<string, string>,
  fallback: string,
): string {
  const normalised = normalise(plain);
  if (!normalised) return "";

  const mapped = [...normalised].map((ch) => table[ch] ?? table[ch.toLowerCase()]);
  if (mapped.every(Boolean)) return mapped.join("");
  return `${fallback}(${plain.trim().replace(/\s+/g, " ")})`;
}
