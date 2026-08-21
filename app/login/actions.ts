"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

export type LoginState = { error?: string };

/**
 * One form for both roles — the account itself decides where the user lands, so
 * nobody has to know whether they are an "admin" or a "student" login.
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const { identifier, password } = parsed.data;

  // Username, or email as a convenience. Usernames are stored lowercase.
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: identifier.toLowerCase() },
        { email: { equals: identifier, mode: "insensitive" } },
      ],
    },
    include: { student: true },
  });

  // Same message whether the user is missing or the password is wrong — telling
  // the two apart would let anyone enumerate valid usernames.
  const invalid = { error: "Incorrect username or password." };
  if (!user) return invalid;
  if (!(await verifyPassword(password, user.passwordHash))) return invalid;

  if (user.role === "STUDENT") {
    if (!user.student) return invalid;
    if (user.student.status === "DISABLED") {
      return {
        error:
          "This account has been disabled. Please contact your administrator.",
      };
    }
  }

  // Stamped only once the credentials and the account checks have passed, so a
  // rejected attempt never registers as activity.
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await createSession({
    userId: user.id,
    username: user.username,
    role: user.role,
    studentId: user.student?.id,
    batchId: user.student?.batchId,
  });

  redirect(user.role === "ADMIN" ? "/admin/dashboard" : "/student/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
