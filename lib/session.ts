import { SignJWT, jwtVerify } from "jose";

// Edge-safe: this module is imported by middleware.ts, so it must not pull in
// Prisma, bcrypt, or any Node-only API.

export const SESSION_COOKIE = "fb_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // one working day

export type Role = "ADMIN" | "STUDENT";

export type SessionPayload = {
  userId: string;
  username: string;
  role: Role;
  /** Students only — lets pages scope queries by batch without a lookup. */
  studentId?: string;
  batchId?: string;
};

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Set it in .env (32+ random bytes).",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    if (!payload.userId || !payload.role) return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
