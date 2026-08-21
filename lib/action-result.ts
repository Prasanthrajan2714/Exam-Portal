import { z } from "zod";

/**
 * Uniform return shape for server actions used with `useActionState`, so every
 * form can render errors the same way.
 */
export type ActionResult<T = undefined> = {
  ok: boolean;
  message?: string;
  /** Field name -> first validation error. */
  fieldErrors?: Record<string, string>;
  data?: T;
};

export function ok<T>(message?: string, data?: T): ActionResult<T> {
  return { ok: true, message, data };
}

export function fail(
  message: string,
  fieldErrors?: Record<string, string>,
): ActionResult<never> {
  return { ok: false, message, fieldErrors };
}

/** Flattens a Zod error into `{ fieldName: "first message" }`. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * Turns a thrown auth error from requireAdmin/requireStudent into a message
 * instead of a 500, so a signed-out user submitting a stale form sees something
 * sensible.
 */
export function authErrorMessage(error: unknown): string | null {
  const message = (error as Error)?.message;
  if (message === "UNAUTHORIZED") return "Your session has expired. Please sign in again.";
  if (message === "DISABLED") return "This account has been disabled.";
  return null;
}
