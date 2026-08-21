import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "./db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type SessionPayload,
  signSession,
  verifySessionToken,
} from "./session";

export { SESSION_COOKIE, type SessionPayload };
export type { Role } from "./session";

// ---------------------------------------------------------------- passwords

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Readable random password — omits characters students misread when an admin
 * reads credentials out over the phone (0/O, 1/l/I).
 */
export function generatePassword(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ---------------------------------------------------------------- sessions

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * The session for the current request. Cached per request so several server
 * components calling it don't each re-verify the JWT.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
});

// ---------------------------------------------------------------- guards
// Middleware blocks the wrong role from a route tree, but every page and action
// re-checks here: middleware is a convenience, these are the real gate.

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") throw new Error("UNAUTHORIZED");
  return session;
}

/**
 * Resolves the current student and re-reads their status from the database, so
 * disabling a student takes effect on their next request rather than whenever
 * their JWT happens to expire.
 */
export async function requireStudent() {
  const session = await getSession();
  if (!session || session.role !== "STUDENT" || !session.studentId) {
    throw new Error("UNAUTHORIZED");
  }
  const student = await prisma.student.findUnique({
    where: { id: session.studentId },
    include: { batch: true },
  });
  if (!student) throw new Error("UNAUTHORIZED");
  if (student.status !== "ACTIVE") throw new Error("DISABLED");
  return { session, student };
}
