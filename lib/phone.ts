/**
 * What counts as a usable mobile number.
 *
 * Ten digits, which is what an Indian mobile number is and what every number in
 * this portal has to be for a message to reach it. A number that is nine digits
 * or eleven is a typo, and the point of catching it here is that it is caught
 * while the admin still has the student in front of them — rather than months
 * later when a result never arrives.
 *
 * Punctuation and spacing are allowed and ignored: an admin pasting
 * "+91 98765 43210" or "98765-43210" means the same ten digits, and refusing
 * their formatting teaches nothing.
 */

export const PHONE_DIGITS = 10;

/** Just the digits, with an Indian country code dropped if one was typed. */
export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  // "+91 98765 43210" and "919876543210" are the same subscriber number.
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
}

/**
 * The problem with this number, or null when it is fine.
 *
 * An empty value is fine: a phone number is optional, and always has been —
 * this is about the shape of one that has been given, not about demanding one.
 */
export function phoneError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const digits = phoneDigits(trimmed);
  if (digits.length === PHONE_DIGITS) return null;

  return digits.length < PHONE_DIGITS
    ? `That is ${digits.length} digit(s). A mobile number needs ${PHONE_DIGITS}.`
    : `That is ${digits.length} digits. A mobile number is ${PHONE_DIGITS}.`;
}
