"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResult,
  authErrorMessage,
  fail,
  ok,
  zodFieldErrors,
} from "@/lib/action-result";
import { hashPassword, requireStudent, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(72, "Use fewer than 72 characters"),
    confirmPassword: z.string().min(1, "Repeat your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords do not match",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one",
  });

export async function changePassword(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Please sign in again.");
  }

  const parsed = schema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }

  const user = await prisma.user.findUnique({ where: { id: student.userId } });
  if (!user) return fail("Account not found.");

  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return fail("That is not your current password.", {
      currentPassword: "Incorrect password",
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      // They now use a password of their own, so stop nudging them.
      mustChangePassword: false,
    },
  });

  revalidatePath("/student/profile");
  return ok("Your password has been changed.");
}
