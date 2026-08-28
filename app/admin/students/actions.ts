"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import {
  type ActionResult,
  authErrorMessage,
  fail,
  ok,
  zodFieldErrors,
} from "@/lib/action-result";
import { generatePassword, hashPassword, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { phoneError } from "@/lib/phone";
import { credentialsEmail, sendMail } from "@/lib/mailer";
import { generateRollNumber } from "@/lib/username";

const studentSchema = z.object({
  name: z.string().trim().min(2, "Enter the student's full name").max(80),
  phone: z
    .string()
    .trim()
    .max(20)
    // The rule lives in lib/phone.ts so the dialog can apply the same one before
    // submitting — and so this stays the one that actually decides. The message
    // says how many digits were given, which is the useful half of it.
    .superRefine((value, ctx) => {
      const problem = phoneError(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .optional()
    .or(z.literal("")),
  email: z
    .string()
    .trim()
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address")
    .optional()
    .or(z.literal("")),
  schoolName: z.string().trim().max(120).optional().or(z.literal("")),
  batchId: z.string().min(1, "Choose a batch"),
});

async function loginUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/login`;
}

export type CreatedCredential = {
  name: string;
  username: string;
  password: string;
  emailed: boolean;
  emailNote?: string;
};

// ---------------------------------------------------------------- create

export async function createStudent(
  _prev: ActionResult<CreatedCredential>,
  formData: FormData,
): Promise<ActionResult<CreatedCredential>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = studentSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    schoolName: formData.get("schoolName"),
    batchId: formData.get("batchId"),
  });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const batch = await prisma.batch.findUnique({ where: { id: input.batchId } });
  if (!batch) return fail("That batch no longer exists.", { batchId: "Unknown batch" });

  // An admin may override the generated username; fall back to generating one.
  const requested = String(formData.get("username") ?? "").trim().toLowerCase();
  let username: string;
  if (requested) {
    if (!/^[a-z0-9]{3,24}$/.test(requested)) {
      return fail("Usernames may only contain lowercase letters and digits.", {
        username: "3–24 lowercase letters or digits",
      });
    }
    const clash = await prisma.user.findUnique({ where: { username: requested } });
    if (clash) {
      return fail("That username is already taken.", { username: "Already taken" });
    }
    username = requested;
  } else {
    // The roll number, from the batch and its academic year. Generated again
    // here rather than trusting the one the dialog previewed: between the
    // preview and the save, somebody else may have taken it.
    username = await generateRollNumber(input.batchId);
  }

  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  const student = await prisma.student.create({
    data: {
      name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      schoolName: input.schoolName || null,
      // `connect` rather than a bare batchId: Prisma only allows nested relation
      // writes (the user below) alongside relation-style fields, not scalar FKs.
      batch: { connect: { id: input.batchId } },
      user: {
        create: {
          username,
          email: input.email || null,
          passwordHash,
          role: "STUDENT",
          mustChangePassword: true,
        },
      },
    },
  });

  // Email is best-effort: a mail failure must not undo a student who was
  // created correctly, so the admin always gets the password back on screen.
  let emailed = false;
  let emailNote: string | undefined;
  if (input.email) {
    const mail = credentialsEmail({
      name: input.name,
      username,
      password,
      loginUrl: await loginUrl(),
    });
    const result = await sendMail({ to: input.email, ...mail });
    emailed = result.sent;
    emailNote = result.reason;
  } else {
    emailNote = "No email address on file — share these details manually.";
  }

  revalidatePath("/admin/students");
  return ok(`${student.name} added.`, {
    name: student.name,
    username,
    password,
    emailed,
    emailNote,
  });
}

// ---------------------------------------------------------------- update

export async function updateStudent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return fail("Missing student.");

  const parsed = studentSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    schoolName: formData.get("schoolName"),
    batchId: formData.get("batchId"),
  });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) return fail("Student not found.");

  await prisma.student.update({
    where: { id },
    data: {
      name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      schoolName: input.schoolName || null,
      batch: { connect: { id: input.batchId } },
      // Keep the login email in step with the contact email.
      user: { update: { email: input.email || null } },
    },
  });

  revalidatePath("/admin/students");
  return ok(`${input.name} updated.`);
}

// ---------------------------------------------------------------- status

export async function setStudentStatus(
  id: string,
  status: "ACTIVE" | "DISABLED",
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const student = await prisma.student.update({ where: { id }, data: { status } });
  revalidatePath("/admin/students");
  return ok(
    status === "DISABLED"
      ? `${student.name} disabled — they can no longer sign in or sit exams.`
      : `${student.name} re-enabled.`,
  );
}

/**
 * Deletes a student outright, but only while they have no exam history.
 * Once they have attempted an exam, deleting would silently remove that exam's
 * results, so the request is converted into advice to disable instead.
 */
export async function deleteStudent(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const student = await prisma.student.findUnique({
    where: { id },
    include: { _count: { select: { attempts: true } } },
  });
  if (!student) return fail("Student not found.");

  if (student._count.attempts > 0) {
    return fail(
      `${student.name} has already attempted ${student._count.attempts} exam(s). ` +
        `Deleting would remove those results — disable the student instead.`,
    );
  }

  // Cascades to the linked User row.
  await prisma.student.delete({ where: { id } });
  await prisma.user.delete({ where: { id: student.userId } }).catch(() => {});

  revalidatePath("/admin/students");
  return ok(`${student.name} deleted.`);
}

// ---------------------------------------------------------------- password

export async function resetStudentPassword(
  id: string,
): Promise<ActionResult<CreatedCredential>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const student = await prisma.student.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!student) return fail("Student not found.");

  const password = generatePassword();
  await prisma.user.update({
    where: { id: student.userId },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
    },
  });

  let emailed = false;
  let emailNote: string | undefined;
  if (student.email) {
    const mail = credentialsEmail({
      name: student.name,
      username: student.user.username,
      password,
      loginUrl: await loginUrl(),
    });
    const result = await sendMail({ to: student.email, ...mail });
    emailed = result.sent;
    emailNote = result.reason;
  } else {
    emailNote = "No email address on file — share the new password manually.";
  }

  revalidatePath("/admin/students");
  return ok(`New password generated for ${student.name}.`, {
    name: student.name,
    username: student.user.username,
    password,
    emailed,
    emailNote,
  });
}

/** Live username preview for the add-student form. */
/**
 * The roll number a student joining this batch would be given.
 *
 * Keyed on the batch rather than the name, which is why the dialog asks for the
 * batch first: the number says which class and which session a student belongs
 * to, and neither is knowable from what they are called.
 */
export async function previewUsername(batchId: string): Promise<string> {
  try {
    await requireAdmin();
  } catch {
    return "";
  }
  if (!batchId) return "";
  return generateRollNumber(batchId);
}
