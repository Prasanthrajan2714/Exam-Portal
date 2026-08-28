import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "17 Aug 2026" */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** "09:00 AM" */
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** "17 Aug 2026, 09:00 AM" */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)}, ${formatTime(date)}`;
}

/**
 * A Date rendered for a `datetime-local` input, in the browser's local zone.
 * `toISOString()` cannot be used here — it shifts to UTC and the admin would see
 * a time several hours off the one they picked.
 */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A span of minutes as a person would say it — "45 min", "2 h", "1 h 30 min".
 *
 * Used where a window length is shown back to an admin who typed two clock
 * times: "150 minutes" is arithmetic they then have to do in their head.
 */
export function formatSpan(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

/**
 * The Date an `<input type="date">` value means, as an exam's `examDate`.
 *
 * `examDate` is the exam's local calendar day stored at UTC midnight (see
 * createExam), and it is the date every list shows — so an exact match on it is
 * what an admin means when they pick a day out of a calendar. Anything that is
 * not a date returns null, which every caller reads as "no date filter".
 */
export function examDateFromInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;

  // Date.UTC rolls a month of 13 or a day of 45 forward into a real date rather
  // than refusing it, so "2026-13-45" would quietly become February 2027 and
  // filter a list against a day nobody asked for. Only a date that survives the
  // round trip is the date that was typed.
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}
