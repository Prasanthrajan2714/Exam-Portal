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
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteNoteFile, noteFileError, saveNoteFile } from "@/lib/uploads";

/**
 * Study notes are reference material, not exam content: an admin uploads a PDF
 * against a batch and every student in that batch can read it. There is no edit
 * flow on purpose — replacing a handout means uploading the new one and
 * deleting the old, so the file on disk always matches its row.
 */

const noteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give the material a title of at least 2 characters")
    .max(120, "Keep the title under 120 characters"),
  description: z.string().trim().max(500, "Keep the description under 500 characters").optional().or(z.literal("")),
  batchId: z.string().min(1, "Choose which batch or class this is for"),
  subjectId: z.string().optional().or(z.literal("")),
});

export async function createNote(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const parsed = noteSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    batchId: formData.get("batchId"),
    subjectId: formData.get("subjectId"),
  });
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  }

  const file = formData.get("file");
  const fileProblem = noteFileError(file);
  if (fileProblem) return fail(fileProblem, { file: fileProblem });

  // Both foreign keys are checked here rather than left to the database, so a
  // stale dropdown produces a sentence instead of a constraint violation.
  const batch = await prisma.batch.findUnique({ where: { id: parsed.data.batchId } });
  if (!batch) return fail("That batch no longer exists.", { batchId: "Unknown batch" });

  const subjectId = parsed.data.subjectId || null;
  if (subjectId) {
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) return fail("That subject no longer exists.", { subjectId: "Unknown subject" });
  }

  const upload = file as File;
  let filePath: string;
  try {
    filePath = await saveNoteFile(batch.id, upload);
  } catch (error) {
    return fail((error as Error).message);
  }

  try {
    await prisma.note.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description || null,
        batchId: batch.id,
        subjectId,
        filePath,
        originalName: upload.name,
        fileSize: upload.size,
        mimeType: "application/pdf",
      },
    });
  } catch (error) {
    // Don't leave the PDF behind if the row could not be written.
    await deleteNoteFile(filePath);
    throw error;
  }

  revalidatePath("/admin/notes");
  revalidatePath("/student/notes");
  return ok(`"${parsed.data.title}" is now available to ${batch.name}.`);
}

/** Hide or re-show a note without touching the file. */
export async function setNoteActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) return fail("Note not found.");

  await prisma.note.update({ where: { id }, data: { active } });
  revalidatePath("/admin/notes");
  revalidatePath("/student/notes");
  return ok(active ? "Material is visible to students again." : "Material hidden from students.");
}

export async function deleteNote(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) return fail("Note not found.");

  await prisma.note.delete({ where: { id } });
  // Row first, file second: a row pointing at a missing file would 404 for
  // students, whereas a leftover file is only wasted disk.
  await deleteNoteFile(note.filePath);

  revalidatePath("/admin/notes");
  revalidatePath("/student/notes");
  return ok(`"${note.title}" deleted.`);
}
