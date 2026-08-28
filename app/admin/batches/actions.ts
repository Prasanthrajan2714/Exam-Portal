"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { academicYearError, normaliseAcademicYear } from "@/lib/roll-number";
import {
  type ActionResult,
  authErrorMessage,
  fail,
  ok,
  zodFieldErrors,
} from "@/lib/action-result";

// The name is all a batch needs — it is the label admins pick from when adding
// students and scheduling exams.
const batchSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the batch a name of at least 2 characters")
    .max(60, "Keep the name under 60 characters"),
  // Optional, and normalised so "2026-2027" and "2026-27" do not become two
  // different prefixes for the same session's roll numbers.
  academicYear: z
    .string()
    .trim()
    .max(20)
    .superRefine((value, ctx) => {
      const problem = academicYearError(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .optional()
    .or(z.literal("")),
});

export async function createBatch(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = batchSchema.safeParse({
    name: formData.get("name"),
    academicYear: formData.get("academicYear"),
  });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }

  const existing = await prisma.batch.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) {
    return fail("A batch with that name already exists.", {
      name: "Already used by another batch",
    });
  }

  await prisma.batch.create({
    data: {
      name: parsed.data.name,
      academicYear: normaliseAcademicYear(parsed.data.academicYear ?? ""),
    },
  });

  revalidatePath("/admin/batches");
  return ok(`Batch "${parsed.data.name}" created.`);
}

export async function updateBatch(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const id = String(formData.get("id") ?? "");
  const parsed = batchSchema.safeParse({
    name: formData.get("name"),
    academicYear: formData.get("academicYear"),
  });
  if (!id) return fail("Missing batch.");
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }

  const clash = await prisma.batch.findFirst({
    where: {
      id: { not: id },
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
  });
  if (clash) {
    return fail("Another batch already uses that name.", {
      name: "Already used by another batch",
    });
  }

  await prisma.batch.update({
    where: { id },
    data: {
      name: parsed.data.name,
      academicYear: normaliseAcademicYear(parsed.data.academicYear ?? ""),
    },
  });

  revalidatePath("/admin/batches");
  return ok("Batch updated.");
}

export async function setBatchActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }
  await prisma.batch.update({ where: { id }, data: { active } });
  revalidatePath("/admin/batches");
  return ok(active ? "Batch reactivated." : "Batch deactivated.");
}

/**
 * Hard delete, but only for a batch nothing depends on. Deleting a batch that
 * has students or exams would orphan attempts and results, so that is refused
 * and the admin is pointed at deactivation instead.
 */
export async function deleteBatch(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const batch = await prisma.batch.findUnique({
    where: { id },
    include: { _count: { select: { students: true, exams: true } } },
  });
  if (!batch) return fail("Batch not found.");

  if (batch._count.students > 0 || batch._count.exams > 0) {
    return fail(
      `"${batch.name}" still has ${batch._count.students} student(s) and ` +
        `${batch._count.exams} exam(s). Deactivate it instead — deleting would ` +
        `remove their exam history.`,
    );
  }

  await prisma.batch.delete({ where: { id } });
  revalidatePath("/admin/batches");
  return ok(`Batch "${batch.name}" deleted.`);
}
